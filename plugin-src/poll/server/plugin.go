package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin"
)

type Plugin struct {
	plugin.MattermostPlugin
}

const (
	CommandTrigger = "poll"
	PostTypePoll   = "custom_poll"
	ManifestID     = "com.artslabcreatives.poll"
)

func (p *Plugin) OnActivate() error {
	return p.API.RegisterCommand(&model.Command{
		Trigger:          CommandTrigger,
		AutoComplete:     true,
		AutoCompleteDesc: "Create a WhatsApp-style poll with custom options",
		AutoCompleteHint: "",
		DisplayName:      "Poll",
	})
}

func (p *Plugin) ExecuteCommand(c *plugin.Context, args *model.CommandArgs) (*model.CommandResponse, *model.AppError) {
	cmdInput := strings.TrimSpace(strings.TrimPrefix(args.Command, "/"+CommandTrigger))

	// If no arguments or user typed /poll, trigger WebSocket to open custom React CreatePollModal
	if cmdInput == "" {
		p.API.PublishWebSocketEvent("open_create_poll_modal", map[string]interface{}{
			"channel_id": args.ChannelId,
		}, &model.WebsocketBroadcast{UserId: args.UserId})
		return &model.CommandResponse{}, nil
	}

	parts := parseCommandArgs(cmdInput)
	if len(parts) < 3 {
		p.API.PublishWebSocketEvent("open_create_poll_modal", map[string]interface{}{
			"channel_id": args.ChannelId,
		}, &model.WebsocketBroadcast{UserId: args.UserId})
		return &model.CommandResponse{}, nil
	}

	question := parts[0]
	options := parts[1:]

	pollID := model.NewId()
	poll := NewPoll(pollID, args.UserId, args.ChannelId, question, options, false, model.GetMillis())

	if err := p.saveAndPostPoll(poll, args.ChannelId); err != nil {
		return &model.CommandResponse{
			ResponseType: model.CommandResponseTypeEphemeral,
			Text:         "Failed to create poll: " + err.Error(),
		}, nil
	}

	return &model.CommandResponse{}, nil
}

func (p *Plugin) ServeHTTP(c *plugin.Context, w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	path := r.URL.Path
	if idx := strings.Index(path, "/api/v1/polls/"); idx != -1 {
		path = path[idx:]
	}

	switch path {
	case "/api/v1/polls/create", "/api/v1/polls/create/":
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		p.handleCreatePoll(c, w, r)
	case "/api/v1/polls/vote", "/api/v1/polls/vote/":
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		p.handleVote(c, w, r)
	case "/api/v1/polls/end", "/api/v1/polls/end/":
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		p.handleEndPoll(c, w, r)
	case "/api/v1/polls/delete", "/api/v1/polls/delete/":
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		p.handleDeletePoll(c, w, r)
	case "/api/v1/polls/edit", "/api/v1/polls/edit/":
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		p.handleEditPoll(c, w, r)
	default:
		p.API.LogError("Poll route not found", "rawPath", r.URL.Path, "parsedPath", path)
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{
			"error":      "Route not found",
			"rawPath":    r.URL.Path,
			"parsedPath": path,
		})
	}
}

func (p *Plugin) getUserID(c *plugin.Context, r *http.Request) string {
	userID := r.Header.Get("Mattermost-User-ID")
	if userID != "" {
		return userID
	}
	userID = r.Header.Get("Mattermost-User-Id")
	if userID != "" {
		return userID
	}
	if c != nil && c.SessionId != "" {
		session, appErr := p.API.GetSession(c.SessionId)
		if appErr == nil && session != nil {
			return session.UserId
		}
	}
	return ""
}

type DialogSubmitRequest struct {
	UserId    string                 `json:"user_id"`
	ChannelId string                 `json:"channel_id"`
	Submission map[string]interface{} `json:"submission"`
}

func (p *Plugin) handleCreatePoll(c *plugin.Context, w http.ResponseWriter, r *http.Request) {
	userID := p.getUserID(c, r)

	var req DialogSubmitRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		p.respondError(w, http.StatusBadRequest, "Invalid payload")
		return
	}

	if userID == "" {
		userID = req.UserId
	}

	question, _ := req.Submission["question"].(string)
	question = strings.TrimSpace(question)
	if question == "" {
		p.respondError(w, http.StatusBadRequest, "Question is required")
		return
	}

	var options []string
	for i := 0; i < 20; i++ {
		optKey := fmt.Sprintf("option_%d", i)
		if val, ok := req.Submission[optKey].(string); ok {
			val = strings.TrimSpace(val)
			if val != "" {
				options = append(options, val)
			}
		}
	}

	if len(options) < 2 {
		p.respondError(w, http.StatusBadRequest, "Please provide at least 2 options")
		return
	}

	multiple := false
	if mVal, ok := req.Submission["multiple"].(bool); ok {
		multiple = mVal
	} else if mStr, ok := req.Submission["multiple"].(string); ok {
		multiple = mStr == "true"
	}

	pollID := model.NewId()
	poll := NewPoll(pollID, userID, req.ChannelId, question, options, multiple, model.GetMillis())

	if err := p.saveAndPostPoll(poll, req.ChannelId); err != nil {
		p.respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte("{}"))
}

