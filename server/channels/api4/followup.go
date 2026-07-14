// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package api4

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/mlog"
)

func (api *API) InitFollowUp() {
	api.BaseRoutes.APIRoot.Handle("/followup/actions", api.APIHandler(doFollowUpAction)).Methods(http.MethodPost)
	api.BaseRoutes.Post.Handle("/summarize", api.APISessionRequired(summarizePost)).Methods(http.MethodPost)
	api.BaseRoutes.Channel.Handle("/summarize", api.APISessionRequired(summarizeChannelUnread)).Methods(http.MethodPost)
}

func doFollowUpAction(c *Context, w http.ResponseWriter, r *http.Request) {
	var request struct {
		UserId    string                 `json:"user_id"`
		UserName  string                 `json:"user_name"`
		PostId    string                 `json:"post_id"`
		ChannelId string                 `json:"channel_id"`
		TeamId    string                 `json:"team_id"`
		Context   map[string]interface{} `json:"context"`
	}

	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		c.Logger.Error("Error decoding followup action request", mlog.Err(err))
		c.SetInvalidParam("body")
		return
	}

	action, _ := request.Context["action"].(string)
	threadId, _ := request.Context["thread_id"].(string)

	if action == "" || threadId == "" || request.PostId == "" {
		c.SetInvalidParam("context")
		return
	}

	// 1. Verify the post exists and was sent by followup-bot (using override_username or author id)
	post, appErr := c.App.GetSinglePost(c.AppContext, request.PostId, false)
	if appErr != nil {
		c.Err = appErr
		return
	}

	isBotPost := false
	if usernameProp, ok := post.GetProps()["override_username"].(string); ok && usernameProp == "followup-bot" {
		isBotPost = true
	}
	if !isBotPost {
		c.Logger.Warn("Unauthorized followup action attempt on non-bot post", mlog.String("post_id", request.PostId))
		c.Err = model.NewAppError("doFollowUpAction", "api.context.permissions.app_error", nil, "Post is not a follow-up bot post", http.StatusForbidden)
		return
	}

	// 2. Fetch the root post of the thread
	rootPost, appErr := c.App.GetSinglePost(c.AppContext, threadId, false)
	if appErr != nil {
		c.Err = appErr
		return
	}

	var response model.PostActionIntegrationResponse

	props := rootPost.GetProps()
	if props == nil {
		props = make(model.StringInterface)
	}

	if action == "mark_resolved" {
		// Mark thread as resolved in the root post's props and remove any snooze
		props["followup_status"] = "resolved"
		delete(props, "followup_snooze_until")
		rootPost.SetProps(props)
		if _, appErr = c.App.UpdatePost(c.AppContext, rootPost, &model.UpdatePostOptions{SafeUpdate: false}); appErr != nil {
			c.Err = appErr
			return
		}

		// Update bot nudge post message
		post.Message = "✓ Marked resolved by @" + request.UserName
		// Clear attachments (remove buttons)
		post.AddProp("attachments", []interface{}{})
	} else if action == "snooze" {
		// Snooze thread for 24 hours (add 24 hours to current time) and clear resolved status
		snoozeTime := time.Now().Add(24 * time.Hour).UnixMilli()
		props["followup_snooze_until"] = strconv.FormatInt(snoozeTime, 10)
		delete(props, "followup_status")
		rootPost.SetProps(props)
		if _, appErr = c.App.UpdatePost(c.AppContext, rootPost, &model.UpdatePostOptions{SafeUpdate: false}); appErr != nil {
			c.Err = appErr
			return
		}

		// Update bot nudge post message
		post.Message = "⏰ Snoozed for 24h by @" + request.UserName
		// Clear attachments (remove buttons)
		post.AddProp("attachments", []interface{}{})
	} else {
		c.SetInvalidParam("action")
		return
	}

	// Save the updated bot nudge post to notify all connected clients
	var updatedPost *model.Post
	if updatedPost, appErr = c.App.UpdatePost(c.AppContext, post, &model.UpdatePostOptions{SafeUpdate: false}); appErr != nil {
		c.Err = appErr
		return
	}

	// Respond to the integration callback to satisfy the request
	response.Update = updatedPost
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(response); err != nil {
		c.Logger.Warn("Error writing followup action response", mlog.Err(err))
	}
}

func summarizePost(c *Context, w http.ResponseWriter, r *http.Request) {
	c.RequirePostId()
	if c.Err != nil {
		return
	}

	post, appErr := c.App.GetSinglePost(c.AppContext, c.Params.PostId, false)
	if appErr != nil {
		c.Err = appErr
		return
	}

	// Verify channel permission
	if !c.App.SessionHasPermissionToChannel(c.AppContext, *c.AppContext.Session(), post.ChannelId, model.PermissionReadChannel) {
		c.SetPermissionError(model.PermissionReadChannel)
		return
	}

	summary, appErr := c.App.SummarizeThread(c.AppContext, post.Id, c.AppContext.Session().UserId)
	if appErr != nil {
		c.Err = appErr
		return
	}

	rootId := post.RootId
	if rootId == "" {
		rootId = post.Id
	}

	// Create and send ephemeral post with the summary
	ephemeralPost := &model.Post{
		ChannelId: post.ChannelId,
		RootId:    rootId,
		Message:   summary,
	}
	_ = c.App.SendEphemeralPost(c.AppContext, c.AppContext.Session().UserId, ephemeralPost)

	// Return summary in the JSON response
	response := map[string]string{
		"summary": summary,
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(response); err != nil {
		c.Logger.Warn("Error writing summarize post response", mlog.Err(err))
	}
}

func summarizeChannelUnread(c *Context, w http.ResponseWriter, r *http.Request) {
	c.RequireChannelId()
	if c.Err != nil {
		return
	}

	// Verify channel permission
	if !c.App.SessionHasPermissionToChannel(c.AppContext, *c.AppContext.Session(), c.Params.ChannelId, model.PermissionReadChannel) {
		c.SetPermissionError(model.PermissionReadChannel)
		return
	}

	summary, appErr := c.App.SummarizeChannelUnread(c.AppContext, c.Params.ChannelId, c.AppContext.Session().UserId)
	if appErr != nil {
		c.Err = appErr
		return
	}

	// Create and send ephemeral post with the summary
	ephemeralPost := &model.Post{
		ChannelId: c.Params.ChannelId,
		Message:   summary,
	}
	_ = c.App.SendEphemeralPost(c.AppContext, c.AppContext.Session().UserId, ephemeralPost)

	// Return summary in the JSON response
	response := map[string]string{
		"summary": summary,
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(response); err != nil {
		c.Logger.Warn("Error writing summarize channel unread response", mlog.Err(err))
	}
}
