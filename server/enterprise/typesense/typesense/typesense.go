// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.enterprise for license information.

package typesense

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/mlog"
	"github.com/mattermost/mattermost/server/public/shared/request"
	"github.com/mattermost/mattermost/server/v8/channels/app/platform"
	"github.com/mattermost/mattermost/server/v8/enterprise/typesense/common"

	"github.com/typesense/typesense-go/typesense"
	"github.com/typesense/typesense-go/typesense/api"
)

type TypesenseInterfaceImpl struct {
	client   *typesense.Client
	mutex    sync.RWMutex
	ready    int32
	Platform *platform.PlatformService
}

func (*TypesenseInterfaceImpl) UpdateConfig(cfg *model.Config) {
	// Not needed, it uses the Platform stored internally to get always the last version
}

func (*TypesenseInterfaceImpl) GetName() string {
	return "typesense"
}

func (ts *TypesenseInterfaceImpl) IsEnabled() bool {
	return *ts.Platform.Config().TypesenseSettings.EnableIndexing
}

func (ts *TypesenseInterfaceImpl) IsActive() bool {
	return *ts.Platform.Config().TypesenseSettings.EnableIndexing && atomic.LoadInt32(&ts.ready) == 1
}

func (ts *TypesenseInterfaceImpl) IsIndexingEnabled() bool {
	return *ts.Platform.Config().TypesenseSettings.EnableIndexing
}

func (ts *TypesenseInterfaceImpl) IsSearchEnabled() bool {
	return *ts.Platform.Config().TypesenseSettings.EnableSearching
}

func (ts *TypesenseInterfaceImpl) IsAutocompletionEnabled() bool {
	return *ts.Platform.Config().TypesenseSettings.EnableAutocomplete
}

func (ts *TypesenseInterfaceImpl) IsIndexingSync() bool {
	return *ts.Platform.Config().TypesenseSettings.LiveIndexingBatchSize <= 1
}

func (ts *TypesenseInterfaceImpl) Start() *model.AppError {
	if !*ts.Platform.Config().TypesenseSettings.EnableIndexing {
		return nil
	}

	ts.mutex.Lock()
	defer ts.mutex.Unlock()

	if atomic.LoadInt32(&ts.ready) != 0 {
		// Typesense is already started
		return nil
	}

	cfg := ts.Platform.Config()

	// Create Typesense client
	client := typesense.NewClient(
		typesense.WithServer(*cfg.TypesenseSettings.ConnectionURL),
		typesense.WithAPIKey(*cfg.TypesenseSettings.APIKey),
		typesense.WithConnectionTimeout(time.Duration(*cfg.TypesenseSettings.RequestTimeoutSeconds)*time.Second),
	)

	ts.client = client

	// Test connection by retrieving health
	ctx := context.Background()
	_, err := client.Health(ctx, 2*time.Second)
	if err != nil {
		return model.NewAppError("Typesense.Start", "ent.typesense.start.health_check_failed", nil, err.Error(), 500)
	}

	// Create collections if they don't exist
	if err := ts.createCollections(ctx); err != nil {
		return err
	}

	atomic.StoreInt32(&ts.ready, 1)

	mlog.Info("Typesense engine started successfully")
	return nil
}

func (ts *TypesenseInterfaceImpl) Stop() *model.AppError {
	ts.mutex.Lock()
	defer ts.mutex.Unlock()

	if atomic.LoadInt32(&ts.ready) == 0 {
		return nil
	}

	atomic.StoreInt32(&ts.ready, 0)
	ts.client = nil

	mlog.Info("Typesense engine stopped")
	return nil
}

func (ts *TypesenseInterfaceImpl) GetFullVersion() string {
	return "1.0.0"
}

func (ts *TypesenseInterfaceImpl) GetVersion() int {
	return 1
}

func (ts *TypesenseInterfaceImpl) GetPlugins() []string {
	return []string{}
}

