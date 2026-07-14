// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package slashcommands

import (
	"strings"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/i18n"
	"github.com/mattermost/mattermost/server/public/shared/request"
	"github.com/mattermost/mattermost/server/v8/channels/app"
)

type SummarizeProvider struct {
}

const (
	CmdSummarize = "summarize"
)

func init() {
	app.RegisterCommandProvider(&SummarizeProvider{})
}

func (*SummarizeProvider) GetTrigger() string {
	return CmdSummarize
}

func (*SummarizeProvider) GetCommand(a *app.App, T i18n.TranslateFunc) *model.Command {
	return &model.Command{
		Trigger:          CmdSummarize,
		AutoComplete:     true,
		AutoCompleteDesc: "Generate an AI summary of the current thread",
		AutoCompleteHint: "[post_id]",
		DisplayName:      "Summarize Thread",
	}
}

func (*SummarizeProvider) DoCommand(a *app.App, rctx request.CTX, args *model.CommandArgs, message string) *model.CommandResponse {
	var targetPostId string

	message = strings.TrimSpace(message)
	if message != "" {
		// User specified a post ID
		if model.IsValidId(message) {
			targetPostId = message
		} else {
			return &model.CommandResponse{
				ResponseType: model.CommandResponseTypeEphemeral,
				Text:         "Invalid post ID. Please specify a valid 26-character post ID: `/summarize <post_id>`, or run this command inside a thread.",
			}
		}
	} else if args.RootId != "" {
		targetPostId = args.RootId
	} else if args.ParentId != "" {
		targetPostId = args.ParentId
	}

	if targetPostId == "" {
		return &model.CommandResponse{
			ResponseType: model.CommandResponseTypeEphemeral,
			Text:         "Please run this command from within a thread, or specify a valid post ID: `/summarize <post_id>`",
		}
	}

	summary, appErr := a.SummarizeThread(rctx, targetPostId, args.UserId)
	if appErr != nil {
		return &model.CommandResponse{
			ResponseType: model.CommandResponseTypeEphemeral,
			Text:         "Failed to generate summary: " + appErr.Message,
		}
	}

	return &model.CommandResponse{
		ResponseType: model.CommandResponseTypeEphemeral,
		Text:         summary,
	}
}
