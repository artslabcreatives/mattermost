// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/mlog"
	"github.com/mattermost/mattermost/server/public/shared/request"
	"github.com/mattermost/mattermost/server/v8/channels/store"
)

// LLMService defines the configuration structure for active services in agents_confighistory.
type LLMService struct {
	Type         string `json:"type"`
	ApiKey       string `json:"apiKey"`
	DefaultModel string `json:"defaultModel"`
	ApiURL       string `json:"apiURL"`
}

// AgentConfig represents the overall agent configuration structure stored in the database.
type AgentConfig struct {
	Services []LLMService `json:"services"`
}

// resolveOpenAIService returns the active OpenAI configuration for summarization.
// It first consults the Agents plugin config stored in agents_confighistory, and
// falls back to the OPENAI_API_KEY / OPENAI_MODEL environment variables (shared
// with the Follow-up Bot) when no active database config with an OpenAI key is
// available. This lets summarize work on servers where the Agents plugin is not
// configured but the OpenAI key is provided via the environment.
func (a *App) resolveOpenAIService(rctx request.CTX, caller string) (*LLMService, *model.AppError) {
	// Prefer the active Agents plugin config from the database.
	if db := a.Srv().Store().GetInternalMasterDB(); db != nil {
		var configJSON string
		if rowErr := db.QueryRow("SELECT config FROM agents_confighistory WHERE active = true").Scan(&configJSON); rowErr == nil {
			var agentConf AgentConfig
			if unmarshalErr := json.Unmarshal([]byte(configJSON), &agentConf); unmarshalErr == nil {
				for _, svc := range agentConf.Services {
					if svc.Type == "openai" && svc.ApiKey != "" {
						resolved := svc
						return &resolved, nil
					}
				}
				rctx.Logger().Debug("No OpenAI service configured in active Agents configuration; falling back to environment variables", mlog.String("caller", caller))
			} else {
				rctx.Logger().Debug("Failed to unmarshal active Agents configuration; falling back to environment variables", mlog.String("caller", caller), mlog.Err(unmarshalErr))
			}
		} else {
			rctx.Logger().Debug("No active Agents configuration found in database; falling back to environment variables", mlog.String("caller", caller), mlog.Err(rowErr))
		}
	} else {
		rctx.Logger().Debug("Database connection not available; falling back to environment variables", mlog.String("caller", caller))
	}

	// Fall back to environment configuration.
	if envKey := os.Getenv("OPENAI_API_KEY"); envKey != "" {
		rctx.Logger().Debug("Using environment variables for OpenAI service configuration", mlog.String("caller", caller))
		return &LLMService{
			Type:         "openai",
			ApiKey:       envKey,
			DefaultModel: os.Getenv("OPENAI_MODEL"),
		}, nil
	}

	rctx.Logger().Debug("No OpenAI configuration found in either database or environment variables", mlog.String("caller", caller))
	return nil, model.NewAppError(caller, "app.summarize.config_error", nil, "OpenAI API key not configured: no active Agents config with an OpenAI key and OPENAI_API_KEY is unset", http.StatusBadRequest)
}

