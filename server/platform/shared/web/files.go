// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package web

import (
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/pkg/errors"
)

var UnsafeContentTypes = [...]string{
	"application/javascript",
	"application/ecmascript",
	"text/javascript",
	"text/ecmascript",
	"application/x-javascript",
	"text/html",
}

var MediaContentTypes = [...]string{
	"image/jpeg",
	"image/png",
	"image/bmp",
	"image/gif",
	"image/tiff",
	"image/webp",
	"video/avi",
	"video/mpeg",
	"video/mp4",
	"video/webm",
	"video/ogg",
	"video/quicktime",
	"video/x-matroska",
	"audio/mpeg",
	"audio/wav",
	"audio/ogg",
	"audio/webm",
	"audio/mp4",
	"audio/x-m4a",
	"audio/aac",
	"audio/flac",
}

// WriteFileResponse copies the io.ReadSeeker `fileReader` to the ResponseWriter `w`. Use this when you have a
// ReadSeeker.
func WriteFileResponse(filename string, contentType string, contentSize int64, lastModification time.Time, webserverMode string, fileReader io.ReadSeeker, forceDownload bool, w http.ResponseWriter, r *http.Request) {
	setHeaders(w, contentType, forceDownload, filename)

	if contentSize > 0 {
		contentSizeStr := strconv.Itoa(int(contentSize))
		if webserverMode == "gzip" {
			w.Header().Set("X-Uncompressed-Content-Length", contentSizeStr)
		} else {
			w.Header().Set("Content-Length", contentSizeStr)
		}
	}

	http.ServeContent(w, r, filename, lastModification, fileReader)
}

// WriteStreamResponse copies the Reader `r` to the ResponseWriter `w`. Use this when you need to stream a response
// to the client that will appear as a file `filename` of type `contentType`.
func WriteStreamResponse(w http.ResponseWriter, r io.Reader, filename string, contentType string, forceDownload bool) error {
	setHeaders(w, contentType, forceDownload, filename)

	if _, err := io.Copy(w, r); err != nil {
		return errors.Wrap(err, "error streaming Reader")
	}

	return nil
}

func setHeaders(w http.ResponseWriter, contentType string, forceDownload bool, filename string) {
	// Only set Cache-Control if it hasn't been set already.
	// Files are immutable once uploaded (file ID = permanent, content = permanent),
	// so we can cache very aggressively to prevent repeated S3 round-trips.
	if w.Header().Get("Cache-Control") == "" {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")

	if contentType == "" {
		contentType = "application/octet-stream"
	} else {
		for _, unsafeContentType := range UnsafeContentTypes {
			if strings.HasPrefix(contentType, unsafeContentType) {
				contentType = "text/plain"
				break
			}
		}
	}

	w.Header().Set("Content-Type", contentType)

	var toDownload bool
	if forceDownload {
		toDownload = true
	} else {
		isMediaType := false
		for _, mediaContentType := range MediaContentTypes {
			if strings.HasPrefix(contentType, mediaContentType) {
				isMediaType = true
				break
			}
		}
		toDownload = !isMediaType
	}

	filename = url.PathEscape(filename)

	if toDownload {
		w.Header().Set("Content-Disposition", "attachment;filename=\""+filename+"\"; filename*=UTF-8''"+filename)
	} else {
		w.Header().Set("Content-Disposition", "inline;filename=\""+filename+"\"; filename*=UTF-8''"+filename)
	}

	// prevent file links from being embedded in iframes
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Content-Security-Policy", "Frame-ancestors 'none'")
}