func (ts *TypesenseInterfaceImpl) createCollections(ctx context.Context) *model.AppError {
	// Create posts collection
	postsSchema := &api.CollectionSchema{
		Name: common.IndexBasePosts,
		Fields: []api.Field{
			{Name: "id", Type: "string"},
			{Name: "team_id", Type: "string", Facet: true},
			{Name: "channel_id", Type: "string", Facet: true},
			{Name: "user_id", Type: "string", Facet: true},
			{Name: "message", Type: "string"},
			{Name: "hashtags", Type: "string[]", Optional: true},
			{Name: "create_at", Type: "int64"},
			{Name: "update_at", Type: "int64"},
			{Name: "delete_at", Type: "int64"},
		},
	}

	if _, err := ts.client.Collections().Create(ctx, postsSchema); err != nil {
		// Collection might already exist, which is fine
		mlog.Debug("Posts collection might already exist", mlog.Err(err))
	}

	// Create channels collection
	channelsSchema := &api.CollectionSchema{
		Name: common.IndexBaseChannels,
		Fields: []api.Field{
			{Name: "id", Type: "string"},
			{Name: "team_id", Type: "string", Facet: true},
			{Name: "name", Type: "string"},
			{Name: "display_name", Type: "string"},
			{Name: "purpose", Type: "string", Optional: true},
			{Name: "header", Type: "string", Optional: true},
			{Name: "type", Type: "string", Facet: true},
			{Name: "create_at", Type: "int64"},
			{Name: "update_at", Type: "int64"},
			{Name: "delete_at", Type: "int64"},
		},
	}

	if _, err := ts.client.Collections().Create(ctx, channelsSchema); err != nil {
		mlog.Debug("Channels collection might already exist", mlog.Err(err))
	}

	// Create users collection
	usersSchema := &api.CollectionSchema{
		Name: common.IndexBaseUsers,
		Fields: []api.Field{
			{Name: "id", Type: "string"},
			{Name: "username", Type: "string"},
			{Name: "first_name", Type: "string", Optional: true},
			{Name: "last_name", Type: "string", Optional: true},
			{Name: "nickname", Type: "string", Optional: true},
			{Name: "email", Type: "string"},
			{Name: "teams", Type: "string[]", Optional: true},
			{Name: "channels", Type: "string[]", Optional: true},
			{Name: "create_at", Type: "int64"},
			{Name: "update_at", Type: "int64"},
			{Name: "delete_at", Type: "int64"},
		},
	}

	if _, err := ts.client.Collections().Create(ctx, usersSchema); err != nil {
		mlog.Debug("Users collection might already exist", mlog.Err(err))
	}

	// Create files collection
	filesSchema := &api.CollectionSchema{
		Name: common.IndexBaseFiles,
		Fields: []api.Field{
			{Name: "id", Type: "string"},
			{Name: "channel_id", Type: "string", Facet: true},
			{Name: "user_id", Type: "string", Facet: true},
			{Name: "name", Type: "string"},
			{Name: "extension", Type: "string", Facet: true},
			{Name: "content", Type: "string", Optional: true},
			{Name: "create_at", Type: "int64"},
			{Name: "update_at", Type: "int64"},
			{Name: "delete_at", Type: "int64"},
		},
	}

	if _, err := ts.client.Collections().Create(ctx, filesSchema); err != nil {
		mlog.Debug("Files collection might already exist", mlog.Err(err))
	}

	return nil
}

// IndexPost indexes a post in Typesense
func (ts *TypesenseInterfaceImpl) IndexPost(post *model.Post, teamID string) *model.AppError {
	if atomic.LoadInt32(&ts.ready) == 0 {
		return model.NewAppError("Typesense.IndexPost", "ent.typesense.not_started", nil, "", 500)
	}

	ctx := context.Background()

	document := map[string]interface{}{
		"id":         post.Id,
		"team_id":    teamID,
		"channel_id": post.ChannelId,
		"user_id":    post.UserId,
		"message":    post.Message,
		"hashtags":   post.Hashtags(),
		"create_at":  post.CreateAt,
		"update_at":  post.UpdateAt,
		"delete_at":  post.DeleteAt,
	}

	if _, err := ts.client.Collection(common.IndexBasePosts).Documents().Upsert(ctx, document); err != nil {
		return model.NewAppError("Typesense.IndexPost", "ent.typesense.index_post.error", nil, err.Error(), 500)
	}

	return nil
}