func (a *App) SummarizeThread(rctx request.CTX, postId string, userId string) (string, *model.AppError) {
	// 1. Fetch the target post to check and find root post
	post, err := a.GetSinglePost(rctx, postId, false)
	if err != nil {
		return "", err
	}

	rootId := post.RootId
	if rootId == "" {
		rootId = post.Id
	}

	// 2. Fetch the thread posts
	opts := model.GetPostsOptions{
		SkipFetchThreads: false,
		CollapsedThreads: false,
	}
	threadPosts, err := a.GetPostThread(rctx, rootId, opts, userId)
	if err != nil {
		return "", err
	}

	// 3. Collect unique user IDs and filter posts
	userIds := []string{}
	userIdMap := make(map[string]bool)
	postsList := []*model.Post{}

	for _, p := range threadPosts.Posts {
		if p.IsSystemMessage() || strings.TrimSpace(p.Message) == "" {
			continue
		}
		postsList = append(postsList, p)
		if !userIdMap[p.UserId] {
			userIdMap[p.UserId] = true
			userIds = append(userIds, p.UserId)
		}
	}

	if len(postsList) == 0 {
		return "No messages found to summarize.", nil
	}

	// Sort posts chronologically (CreateAt ascending)
	sort.Slice(postsList, func(i, j int) bool {
		return postsList[i].CreateAt < postsList[j].CreateAt
	})

	// 4. Fetch user details to get usernames
	users, err := a.GetUsersByIds(rctx, userIds, &store.UserGetByIdsOpts{IsAdmin: true})
	if err != nil {
		return "", err
	}

	usernameMap := make(map[string]string)
	for _, u := range users {
		usernameMap[u.Id] = u.Username
	}

	// 5. Format message log
	var logBuilder strings.Builder
	for _, p := range postsList {
		username := usernameMap[p.UserId]
		if username == "" {
			username = "unknown"
		}
		logBuilder.WriteString(fmt.Sprintf("@%s: %s\n", username, p.Message))
	}
	formattedHistory := logBuilder.String()

	// 6. Resolve the active OpenAI configuration (DB Agents config, then env fallback).
	openaiService, cfgErr := a.resolveOpenAIService(rctx, "SummarizeThread")
	if cfgErr != nil {
		return "", cfgErr
	}

	modelName := openaiService.DefaultModel
	if modelName == "" {
		modelName = "gpt-4o-mini"
	}

	apiURL := openaiService.ApiURL
	if apiURL == "" {
		apiURL = "https://api.openai.com/v1"
	}
	apiURL = strings.TrimSuffix(apiURL, "/") + "/chat/completions"

	// 7. Make OpenAI API Request
	requestBody, marshalErr := json.Marshal(map[string]any{
		"model": modelName,
		"messages": []map[string]string{
			{
				"role":    "system",
				"content": "You are a Mattermost thread summarizer assistant. Summarize the following discussion thread as a clear, concise bulleted list in markdown format. Do not add any introductory or concluding text, just output the bullets directly. Highlight key decisions and action items with bold text.",
			},
			{
				"role":    "user",
				"content": formattedHistory,
			},
		},
		"temperature": 0.3,
	})
	if marshalErr != nil {
		return "", model.NewAppError("SummarizeThread", "app.summarize.marshal_error", nil, marshalErr.Error(), http.StatusInternalServerError)
	}

	req, httpErr := http.NewRequestWithContext(context.Background(), "POST", apiURL, bytes.NewBuffer(requestBody))
	if httpErr != nil {
		return "", model.NewAppError("SummarizeThread", "app.summarize.http_error", nil, httpErr.Error(), http.StatusInternalServerError)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+openaiService.ApiKey)

	client := &http.Client{Timeout: 30 * time.Second}
	resp, clientErr := client.Do(req)
	if clientErr != nil {
		return "", model.NewAppError("SummarizeThread", "app.summarize.http_error", nil, clientErr.Error(), http.StatusInternalServerError)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		var errResp map[string]any
		json.NewDecoder(resp.Body).Decode(&errResp)
		detailedErr := fmt.Sprintf("OpenAI API returned status code %d", resp.StatusCode)
		if errResp != nil {
			if errMap, ok := errResp["error"].(map[string]any); ok {
				if errMsg, ok := errMap["message"].(string); ok {
					detailedErr += ": " + errMsg
				}
			}
		}
		return "", model.NewAppError("SummarizeThread", "app.summarize.api_error", nil, detailedErr, http.StatusInternalServerError)
	}

	var openAIResp struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}

	if decodeErr := json.NewDecoder(resp.Body).Decode(&openAIResp); decodeErr != nil {
		return "", model.NewAppError("SummarizeThread", "app.summarize.decode_error", nil, decodeErr.Error(), http.StatusInternalServerError)
	}

	if len(openAIResp.Choices) == 0 {
		return "", model.NewAppError("SummarizeThread", "app.summarize.api_error", nil, "OpenAI response contained no choices", http.StatusInternalServerError)
	}

	summary := strings.TrimSpace(openAIResp.Choices[0].Message.Content)
	return summary, nil
}

