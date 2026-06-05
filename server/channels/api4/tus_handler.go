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
	"io"
	"mime"
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
			// Run in its own goroutine so we don't block the event channel.
			go func(ev tushandler.HookEvent) {
				var raw any
				var ok bool
				// Retry loading the record for up to 5 seconds to resolve the race condition
				// where small files complete uploading before the CreatedUploads goroutine
				// can store the metadata record.
				for i := 0; i < 50; i++ {
					raw, ok = state.records.LoadAndDelete(ev.Upload.ID)
					if ok {
						break
					}
					time.Sleep(100 * time.Millisecond)
				}
				if !ok {
					api.srv.Log().Warn("tus: completed upload has no creation record", mlog.String("upload_id", ev.Upload.ID))
					return
				}
				rec := raw.(tusUploadRecord)
				api.finaliseTusUpload(state, ev, rec)
			}(event)
		}
	}()

	// Mount the tusd HTTP handler with Mattermost auth.
	//
	// tusd's internal mux (handler.go, NewHandler) does:
	//
	//   path := strings.Trim(r.URL.Path, "/")
	//   switch path {
	//   case "":   → creation endpoint (POST only)
	//   default:   → upload-specific operations (PATCH / HEAD / DELETE / GET)
	//   }
	//
	// If we pass the full request path ("/api/v4/files/tus/"), trimming
	// produces "api/v4/files/tus" (non-empty), so tusd routes POST into the
	// upload-specific default case where POST is not allowed → 405.
	//
	// Fix: strip the base prefix BEFORE handing the request to tusd so it
	// sees "" for the creation POST and "{upload_id}" for subsequent ops.
	tusStripped := http.StripPrefix(strings.TrimRight(tusdBasePath, "/"), h)
	tusWithAuth := api.tusAuthMiddleware(tusStripped)
	api.BaseRoutes.Files.PathPrefix("/tus").HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		api.srv.Log().Info("tus: raw request", mlog.String("method", r.Method), mlog.String("path", r.URL.Path))
		// Intercept GET /api/v4/files/tus/fileinfo/{upload_id} before stripping.
		if r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/api/v4/files/tus/fileinfo/") {
			api.tusFileInfoHandler(state, w, r)
			return
		}
		// Behind an SSL-terminating reverse proxy (nginx → Mattermost over plain
		// HTTP), tusd builds the upload Location URL using the incoming HTTP
		// scheme.  That produces "http://" Location headers even though the
		// browser connected over HTTPS, causing the browser to block all
		// follow-up PATCH/HEAD requests as mixed active content.
		//
		// Fix: wrap the ResponseWriter so any Location header that starts with
		// "http://" is rewritten to "https://" when the original request carried
		// X-Forwarded-Proto: https (set by nginx).
		var rw http.ResponseWriter = w
		if r.Header.Get("X-Forwarded-Proto") == "https" {
			rw = &httpsLocationWriter{ResponseWriter: w}
		}
		tusWithAuth.ServeHTTP(rw, r)
	})
}

// httpsLocationWriter wraps an http.ResponseWriter and rewrites any
// "Location: http://" header to "Location: https://" before the response
// headers are flushed.  This corrects the TUS upload URL when Mattermost
// sits behind an SSL-terminating reverse proxy.
type httpsLocationWriter struct {
	http.ResponseWriter
	wroteHeader bool
}

func (w *httpsLocationWriter) WriteHeader(status int) {
	if !w.wroteHeader {
		w.wroteHeader = true
		if loc := w.ResponseWriter.Header().Get("Location"); strings.HasPrefix(loc, "http://") {
			w.ResponseWriter.Header().Set("Location", "https://"+loc[len("http://"):])
		}
	}
	w.ResponseWriter.WriteHeader(status)
}