// SearchPosts searches for posts in Typesense
func (ts *TypesenseInterfaceImpl) SearchPosts(channels model.ChannelList, searchParams []*model.SearchParams, page, perPage int) ([]string, model.PostSearchMatches, *model.AppError) {
	if atomic.LoadInt32(&ts.ready) == 0 {
		return []string{}, nil, model.NewAppError("Typesense.SearchPosts", "ent.typesense.not_started", nil, "", 500)
	}

	if len(searchParams) == 0 {
		return []string{}, nil, nil
	}

	ctx := context.Background()

	// Build query from search params
	query := ""
	for i, param := range searchParams {
		if i > 0 {
			query += " "
		}
		query += param.Terms
	}

	// Build channel filter
	channelIDs := make([]string, len(channels))
	for i, ch := range channels {
		channelIDs[i] = ch.Id
	}

	filterBy := ""
	if len(channelIDs) > 0 {
		filterBy = fmt.Sprintf("channel_id:[%s] && delete_at:=0", joinStrings(channelIDs, ","))
	} else {
		filterBy = "delete_at:=0"
	}

	searchParams := &api.SearchCollectionParams{
		Q:        query,
		QueryBy:  "message",
		FilterBy: &filterBy,
		Page:     intPtr(page + 1), // Typesense uses 1-based indexing
		PerPage:  intPtr(perPage),
		SortBy:   stringPtr("create_at:desc"),
	}

	searchResult, err := ts.client.Collection(common.IndexBasePosts).Documents().Search(ctx, searchParams)
	if err != nil {
		return []string{}, nil, model.NewAppError("Typesense.SearchPosts", "ent.typesense.search_posts.error", nil, err.Error(), 500)
	}

	postIDs := make([]string, 0, len(*searchResult.Hits))
	for _, hit := range *searchResult.Hits {
		doc := *hit.Document
		if id, ok := doc["id"].(string); ok {
			postIDs = append(postIDs, id)
		}
	}

	return postIDs, nil, nil
}

// DeletePost deletes a post from Typesense
func (ts *TypesenseInterfaceImpl) DeletePost(post *model.Post) *model.AppError {
	if atomic.LoadInt32(&ts.ready) == 0 {
		return model.NewAppError("Typesense.DeletePost", "ent.typesense.not_started", nil, "", 500)
	}

	ctx := context.Background()

	if _, err := ts.client.Collection(common.IndexBasePosts).Document(post.Id).Delete(ctx); err != nil {
		// It's okay if the document doesn't exist
		mlog.Debug("Error deleting post from Typesense", mlog.String("post_id", post.Id), mlog.Err(err))
	}

	return nil
}

// DeleteChannelPosts deletes all posts from a channel
func (ts *TypesenseInterfaceImpl) DeleteChannelPosts(rctx request.CTX, channelID string) *model.AppError {
	if atomic.LoadInt32(&ts.ready) == 0 {
		return model.NewAppError("Typesense.DeleteChannelPosts", "ent.typesense.not_started", nil, "", 500)
	}

	ctx := context.Background()
	filterBy := fmt.Sprintf("channel_id:=%s", channelID)

	if _, err := ts.client.Collection(common.IndexBasePosts).Documents().Delete(ctx, &api.DeleteDocumentsParams{
		FilterBy: &filterBy,
	}); err != nil {
		return model.NewAppError("Typesense.DeleteChannelPosts", "ent.typesense.delete_channel_posts.error", nil, err.Error(), 500)
	}

	return nil
}

// DeleteUserPosts deletes all posts from a user
func (ts *TypesenseInterfaceImpl) DeleteUserPosts(rctx request.CTX, userID string) *model.AppError {
	if atomic.LoadInt32(&ts.ready) == 0 {
		return model.NewAppError("Typesense.DeleteUserPosts", "ent.typesense.not_started", nil, "", 500)
	}

	ctx := context.Background()
	filterBy := fmt.Sprintf("user_id:=%s", userID)

	if _, err := ts.client.Collection(common.IndexBasePosts).Documents().Delete(ctx, &api.DeleteDocumentsParams{
		FilterBy: &filterBy,
	}); err != nil {
		return model.NewAppError("Typesense.DeleteUserPosts", "ent.typesense.delete_user_posts.error", nil, err.Error(), 500)
	}

	return nil
}

