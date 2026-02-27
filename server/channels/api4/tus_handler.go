// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// Package api4 – TUS resumable-upload endpoint.
//
// Browsers upload files to /api/v4/files/tus/ using the TUS protocol.
// On completion the file is moved into the Mattermost file-store and a
// FileInfo record is created, exactly as the legacy multi-part path does.
//
// After the browser's TUS upload completes it can retrieve the resulting
// Mattermost FileInfo via GET /api/v4/files/tus/fileinfo/{upload_id} (with
// up to 30 s of retry window on the client).
//
// TUS reference: https://tus.io/protocols/resumable-upload

package api4

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	tushandler "github.com/tus/tusd/v2/pkg/handler"
	"github.com/tus/tusd/v2/pkg/filestore"
	"github.com/tus/tusd/v2/pkg/memorylocker"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/mlog"
	"github.com/mattermost/mattermost/server/public/shared/request"
	"github.com/mattermost/mattermost/server/v8/channels/app"
)

// tusdBasePath is the URL prefix under which tusd is mounted.  It must match
// the route registered in InitFile.
const tusdBasePath = "/api/v4/files/tus/"

// tusUploadRecord holds server-side metadata for an in-progress TUS upload.
type tusUploadRecord struct {
	userID    string
	channelID string
	filename  string
}

// tusContextKey is used to carry the validated session through the request ctx.
type tusContextKey struct{}

// tusdState collects the live tusd handler and its upload metadata maps.
// It is created once in InitTusUpload and reused for the server's lifetime.
type tusdState struct {
	handler        *tushandler.Handler
	tusDir         string
	records        sync.Map // upload ID → tusUploadRecord
	completedFiles sync.Map // upload ID → *model.FileInfo (set after finalization)
}

// InitTusUpload sets up a TUS-protocol upload handler and mounts it under
// /api/v4/files/tus/.  It uses a local temp directory as the staging area;
// on completion each file is moved into the Mattermost file-store.
func (api *API) InitTusUpload() {
	tusDir, err := os.MkdirTemp("", "mattermost-tus-*")
	if err != nil {
		api.srv.Log().Error("tus: failed to create temp dir", mlog.Err(err))
		return
	}

	store := filestore.New(tusDir)
	locker := memorylocker.New()

	composer := tushandler.NewStoreComposer()
	store.UseIn(composer)
	locker.UseIn(composer)

	h, err := tushandler.NewHandler(tushandler.Config{
		BasePath:              tusdBasePath,
		StoreComposer:         composer,
		NotifyCompleteUploads: true,
		NotifyCreatedUploads:  true,
		// Mattermost handles CORS globally – let tusd skip it.
		Cors: &tushandler.CorsConfig{Disable: true},
	})
	if err != nil {
		api.srv.Log().Error("tus: failed to create handler", mlog.Err(err))
		return
	}

	state := &tusdState{
		handler: h,
		tusDir:  tusDir,
	}

	// Goroutine: record the userID when a new upload is created.
	go func() {
		for event := range h.CreatedUploads {
			userID, _ := event.Context.Value(tusContextKey{}).(string)
			meta := event.Upload.MetaData
			state.records.Store(event.Upload.ID, tusUploadRecord{
				userID:    userID,
				channelID: meta["channel_id"],
				filename:  meta["filename"],
			})
		}
	}()

	// Goroutine: finalise completed uploads.
	go func() {
		for event := range h.CompleteUploads {
			raw, ok := state.records.LoadAndDelete(event.Upload.ID)
			if !ok {
				continue
			}
			rec := raw.(tusUploadRecord)
			// Run in its own goroutine so slow S3 copies don't block the channel.
			go api.finaliseTusUpload(state, event, rec)
		}
	}()

	// Mount the tusd HTTP handler with Mattermost auth.
	// The /fileinfo sub-path is intercepted here and handled by tusFileInfoHandler.
	tusWithAuth := api.tusAuthMiddleware(h)
	api.BaseRoutes.Files.PathPrefix("/tus").HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Intercept GET /api/v4/files/tus/fileinfo/{upload_id}
		if r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/api/v4/files/tus/fileinfo/") {
			api.tusFileInfoHandler(state, w, r)
			return
		}
		tusWithAuth.ServeHTTP(w, r)
	})
}

