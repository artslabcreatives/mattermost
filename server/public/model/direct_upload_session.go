// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package model

// DirectUploadState represents the lifecycle state of a direct-to-S3 upload session.
type DirectUploadState string

const (
	// DirectUploadStateCreated is the initial state after the session is created.
	DirectUploadStateCreated DirectUploadState = "created"
	// DirectUploadStateUploading means the client has started transferring data.
	DirectUploadStateUploading DirectUploadState = "uploading"
	// DirectUploadStateUploaded means the object was PUT to the store successfully.
	DirectUploadStateUploaded DirectUploadState = "uploaded"
	// DirectUploadStateVerified means the server confirmed the object exists.
	DirectUploadStateVerified DirectUploadState = "verified"
	// DirectUploadStateRegistered means a FileInfo record has been saved.
	DirectUploadStateRegistered DirectUploadState = "registered"
	// DirectUploadStateExpired means the TTL elapsed before completion.
	DirectUploadStateExpired DirectUploadState = "expired"
	// DirectUploadStateAborted means the upload was cancelled.
	DirectUploadStateAborted DirectUploadState = "aborted"

	// DirectUploadSessionTTLSeconds is the default TTL for a session.
	DirectUploadSessionTTLSeconds = 3600 // 1 hour
)

// DirectUploadSession is a short-lived record that tracks a single browser→S3 PUT upload.
// It is held in memory (with optional Redis backing via Companion) and is never written to
// the main Mattermost database.
type DirectUploadSession struct {
	// UploadID is a unique identifier for this upload session (same as FileID for simplicity).
	UploadID string `json:"upload_id"`
	// FileID is the ID that will become the FileInfo.Id once the upload is registered.
	FileID string `json:"file_id"`
	// ChannelID is the channel the file belongs to.
	ChannelID string `json:"channel_id"`
	// UserID is the uploading user.
	UserID string `json:"user_id"`
	// Filename is the original filename supplied by the client.
	Filename string `json:"filename"`
	// ContentType is the MIME type of the file.
	ContentType string `json:"content_type"`
	// ObjectKey is the deterministic S3 object key (never supplied by the client).
	ObjectKey string `json:"object_key"`
	// UploadURL is the pre-signed PUT URL the client should upload to.
	UploadURL string `json:"upload_url"`
	// State is the current lifecycle state.
	State DirectUploadState `json:"state"`
	// CreatedAt is the Unix millisecond timestamp when the session was created.
	CreatedAt int64 `json:"created_at"`
	// ExpiresAt is the Unix millisecond timestamp when the session expires.
	ExpiresAt int64 `json:"expires_at"`
}

// DirectUploadCreateRequest is the request body for POST /api/v4/files/direct/session.
type DirectUploadCreateRequest struct {
	ChannelID   string `json:"channel_id"`
	Filename    string `json:"filename"`
	ContentType string `json:"content_type"`
}

// DirectUploadCompleteRequest is the request body for POST /api/v4/files/direct/complete.
type DirectUploadCompleteRequest struct {
	UploadID string `json:"upload_id"`
	FileID   string `json:"file_id"`
	// ObjectKey is included so the server can validate it matches the session.
	ObjectKey string `json:"object_key"`
	// FileSize is the final byte-count of the uploaded object.
	FileSize int64 `json:"file_size"`
}