// IndexChannel indexes a channel in Typesense
func (ts *TypesenseInterfaceImpl) IndexChannel(rctx request.CTX, channel *model.Channel, userIDs, teamMemberIDs []string) *model.AppError {
	if atomic.LoadInt32(&ts.ready) == 0 {
		return model.NewAppError("Typesense.IndexChannel", "ent.typesense.not_started", nil, "", 500)
	}

	ctx := context.Background()

	document := map[string]interface{}{
		"id":           channel.Id,
		"team_id":      channel.TeamId,
		"name":         channel.Name,
		"display_name": channel.DisplayName,
		"purpose":      channel.Purpose,
		"header":       channel.Header,
		"type":         string(channel.Type),
		"create_at":    channel.CreateAt,
		"update_at":    channel.UpdateAt,
		"delete_at":    channel.DeleteAt,
	}

	if _, err := ts.client.Collection(common.IndexBaseChannels).Documents().Upsert(ctx, document); err != nil {
		return model.NewAppError("Typesense.IndexChannel", "ent.typesense.index_channel.error", nil, err.Error(), 500)
	}

	return nil
}

// SyncBulkIndexChannels bulk indexes channels
func (ts *TypesenseInterfaceImpl) SyncBulkIndexChannels(rctx request.CTX, channels []*model.Channel, getUserIDsForChannel func(channel *model.Channel) ([]string, error), teamMemberIDs []string) *model.AppError {
	for _, channel := range channels {
		userIDs := []string{}
		if getUserIDsForChannel != nil {
			ids, err := getUserIDsForChannel(channel)
			if err == nil {
				userIDs = ids
			}
		}
		if err := ts.IndexChannel(rctx, channel, userIDs, teamMemberIDs); err != nil {
			return err
		}
	}
	return nil
}

// SearchChannels searches for channels in Typesense
func (ts *TypesenseInterfaceImpl) SearchChannels(teamID, userID, term string, isGuest, includeDeleted bool) ([]string, *model.AppError) {
	if atomic.LoadInt32(&ts.ready) == 0 {
		return []string{}, model.NewAppError("Typesense.SearchChannels", "ent.typesense.not_started", nil, "", 500)
	}

	ctx := context.Background()

	filterBy := fmt.Sprintf("team_id:=%s", teamID)
	if !includeDeleted {
		filterBy += " && delete_at:=0"
	}

	searchParams := &api.SearchCollectionParams{
		Q:        term,
		QueryBy:  "name,display_name",
		FilterBy: &filterBy,
		PerPage:  intPtr(100),
	}

	searchResult, err := ts.client.Collection(common.IndexBaseChannels).Documents().Search(ctx, searchParams)
	if err != nil {
		return []string{}, model.NewAppError("Typesense.SearchChannels", "ent.typesense.search_channels.error", nil, err.Error(), 500)
	}

	channelIDs := make([]string, 0, len(*searchResult.Hits))
	for _, hit := range *searchResult.Hits {
		doc := *hit.Document
		if id, ok := doc["id"].(string); ok {
			channelIDs = append(channelIDs, id)
		}
	}

	return channelIDs, nil
}

// DeleteChannel deletes a channel from Typesense
func (ts *TypesenseInterfaceImpl) DeleteChannel(channel *model.Channel) *model.AppError {
	if atomic.LoadInt32(&ts.ready) == 0 {
		return model.NewAppError("Typesense.DeleteChannel", "ent.typesense.not_started", nil, "", 500)
	}

	ctx := context.Background()

	if _, err := ts.client.Collection(common.IndexBaseChannels).Document(channel.Id).Delete(ctx); err != nil {
		mlog.Debug("Error deleting channel from Typesense", mlog.String("channel_id", channel.Id), mlog.Err(err))
	}

	return nil
}

// IndexUser indexes a user in Typesense
func (ts *TypesenseInterfaceImpl) IndexUser(rctx request.CTX, user *model.User, teamsIDs, channelsIDs []string) *model.AppError {
	if atomic.LoadInt32(&ts.ready) == 0 {
		return model.NewAppError("Typesense.IndexUser", "ent.typesense.not_started", nil, "", 500)
	}

	ctx := context.Background()

	document := map[string]interface{}{
		"id":         user.Id,
		"username":   user.Username,
		"first_name": user.FirstName,
		"last_name":  user.LastName,
		"nickname":   user.Nickname,
		"email":      user.Email,
		"teams":      teamsIDs,
		"channels":   channelsIDs,
		"create_at":  user.CreateAt,
		"update_at":  user.UpdateAt,
		"delete_at":  user.DeleteAt,
	}

	if _, err := ts.client.Collection(common.IndexBaseUsers).Documents().Upsert(ctx, document); err != nil {
		return model.NewAppError("Typesense.IndexUser", "ent.typesense.index_user.error", nil, err.Error(), 500)
	}

	return nil
}