// tusFileInfoHandler handles GET /api/v4/files/tus/fileinfo/{upload_id}.
// After a TUS upload completes the browser polls this endpoint to retrieve
// the resulting Mattermost FileInfo record.
func (api *API) tusFileInfoHandler(state *tusdState, w http.ResponseWriter, r *http.Request) {
	token, _ := app.ParseAuthTokenFromRequest(r)
	if token == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	appInst := app.New(app.ServerConnector(api.srv.Channels()))
	session, aerr := appInst.GetSession(token)
	if aerr != nil || session.IsExpired() {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Extract upload_id from the URL path.
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/v4/files/tus/fileinfo/"), "/")
	uploadID := parts[0]
	if uploadID == "" {
		http.Error(w, "Bad Request", http.StatusBadRequest)
		return
	}

	raw, ok := state.completedFiles.Load(uploadID)
	if !ok {
		// Not yet ready – browser should retry.
		http.Error(w, "Not Found", http.StatusNotFound)
		return
	}

	info := raw.(*model.FileInfo)
	// Verify the requesting user owns this upload.
	if info.CreatorId != session.UserId {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(info)

	// Remove from map so we don't leak memory.
	state.completedFiles.Delete(uploadID)
}

// tusAuthMiddleware validates the Mattermost session token that the client
// attaches as the Authorization: Bearer <token> header (or cookie / query
// string – anything ParseAuthTokenFromRequest supports).
func (api *API) tusAuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token, _ := app.ParseAuthTokenFromRequest(r)
		if token == "" {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		appInst := app.New(app.ServerConnector(api.srv.Channels()))
		session, aerr := appInst.GetSession(token)
		if aerr != nil || session.IsExpired() {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		if appInst.Config().FileSettings.EnableFileAttachments != nil &&
			!*appInst.Config().FileSettings.EnableFileAttachments {
			http.Error(w, "File attachments are disabled", http.StatusForbidden)
			return
		}

		// Propagate user ID through context for the CreatedUploads notification.
		ctx := context.WithValue(r.Context(), tusContextKey{}, session.UserId)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// finaliseTusUpload is called once tusd has received all bytes for an upload.
// It copies the staged file into the Mattermost file-store, creates a
// FileInfo record, and stores it in state.completedFiles for the browser
// to retrieve via GET /api/v4/files/tus/fileinfo/{upload_id}.
func (api *API) finaliseTusUpload(state *tusdState, event tushandler.HookEvent, rec tusUploadRecord) {
	logger := api.srv.Log()

	if rec.userID == "" || rec.channelID == "" || rec.filename == "" {
		logger.Warn("tus: incomplete upload record, skipping",
			mlog.String("upload_id", event.Upload.ID),
			mlog.String("user_id", rec.userID),
			mlog.String("channel_id", rec.channelID),
		)
		return
	}

	// Validate IDs to prevent path traversal in the object-store key.
	// Mattermost IDs are 26-character alphanumeric strings.
	if !model.IsValidId(rec.channelID) || !model.IsValidId(rec.userID) {
		logger.Warn("tus: invalid channel/user ID in upload metadata",
			mlog.String("upload_id", event.Upload.ID),
			mlog.String("channel_id", rec.channelID),
			mlog.String("user_id", rec.userID),
		)
		return
	}

	// Staged file path as written by tusd's filestore.
	stagedPath := filepath.Join(state.tusDir, event.Upload.ID)

	f, err := os.Open(stagedPath)
	if err != nil {
		logger.Error("tus: cannot open staged file",
			mlog.String("path", stagedPath), mlog.Err(err))
		return
	}
	defer f.Close()

	// Build the Mattermost object-store key (mirrors the legacy upload path).
	safeFilename := filepath.Base(rec.filename)
	fileID := model.NewId()
	now := time.Now().UnixMilli()
	objectKey := fmt.Sprintf("teams/noteam/channels/%s/users/%s/%d_%s",
		rec.channelID, rec.userID, now, safeFilename)

	appInst := app.New(app.ServerConnector(api.srv.Channels()))

	// Write to the Mattermost file-store.
	written, appErr := appInst.WriteFile(f, objectKey)
	if appErr != nil {
		logger.Error("tus: failed to write to file store",
			mlog.String("key", objectKey), mlog.Err(appErr))
		return
	}
	if written == 0 && event.Upload.Size > 0 {
		logger.Warn("tus: zero bytes written", mlog.String("key", objectKey))
	}

	// Register the FileInfo record.
	rctx := request.EmptyContext(logger)
	info, aerr := appInst.CompleteDirectUpload(
		rctx,
		rec.channelID,
		rec.userID,
		fileID,
		rec.filename,
		objectKey,
		event.Upload.Size,
	)
	if aerr != nil {
		logger.Error("tus: CompleteDirectUpload failed",
			mlog.String("file_id", fileID), mlog.Err(aerr))
		// Best-effort cleanup of the object we just stored.
		_ = appInst.RemoveFile(objectKey)
		return
	}

	// Make the FileInfo available for the fileinfo endpoint (TTL ~5 min).
	state.completedFiles.Store(event.Upload.ID, info)
	time.AfterFunc(5*time.Minute, func() {
		state.completedFiles.Delete(event.Upload.ID)
	})

	// Clean up tusd staging files.
	cleanupTusStaging(stagedPath, logger)
}

// cleanupTusStaging removes the tusd data file and its companion .info file.
func cleanupTusStaging(stagedPath string, logger *mlog.Logger) {
	for _, p := range []string{stagedPath, stagedPath + ".info"} {
		if rmErr := os.Remove(p); rmErr != nil && !os.IsNotExist(rmErr) {
			logger.Warn("tus: failed to remove staging file",
				mlog.String("path", p), mlog.Err(rmErr))
		}
	}
}