func (a *App) SummarizeChannelUnread(rctx request.CTX, channelId string, userId string) (string, *model.AppError) {
	// 1. Get user's last viewed timestamp for the channel
	member, err := a.GetChannelMember(rctx, channelId, userId)
	if err != nil {
		return "", err
	}
	lastViewedAt := member.LastViewedAt

	// 2. Fetch posts since lastViewedAt
	opts := model.GetPostsSinceOptions{
		ChannelId: channelId,
		Time:      lastViewedAt,
	}
	postList, err := a.GetPostsSince(rctx, opts)
	if err != nil {
		return "", err
	}

	// 3. Collect unique user IDs and filter posts
	userIds := []string{}
	userIdMap := make(map[string]bool)
	postsList := []*model.Post{}

	for _, p := range postList.Posts {
		if p.IsSystemMessage() || strings.TrimSpace(p.Message) == "" {
			continue
		}
		postsList = append(postsList, p)
		if !userIdMap[p.UserId] {
			userIdMap[p.UserId] = true
			userIds = append(userIds, p.UserId)
		}
	}

	if len(postsList) == 0 {
		return "No new unread messages to summarize.", nil
	}

	// Sort posts chronologically (CreateAt ascending)
	sort.Slice(postsList, func(i, j int) bool {
		return postsList[i].CreateAt < postsList[j].CreateAt
	})

	// 4. Fetch user details to get usernames
	users, err := a.GetUsersByIds(rctx, userIds, &store.UserGetByIdsOpts{IsAdmin: true})
	if err != nil {
		return "", err
	}

	usernameMap := make(map[string]string)
	for _, u := range users {
		usernameMap[u.Id] = u.Username
	}

	// 5. Format message log
	var logBuilder strings.Builder
	for _, p := range postsList {
		username := usernameMap[p.UserId]
		if username == "" {
			username = "unknown"
		}
		logBuilder.WriteString(fmt.Sprintf("@%s: %s\n", username, p.Message))
	}
	formattedHistory := logBuilder.String()

	// 6. Resolve the active OpenAI configuration (DB Agents config, then env fallback).
	openaiService, cfgErr := a.resolveOpenAIService(rctx, "SummarizeChannelUnread")
	if cfgErr != nil {
		return "", cfgErr
	}

	modelName := openaiService.DefaultModel
	if modelName == "" {
		modelName = "gpt-4o-mini"
	}

	apiURL := openaiService.ApiURL
	if apiURL == "" {
		apiURL = "https://api.openai.com/v1"
	}
	apiURL = strings.TrimSuffix(apiURL, "/") + "/chat/completions"

	// 7. Make OpenAI API Request
	requestBody, marshalErr := json.Marshal(map[string]any{
		"model": modelName,
		"messages": []map[string]string{
			{
				"role":    "system",
				"content": "You are a Mattermost channel catch-up assistant. Summarize the unread message history in this channel as a clear, concise bulleted list in markdown format. Highlight the main discussion topics, decisions, and action items. Do not add introductory or concluding text, just output the bullets directly. Highlight key decisions and action items with bold text.",
			},
			{
				"role":    "user",
				"content": formattedHistory,
			},
		},
		"temperature": 0.3,
	})
	if marshalErr != nil {
		return "", model.NewAppError("SummarizeChannelUnread", "app.summarize.marshal_error", nil, marshalErr.Error(), http.StatusInternalServerError)
	}

	req, httpErr := http.NewRequestWithContext(context.Background(), "POST", apiURL, bytes.NewBuffer(requestBody))
	if httpErr != nil {
		return "", model.NewAppError("SummarizeChannelUnread", "app.summarize.http_error", nil, httpErr.Error(), http.StatusInternalServerError)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+openaiService.ApiKey)

	client := &http.Client{Timeout: 30 * time.Second}
	resp, clientErr := client.Do(req)
	if clientErr != nil {
		return "", model.NewAppError("SummarizeChannelUnread", "app.summarize.http_error", nil, clientErr.Error(), http.StatusInternalServerError)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		var errResp map[string]any
		json.NewDecoder(resp.Body).Decode(&errResp)
		detailedErr := fmt.Sprintf("OpenAI API returned status code %d", resp.StatusCode)
		if errResp != nil {
			if errMap, ok := errResp["error"].(map[string]any); ok {
				if errMsg, ok := errMap["message"].(string); ok {
					detailedErr += ": " + errMsg
				}
			}
		}
		return "", model.NewAppError("SummarizeChannelUnread", "app.summarize.api_error", nil, detailedErr, http.StatusInternalServerError)
	}

	var openAIResp struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}

	if decodeErr := json.NewDecoder(resp.Body).Decode(&openAIResp); decodeErr != nil {
		return "", model.NewAppError("SummarizeChannelUnread", "app.summarize.decode_error", nil, decodeErr.Error(), http.StatusInternalServerError)
	}

	if len(openAIResp.Choices) == 0 {
		return "", model.NewAppError("SummarizeChannelUnread", "app.summarize.api_error", nil, "OpenAI response contained no choices", http.StatusInternalServerError)
	}

	summary := strings.TrimSpace(openAIResp.Choices[0].Message.Content)
	return summary, nil
}

