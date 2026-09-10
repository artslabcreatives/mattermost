// Copyright (c) 2015-present Aura, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package model

type PostReaderInfo struct {
	UserId    string `json:"user_id"`
	Username  string `json:"username"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
	Nickname  string `json:"nickname"`
	ViewedAt  int64  `json:"viewed_at"`
}

type PostDeliveredInfo struct {
	UserId    string `json:"user_id"`
	Username  string `json:"username"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
	Nickname  string `json:"nickname"`
}

type PostSeenReceipts struct {
	PostId      string               `json:"post_id"`
	ChannelId   string               `json:"channel_id"`
	CreateAt    int64                `json:"create_at"`
	ReadBy      []*PostReaderInfo    `json:"read_by"`
	DeliveredTo []*PostDeliveredInfo `json:"delivered_to"`
}