type VoteRequest struct {
	PollID    string `json:"poll_id"`
	OptionIdx string `json:"option_idx"`
}

func (p *Plugin) handleVote(c *plugin.Context, w http.ResponseWriter, r *http.Request) {
	userID := p.getUserID(c, r)
	if userID == "" {
		p.respondError(w, http.StatusUnauthorized, "Unauthorized: missing user session")
		return
	}

	var req VoteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		p.respondError(w, http.StatusBadRequest, "Invalid payload")
		return
	}

	poll, err := p.getPoll(req.PollID)
	if err != nil || poll == nil {
		p.respondError(w, http.StatusNotFound, "Poll not found")
		return
	}

	if poll.Ended {
		p.respondError(w, http.StatusBadRequest, "Poll has ended")
		return
	}

	poll.Vote(userID, req.OptionIdx)

	if err := p.updatePoll(poll); err != nil {
		p.respondError(w, http.StatusInternalServerError, "Failed to update poll")
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(poll)
}

type ActionRequest struct {
	PollID string `json:"poll_id"`
}

func (p *Plugin) handleEndPoll(c *plugin.Context, w http.ResponseWriter, r *http.Request) {
	userID := p.getUserID(c, r)
	if userID == "" {
		p.respondError(w, http.StatusUnauthorized, "Unauthorized: missing user session")
		return
	}

	var req ActionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		p.respondError(w, http.StatusBadRequest, "Invalid payload")
		return
	}

	poll, err := p.getPoll(req.PollID)
	if err != nil || poll == nil {
		p.respondError(w, http.StatusNotFound, "Poll not found")
		return
	}

	// SECURITY CHECK: Only Poll Creator or System Admin can end poll
	if !p.isCreatorOrAdmin(userID, poll) {
		p.respondError(w, http.StatusForbidden, "Only the poll creator can end this poll")
		return
	}

	poll.Ended = true
	if err := p.updatePoll(poll); err != nil {
		p.respondError(w, http.StatusInternalServerError, "Failed to end poll")
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(poll)
}

