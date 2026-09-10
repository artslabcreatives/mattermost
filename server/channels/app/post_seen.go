// Copyright (c) 2015-present Aura, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package app

import (
	"net/http"
	"sort"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/request"
)

func (a *App) GetPostSeenReceipts(rctx request.CTX, post *model.Post) (*model.PostSeenReceipts, *model.AppError) {
	// Fetch all members of this post's channel
	members, err := a.Srv().Store().Channel().GetMembers(model.ChannelMembersGetOptions{
		ChannelID: post.ChannelId,
		Offset:    0,
		Limit:     1000,
	})
	if err != nil {
		return nil, model.NewAppError("GetPostSeenReceipts", "app.channel.get_members.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}

	// Collect user IDs of channel members (excluding the author)
	var userIDs []string
	memberMap := make(map[string]*model.ChannelMember)
	for i := range members {
		member := &members[i]
		if member.UserId != post.UserId {
			userIDs = append(userIDs, member.UserId)
			memberMap[member.UserId] = member
		}
	}

	if len(userIDs) == 0 {
		return &model.PostSeenReceipts{
			PostId:      post.Id,
			ChannelId:   post.ChannelId,
			CreateAt:    post.CreateAt,
			ReadBy:      []*model.PostReaderInfo{},
			DeliveredTo: []*model.PostDeliveredInfo{},
		}, nil
	}

	// Fetch user profiles to filter out bots and deleted accounts, and get names
	users, err := a.Srv().Store().User().GetProfileByIds(rctx, userIDs, nil, true)
	if err != nil {
		return nil, model.NewAppError("GetPostSeenReceipts", "app.user.get_profiles.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}

	readBy := make([]*model.PostReaderInfo, 0)
	deliveredTo := make([]*model.PostDeliveredInfo, 0)

	for _, user := range users {
		// Exclude deleted accounts or bots
		if user.DeleteAt != 0 || user.IsBot {
			continue
		}

		member, ok := memberMap[user.Id]
		if !ok {
			continue
		}

		if member.LastViewedAt >= post.CreateAt {
			readBy = append(readBy, &model.PostReaderInfo{
				UserId:    user.Id,
				Username:  user.Username,
				FirstName: user.FirstName,
				LastName:  user.LastName,
				Nickname:  user.Nickname,
				ViewedAt:  member.LastViewedAt,
			})
		} else {
			deliveredTo = append(deliveredTo, &model.PostDeliveredInfo{
				UserId:    user.Id,
				Username:  user.Username,
				FirstName: user.FirstName,
				LastName:  user.LastName,
				Nickname:  user.Nickname,
			})
		}
	}

	// Sort readBy descending by ViewedAt (most recent reader first)
	sort.Slice(readBy, func(i, j int) bool {
		return readBy[i].ViewedAt > readBy[j].ViewedAt
	})

	// Sort deliveredTo alphabetically by username
	sort.Slice(deliveredTo, func(i, j int) bool {
		return deliveredTo[i].Username < deliveredTo[j].Username
	})

	return &model.PostSeenReceipts{
		PostId:      post.Id,
		ChannelId:   post.ChannelId,
		CreateAt:    post.CreateAt,
		ReadBy:      readBy,
		DeliveredTo: deliveredTo,
	}, nil
}