func (w *httpsLocationWriter) Write(b []byte) (int, error) {
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(b)
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

	logger := api.srv.Log()
	logger.Info("tus: fileinfo request",
		mlog.String("upload_id", uploadID),
		mlog.String("url_path", r.URL.Path),
	)

	raw, ok := state.completedFiles.Load(uploadID)
	if !ok {
		// Log what keys ARE in the map for debugging
		var keys []string
		state.completedFiles.Range(func(key, value any) bool {
			keys = append(keys, key.(string))
			return true
		})
		logger.Warn("tus: fileinfo not found in completedFiles",
			mlog.String("upload_id", uploadID),
			mlog.Int("map_size", len(keys)),
			mlog.String("available_keys", strings.Join(keys, ",")),
		)
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

	// Treat the literal string "undefined" the same as empty — the webapp
	// sometimes sends this when file.name is JS-undefined.
	if rec.filename == "undefined" {
		rec.filename = ""
	}

	if rec.userID == "" {
		logger.Warn("tus: incomplete upload record (no user ID), skipping",
			mlog.String("upload_id", event.Upload.ID),
		)
		return
	}

	// Validate IDs to prevent path traversal in the object-store key.
	// Mattermost IDs are 26-character alphanumeric strings.
	if !model.IsValidId(rec.userID) || !model.IsValidId(rec.channelID) {
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

	// If the client sent an empty or extensionless filename, infer a proper
	// name from the file's actual bytes so that MIME detection, thumbnail
	// generation, and preview rendering all work correctly.
	if rec.filename == "" || !strings.Contains(filepath.Base(rec.filename), ".") {
		inferred := inferFilenameFromFile(f, event.Upload.MetaData["filetype"], logger)
		if inferred != "" {
			logger.Info("tus: inferred filename from file content",
				mlog.String("upload_id", event.Upload.ID),
				mlog.String("original", rec.filename),
				mlog.String("inferred", inferred),
			)
			rec.filename = inferred
		} else if rec.filename == "" {
			rec.filename = fmt.Sprintf("upload_%d", time.Now().UnixMilli())
		}
		// Seek back to the start so the file can be read again for the upload.
		if _, seekErr := f.Seek(0, io.SeekStart); seekErr != nil {
			logger.Error("tus: failed to seek staged file after sniffing",
				mlog.String("path", stagedPath), mlog.Err(seekErr))
			return
		}
	}

	// Build the Mattermost object-store key (mirrors the legacy upload path).
	safeFilename := filepath.Base(rec.filename)
	fileID := model.NewId()
	now := time.Now().UnixMilli()

	var objectKey string
	objectKey = fmt.Sprintf("teams/noteam/channels/%s/users/%s/%d_%s", rec.channelID, rec.userID, now, safeFilename)

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
	logger.Info("tus: storing completed file info",
		mlog.String("upload_id", event.Upload.ID),
		mlog.String("file_id", info.Id),
		mlog.String("channel_id", info.ChannelId),
	)
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

// inferFilenameFromFile reads up to 512 bytes from f to detect the MIME type
// using http.DetectContentType, then generates a filename with the correct
// extension.  If byte-sniffing yields only "application/octet-stream", the
// clientMIME hint (from TUS metadata "filetype") is used instead.
// Returns "" if no useful extension can be determined.
func inferFilenameFromFile(f *os.File, clientMIME string, logger *mlog.Logger) string {
	buf := make([]byte, 512)
	n, err := io.ReadFull(f, buf)
	if err != nil && err != io.ErrUnexpectedEOF && err != io.EOF {
		logger.Warn("tus: failed to read file header for MIME detection", mlog.Err(err))
		return ""
	}
	if n == 0 {
		return ""
	}

	// Manually detect AVIF because http.DetectContentType doesn't support it
	if n >= 12 && string(buf[4:12]) == "ftypavif" {
		return fmt.Sprintf("upload_%d.avif", time.Now().UnixMilli())
	}

	detected := http.DetectContentType(buf[:n])

	// http.DetectContentType returns "application/octet-stream" when it can't
	// identify the content.  Prefer the client-supplied MIME in that case.
	mimeType := detected
	if mimeType == "application/octet-stream" && clientMIME != "" && clientMIME != "application/octet-stream" {
		mimeType = mimeType // keep detected; but try clientMIME for extension
		exts, _ := mime.ExtensionsByType(clientMIME)
		if len(exts) > 0 {
			mimeType = clientMIME
		}
	}

	// Get a file extension for this MIME type.
	exts, _ := mime.ExtensionsByType(mimeType)
	if len(exts) == 0 {
		// Last resort: try the client MIME.
		if clientMIME != "" {
			exts, _ = mime.ExtensionsByType(clientMIME)
		}
		if len(exts) == 0 {
			return ""
		}
	}

	// Prefer common extensions over obscure ones.
	ext := exts[0]
	preferred := map[string]string{
		"image/jpeg": ".jpg",
		"image/png":  ".png",
		"image/gif":  ".gif",
		"image/webp": ".webp",
		"video/mp4":  ".mp4",
		"audio/mpeg": ".mp3",
	}
	if p, ok := preferred[mimeType]; ok {
		ext = p
	}

	return fmt.Sprintf("upload_%d%s", time.Now().UnixMilli(), ext)
}