func (p *Plugin) handleDeletePoll(c *plugin.Context, w http.ResponseWriter, r *http.Request) {
	userID := p.getUserID(c, r)
	if userID == "" {
		p.respondError(w, http.StatusUnauthorized, "Unauthorized: missing user session")
		return
	}

	var req ActionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		p.respondError(w, http.StatusBadRequest, "Invalid payload")
		return
	}

	poll, err := p.getPoll(req.PollID)
	if err != nil || poll == nil {
		p.respondError(w, http.StatusNotFound, "Poll not found")
		return
	}

	// SECURITY CHECK: Only Poll Creator or System Admin can delete poll
	if !p.isCreatorOrAdmin(userID, poll) {
		p.respondError(w, http.StatusForbidden, "Only the poll creator can delete this poll")
		return
	}

	// Delete Post from Mattermost
	if appErr := p.API.DeletePost(poll.ID); appErr != nil {
		p.API.LogError("Failed to delete poll post", "err", appErr.Error())
	}

	// Delete from KVStore
	p.API.KVDelete("poll_" + poll.ID)

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"deleted"}`))
}

type EditPollRequest struct {
	PollID   string   `json:"poll_id"`
	Question string   `json:"question"`
	Options  []string `json:"options"`
	Multiple bool     `json:"multiple"`
}

func (p *Plugin) handleEditPoll(c *plugin.Context, w http.ResponseWriter, r *http.Request) {
	userID := p.getUserID(c, r)
	if userID == "" {
		p.respondError(w, http.StatusUnauthorized, "Unauthorized: missing user session")
		return
	}

	var req EditPollRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		p.respondError(w, http.StatusBadRequest, "Invalid payload")
		return
	}

	poll, err := p.getPoll(req.PollID)
	if err != nil || poll == nil {
		p.respondError(w, http.StatusNotFound, "Poll not found")
		return
	}

	if !p.isCreatorOrAdmin(userID, poll) {
		p.respondError(w, http.StatusForbidden, "Only the poll creator can edit this poll")
		return
	}

	if poll.Ended {
		p.respondError(w, http.StatusBadRequest, "Cannot edit an ended poll")
		return
	}

	question := strings.TrimSpace(req.Question)
	if question != "" {
		poll.Question = question
	}

	if len(req.Options) >= 2 {
		var cleanOpts []string
		for _, o := range req.Options {
			o = strings.TrimSpace(o)
			if o != "" {
				cleanOpts = append(cleanOpts, o)
			}
		}
		if len(cleanOpts) >= 2 {
			poll.Options = cleanOpts
			// Rebuild votes map for new options
			newVotes := make(map[string][]string)
			for i := range cleanOpts {
				key := fmt.Sprintf("%d", i)
				if existing, ok := poll.Votes[key]; ok {
					newVotes[key] = existing
				} else {
					newVotes[key] = []string{}
				}
			}
			poll.Votes = newVotes
		}
	}

	poll.Multiple = req.Multiple

	if err := p.updatePoll(poll); err != nil {
		p.respondError(w, http.StatusInternalServerError, "Failed to update poll")
		return
	}

	// Also update the post message
	post, appErr := p.API.GetPost(poll.ID)
	if appErr == nil && post != nil {
		post.Message = generatePollFallback(poll)
		p.API.UpdatePost(post)
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(poll)
}

func (p *Plugin) isCreatorOrAdmin(userID string, poll *Poll) bool {
	if poll.UserID == userID {
		return true
	}
	user, err := p.API.GetUser(userID)
	if err == nil && user != nil && user.IsInRole(model.SystemAdminRoleId) {
		return true
	}
	return false
}

func (p *Plugin) saveAndPostPoll(poll *Poll, channelID string) error {
	pBytes, err := poll.Bytes()
	if err != nil {
		return err
	}

	var pollMap map[string]interface{}
	if err := json.Unmarshal(pBytes, &pollMap); err != nil {
		return err
	}

	post := &model.Post{
		UserId:    poll.UserID,
		ChannelId: channelID,
		Message:   generatePollFallback(poll),
		Type:      PostTypePoll,
		Props: model.StringInterface{
			"poll": pollMap,
		},
	}

	createdPost, appErr := p.API.CreatePost(post)
	if appErr != nil {
		return fmt.Errorf("failed to create post: %s", appErr.Error())
	}
	if createdPost == nil {
		return fmt.Errorf("create post returned nil")
	}

	poll.ID = createdPost.Id
	pollMap["id"] = createdPost.Id

	pBytesUpdated, _ := poll.Bytes()
	p.API.KVSet("poll_"+poll.ID, pBytesUpdated)

	// Update post props with final poll.id
	createdPost.Props["poll"] = pollMap
	p.API.UpdatePost(createdPost)

	return nil
}

func (p *Plugin) getPoll(pollID string) (*Poll, error) {
	b, appErr := p.API.KVGet("poll_" + pollID)
	if appErr != nil || b == nil {
		return nil, fmt.Errorf("poll not found")
	}
	return PollFromBytes(b)
}

func (p *Plugin) updatePoll(poll *Poll) error {
	b, err := poll.Bytes()
	if err != nil {
		return err
	}
	if appErr := p.API.KVSet("poll_"+poll.ID, b); appErr != nil {
		return appErr
	}

	var pollMap map[string]interface{}
	if err := json.Unmarshal(b, &pollMap); err != nil {
		return err
	}

	post, appErr := p.API.GetPost(poll.ID)
	if appErr == nil && post != nil {
		if post.Props == nil {
			post.Props = make(model.StringInterface)
		}
		post.Props["poll"] = pollMap
		post.Message = generatePollFallback(poll)
		p.API.UpdatePost(post)
	}

	return nil
}

func generatePollFallback(poll *Poll) string {
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("📊 **Poll:** %s\n\n", poll.Question))
	
	totalVotes := poll.TotalVotes()
	
	for i, opt := range poll.Options {
		optKey := fmt.Sprintf("%d", i)
		votes := len(poll.Votes[optKey])
		percentage := 0
		if totalVotes > 0 {
			percentage = (votes * 100) / totalVotes
		}
		sb.WriteString(fmt.Sprintf("- **%s**: %d votes (%d%%)\n", opt, votes, percentage))
	}
	
	sb.WriteString(fmt.Sprintf("\n*Total voters: %d*", totalVotes))
	if poll.Ended {
		sb.WriteString(" • **(Ended)**")
	}
	
	return sb.String()
}

func (p *Plugin) respondError(w http.ResponseWriter, code int, msg string) {
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func parseCommandArgs(input string) []string {
	var args []string
	var current strings.Builder
	inQuotes := false

	for _, r := range input {
		switch r {
		case '"':
			inQuotes = !inQuotes
		case ' ':
			if inQuotes {
				current.WriteRune(r)
			} else if current.Len() > 0 {
				args = append(args, current.String())
				current.Reset()
			}
		default:
			current.WriteRune(r)
		}
	}
	if current.Len() > 0 {
		args = append(args, current.String())
	}
	return args
}

func main() {
	plugin.ClientMain(&Plugin{})
}
