// Copyright (c) 2015-present Aura, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package api4

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/mattermost/mattermost/server/public/model"
)

func TestGetPostSeenReceipts(t *testing.T) {
	th := Setup(t).InitBasic(t)

	client := th.Client
	channel := th.BasicChannel
	user := th.BasicUser
	user2 := th.BasicUser2

	// User creates a post in the channel
	post := &model.Post{
		ChannelId: channel.Id,
		Message:   "Testing read receipts",
	}
	createdPost, resp, err := client.CreatePost(context.Background(), post)
	require.NoError(t, err)
	CheckCreatedStatus(t, resp)
	require.NotNil(t, createdPost)

	// User 2 (not the author) attempts to fetch seen receipts -> Must be 403 Forbidden
	client2 := th.CreateClient()
	_, _, err = client2.Login(context.Background(), user2.Email, user2.Password)
	require.NoError(t, err)
	defer client2.Logout(context.Background())

	_, resp2, err := client2.GetPostSeenReceipts(context.Background(), createdPost.Id)
	require.Error(t, err)
	CheckForbiddenStatus(t, resp2)

	// User 1 (the author) fetches seen receipts -> Must succeed (200 OK)
	receipts, resp1, err := client.GetPostSeenReceipts(context.Background(), createdPost.Id)
	require.NoError(t, err)
	CheckOKStatus(t, resp1)
	require.NotNil(t, receipts)
	require.Equal(t, createdPost.Id, receipts.PostId)
	require.Equal(t, channel.Id, receipts.ChannelId)
	_ = user
}