// SearchUsersInChannel searches for users in a channel
func (ts *TypesenseInterfaceImpl) SearchUsersInChannel(teamID, channelID string, restrictedToChannels []string, term string, options *model.UserSearchOptions) ([]string, []string, *model.AppError) {
	if atomic.LoadInt32(&ts.ready) == 0 {
		return []string{}, []string{}, model.NewAppError("Typesense.SearchUsersInChannel", "ent.typesense.not_started", nil, "", 500)
	}

	ctx := context.Background()

	filterBy := fmt.Sprintf("channels:[%s] && delete_at:=0", channelID)

	searchParams := &api.SearchCollectionParams{
		Q:        term,
		QueryBy:  "username,first_name,last_name,nickname,email",
		FilterBy: &filterBy,
		PerPage:  intPtr(100),
	}

	searchResult, err := ts.client.Collection(common.IndexBaseUsers).Documents().Search(ctx, searchParams)
	if err != nil {
		return []string{}, []string{}, model.NewAppError("Typesense.SearchUsersInChannel", "ent.typesense.search_users.error", nil, err.Error(), 500)
	}

	userIDs := make([]string, 0, len(*searchResult.Hits))
	for _, hit := range *searchResult.Hits {
		doc := *hit.Document
		if id, ok := doc["id"].(string); ok {
			userIDs = append(userIDs, id)
		}
	}

	return userIDs, []string{}, nil
}

// SearchUsersInTeam searches for users in a team
func (ts *TypesenseInterfaceImpl) SearchUsersInTeam(teamID string, restrictedToChannels []string, term string, options *model.UserSearchOptions) ([]string, *model.AppError) {
	if atomic.LoadInt32(&ts.ready) == 0 {
		return []string{}, model.NewAppError("Typesense.SearchUsersInTeam", "ent.typesense.not_started", nil, "", 500)
	}

	ctx := context.Background()

	filterBy := fmt.Sprintf("teams:[%s] && delete_at:=0", teamID)

	searchParams := &api.SearchCollectionParams{
		Q:        term,
		QueryBy:  "username,first_name,last_name,nickname,email",
		FilterBy: &filterBy,
		PerPage:  intPtr(100),
	}

	searchResult, err := ts.client.Collection(common.IndexBaseUsers).Documents().Search(ctx, searchParams)
	if err != nil {
		return []string{}, model.NewAppError("Typesense.SearchUsersInTeam", "ent.typesense.search_users.error", nil, err.Error(), 500)
	}

	userIDs := make([]string, 0, len(*searchResult.Hits))
	for _, hit := range *searchResult.Hits {
		doc := *hit.Document
		if id, ok := doc["id"].(string); ok {
			userIDs = append(userIDs, id)
		}
	}

	return userIDs, nil
}

// DeleteUser deletes a user from Typesense
func (ts *TypesenseInterfaceImpl) DeleteUser(user *model.User) *model.AppError {
	if atomic.LoadInt32(&ts.ready) == 0 {
		return model.NewAppError("Typesense.DeleteUser", "ent.typesense.not_started", nil, "", 500)
	}

	ctx := context.Background()

	if _, err := ts.client.Collection(common.IndexBaseUsers).Document(user.Id).Delete(ctx); err != nil {
		mlog.Debug("Error deleting user from Typesense", mlog.String("user_id", user.Id), mlog.Err(err))
	}

	return nil
}

// IndexFile indexes a file in Typesense
func (ts *TypesenseInterfaceImpl) IndexFile(file *model.FileInfo, channelID string) *model.AppError {
	if atomic.LoadInt32(&ts.ready) == 0 {
		return model.NewAppError("Typesense.IndexFile", "ent.typesense.not_started", nil, "", 500)
	}

	ctx := context.Background()

	document := map[string]interface{}{
		"id":         file.Id,
		"channel_id": channelID,
		"user_id":    file.CreatorId,
		"name":       file.Name,
		"extension":  file.Extension,
		"content":    "", // File content extraction would go here
		"create_at":  file.CreateAt,
		"update_at":  file.UpdateAt,
		"delete_at":  file.DeleteAt,
	}

	if _, err := ts.client.Collection(common.IndexBaseFiles).Documents().Upsert(ctx, document); err != nil {
		return model.NewAppError("Typesense.IndexFile", "ent.typesense.index_file.error", nil, err.Error(), 500)
	}

	return nil
}

