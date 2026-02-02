// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package app

import (
	"context"

	"github.com/mattermost/mattermost/server/public/plugin"
	"github.com/mattermost/mattermost/server/public/shared/request"
	"github.com/mattermost/mattermost/server/v8/channels/store/sqlstore"
)

// RequestContextWithMaster adds the context value that master DB should be selected for this request.
func RequestContextWithMaster(rctx request.CTX) request.CTX {
	return sqlstore.RequestContextWithMaster(rctx)
}

// accessControlContextKey is the type for access control context keys.
type accessControlContextKey string

// Context key for access control caller ID.
const accessControlCallerIDContextKey accessControlContextKey = "access_control_caller_id"

// withCallerID adds the caller ID to a context.Context for access control purposes.
func withCallerID(ctx context.Context, callerID string) context.Context {
	return context.WithValue(ctx, accessControlCallerIDContextKey, callerID)
}

// RequestContextWithCallerID adds the caller ID to a request.CTX for access control purposes.
func RequestContextWithCallerID(rctx request.CTX, callerID string) request.CTX {
	ctx := withCallerID(rctx.Context(), callerID)
	return rctx.WithContext(ctx)
}

// CallerIDFromContext extracts the caller ID from a context.Context.
// Returns the caller ID and true if found, or empty string and false if not.
func CallerIDFromContext(ctx context.Context) (string, bool) {
	if v := ctx.Value(accessControlCallerIDContextKey); v != nil {
		if id, ok := v.(string); ok {
			return id, true
		}
	}
	return "", false
}

// CallerIDFromRequestContext extracts the caller ID from a request.CTX.
// Returns the caller ID and true if found, or empty string and false if not.
func CallerIDFromRequestContext(rctx request.CTX) (string, bool) {
	return CallerIDFromContext(rctx.Context())
}

func pluginContext(rctx request.CTX) *plugin.Context {
	context := &plugin.Context{
		RequestId:      rctx.RequestId(),
		SessionId:      rctx.Session().Id,
		IPAddress:      rctx.IPAddress(),
		AcceptLanguage: rctx.AcceptLanguage(),
		UserAgent:      rctx.UserAgent(),
	}
	return context
}