// SearchFiles searches for files in Typesense
func (ts *TypesenseInterfaceImpl) SearchFiles(channels model.ChannelList, searchParams []*model.SearchParams, page, perPage int) ([]string, *model.AppError) {
	if atomic.LoadInt32(&ts.ready) == 0 {
		return []string{}, model.NewAppError("Typesense.SearchFiles", "ent.typesense.not_started", nil, "", 500)
	}

	if len(searchParams) == 0 {
		return []string{}, nil
	}

	ctx := context.Background()

	query := ""
	for i, param := range searchParams {
		if i > 0 {
			query += " "
		}
		query += param.Terms
	}

	channelIDs := make([]string, len(channels))
	for i, ch := range channels {
		channelIDs[i] = ch.Id
	}

	filterBy := ""
	if len(channelIDs) > 0 {
		filterBy = fmt.Sprintf("channel_id:[%s] && delete_at:=0", joinStrings(channelIDs, ","))
	} else {
		filterBy = "delete_at:=0"
	}

	searchParams := &api.SearchCollectionParams{
		Q:        query,
		QueryBy:  "name,content",
		FilterBy: &filterBy,
		Page:     intPtr(page + 1),
		PerPage:  intPtr(perPage),
	}

	searchResult, err := ts.client.Collection(common.IndexBaseFiles).Documents().Search(ctx, searchParams)
	if err != nil {
		return []string{}, model.NewAppError("Typesense.SearchFiles", "ent.typesense.search_files.error", nil, err.Error(), 500)
	}

	fileIDs := make([]string, 0, len(*searchResult.Hits))
	for _, hit := range *searchResult.Hits {
		doc := *hit.Document
		if id, ok := doc["id"].(string); ok {
			fileIDs = append(fileIDs, id)
		}
	}

	return fileIDs, nil
}

// DeleteFile deletes a file from Typesense
func (ts *TypesenseInterfaceImpl) DeleteFile(fileID string) *model.AppError {
	if atomic.LoadInt32(&ts.ready) == 0 {
		return model.NewAppError("Typesense.DeleteFile", "ent.typesense.not_started", nil, "", 500)
	}

	ctx := context.Background()

	if _, err := ts.client.Collection(common.IndexBaseFiles).Document(fileID).Delete(ctx); err != nil {
		mlog.Debug("Error deleting file from Typesense", mlog.String("file_id", fileID), mlog.Err(err))
	}

	return nil
}

// DeletePostFiles deletes all files from a post
func (ts *TypesenseInterfaceImpl) DeletePostFiles(rctx request.CTX, postID string) *model.AppError {
	// This would require tracking post_id in files, which we don't have in the schema
	// For now, this is a no-op
	return nil
}

// DeleteUserFiles deletes all files from a user
func (ts *TypesenseInterfaceImpl) DeleteUserFiles(rctx request.CTX, userID string) *model.AppError {
	if atomic.LoadInt32(&ts.ready) == 0 {
		return model.NewAppError("Typesense.DeleteUserFiles", "ent.typesense.not_started", nil, "", 500)
	}

	ctx := context.Background()
	filterBy := fmt.Sprintf("user_id:=%s", userID)

	if _, err := ts.client.Collection(common.IndexBaseFiles).Documents().Delete(ctx, &api.DeleteDocumentsParams{
		FilterBy: &filterBy,
	}); err != nil {
		return model.NewAppError("Typesense.DeleteUserFiles", "ent.typesense.delete_user_files.error", nil, err.Error(), 500)
	}

	return nil
}

// DeleteFilesBatch deletes files in batch based on time
func (ts *TypesenseInterfaceImpl) DeleteFilesBatch(rctx request.CTX, endTime, limit int64) *model.AppError {
	if atomic.LoadInt32(&ts.ready) == 0 {
		return model.NewAppError("Typesense.DeleteFilesBatch", "ent.typesense.not_started", nil, "", 500)
	}

	ctx := context.Background()
	filterBy := fmt.Sprintf("delete_at:>0 && delete_at:<=%d", endTime)

	if _, err := ts.client.Collection(common.IndexBaseFiles).Documents().Delete(ctx, &api.DeleteDocumentsParams{
		FilterBy: &filterBy,
		BatchSize: intPtr(int(limit)),
	}); err != nil {
		return model.NewAppError("Typesense.DeleteFilesBatch", "ent.typesense.delete_files_batch.error", nil, err.Error(), 500)
	}

	return nil
}

// TestConfig tests the Typesense configuration
func (ts *TypesenseInterfaceImpl) TestConfig(rctx request.CTX, cfg *model.Config) *model.AppError {
	client := typesense.NewClient(
		typesense.WithServer(*cfg.TypesenseSettings.ConnectionURL),
		typesense.WithAPIKey(*cfg.TypesenseSettings.APIKey),
		typesense.WithConnectionTimeout(time.Duration(*cfg.TypesenseSettings.RequestTimeoutSeconds)*time.Second),
	)

	ctx := context.Background()
	_, err := client.Health(ctx, 5*time.Second)
	if err != nil {
		return model.NewAppError("Typesense.TestConfig", "ent.typesense.test_config.health_check_failed", nil, err.Error(), 500)
	}

	return nil
}

// PurgeIndexes purges all Typesense collections
func (ts *TypesenseInterfaceImpl) PurgeIndexes(rctx request.CTX) *model.AppError {
	if atomic.LoadInt32(&ts.ready) == 0 {
		return model.NewAppError("Typesense.PurgeIndexes", "ent.typesense.not_started", nil, "", 500)
	}

	ctx := context.Background()

	collections := []string{common.IndexBasePosts, common.IndexBaseChannels, common.IndexBaseUsers, common.IndexBaseFiles}
	for _, collection := range collections {
		if _, err := ts.client.Collection(collection).Delete(ctx); err != nil {
			mlog.Warn("Error deleting collection", mlog.String("collection", collection), mlog.Err(err))
		}
	}

	// Recreate collections
	return ts.createCollections(ctx)
}

// PurgeIndexList purges specific Typesense collections
func (ts *TypesenseInterfaceImpl) PurgeIndexList(rctx request.CTX, indexes []string) *model.AppError {
	if atomic.LoadInt32(&ts.ready) == 0 {
		return model.NewAppError("Typesense.PurgeIndexList", "ent.typesense.not_started", nil, "", 500)
	}

	ctx := context.Background()

	for _, index := range indexes {
		if _, err := ts.client.Collection(index).Delete(ctx); err != nil {
			mlog.Warn("Error deleting collection", mlog.String("collection", index), mlog.Err(err))
		}
	}

	return nil
}

// RefreshIndexes is a no-op for Typesense (not needed)
func (ts *TypesenseInterfaceImpl) RefreshIndexes(rctx request.CTX) *model.AppError {
	return nil
}

// DataRetentionDeleteIndexes deletes old data based on retention policy
func (ts *TypesenseInterfaceImpl) DataRetentionDeleteIndexes(rctx request.CTX, cutoff time.Time) *model.AppError {
	if atomic.LoadInt32(&ts.ready) == 0 {
		return model.NewAppError("Typesense.DataRetentionDeleteIndexes", "ent.typesense.not_started", nil, "", 500)
	}

	ctx := context.Background()
	cutoffTimestamp := cutoff.UnixMilli()

	collections := []string{common.IndexBasePosts, common.IndexBaseChannels, common.IndexBaseUsers, common.IndexBaseFiles}
	for _, collection := range collections {
		filterBy := fmt.Sprintf("create_at:<%d", cutoffTimestamp)
		if _, err := ts.client.Collection(collection).Documents().Delete(ctx, &api.DeleteDocumentsParams{
			FilterBy: &filterBy,
		}); err != nil {
			mlog.Warn("Error deleting old documents", mlog.String("collection", collection), mlog.Err(err))
		}
	}

	return nil
}

// Helper functions
func intPtr(i int) *int {
	return &i
}

func stringPtr(s string) *string {
	return &s
}

func joinStrings(strs []string, sep string) string {
	result := ""
	for i, s := range strs {
		if i > 0 {
			result += sep
		}
		result += s
	}
	return result
}
