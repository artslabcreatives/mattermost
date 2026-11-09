package main

import (
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin"
)

const (
	commandTrigger = "christmas"
	wishesKey      = "wishes"
	maxWishes      = 500
	maxWishLength  = 200
	wishCooldownMs = 30 * 1000
)

type wish struct {
	ID       string `json:"id"`
	UserID   string `json:"user_id"`
	Name     string `json:"name"`
	Message  string `json:"message"`
	CreateAt int64  `json:"create_at"`
}

// payload uses only gob-encodable values; see configuration.payload.
func (w wish) payload() map[string]any {
	return map[string]any{"id": w.ID, "user_id": w.UserID, "name": w.Name, "message": w.Message, "create_at": w.CreateAt}
}

// wishText extracts the wish from "/christmas <wish>", folding line breaks and capping its length.
func wishText(command string) string {
	_, text, _ := strings.Cut(strings.TrimSpace(command), " ")
	text = strings.Join(strings.Fields(text), " ")
	if utf8.RuneCountInString(text) > maxWishLength {
		text = string([]rune(text)[:maxWishLength-1]) + "…"
	}
	return text
}

func (p *Plugin) loadWishes() ([]wish, []byte, error) {
	data, appErr := p.API.KVGet(wishesKey)
	if appErr != nil {
		return nil, nil, appErr
	}
	list := []wish{}
	if len(data) > 0 {
		if err := json.Unmarshal(data, &list); err != nil {
			return nil, nil, err
		}
	}
	return list, data, nil
}

// updateWishes applies change with compare-and-set so concurrent wishes are never lost.
func (p *Plugin) updateWishes(change func([]wish) []wish) error {
	for range 5 {
		list, old, err := p.loadWishes()
		if err != nil {
			return err
		}
		next, err := json.Marshal(change(list))
		if err != nil {
			return err
		}
		ok, appErr := p.API.KVCompareAndSet(wishesKey, old, next)
		if appErr != nil {
			return appErr
		}
		if ok {
			return nil
		}
	}
	return errors.New("the wish list kept changing; giving up")
}

func (p *Plugin) registerCommand() error {
	return p.API.RegisterCommand(&model.Command{
		Trigger:          commandTrigger,
		DisplayName:      "Christmas wish",
		AutoComplete:     true,
		AutoCompleteDesc: "Hang your Christmas wish on the tree for everyone to see",
		AutoCompleteHint: "[your wish]",
	})
}

func (p *Plugin) ExecuteCommand(_ *plugin.Context, args *model.CommandArgs) (*model.CommandResponse, *model.AppError) {
	reply := func(text string) (*model.CommandResponse, *model.AppError) {
		return &model.CommandResponse{ResponseType: model.CommandResponseTypeEphemeral, Text: text}, nil
	}
	p.mu.RLock()
	cfg := p.config
	p.mu.RUnlock()
	if !cfg.Enabled || !cfg.Tree || !cfg.Wishes {
		return reply("Christmas wishes are turned off right now.")
	}
	message := wishText(args.Command)
	if message == "" {
		return reply("Type your wish after the command, for example: `/christmas Happy holidays, everyone!`")
	}

	now := model.GetMillis()
	cooldownKey := "cooldown-" + args.UserId
	if last, appErr := p.API.KVGet(cooldownKey); appErr == nil && last != nil {
		if at, err := strconv.ParseInt(string(last), 10, 64); err == nil && now-at < wishCooldownMs {
			return reply("The tree is still showing your last wish. Please try again in a few seconds.")
		}
	}

	name := "Someone"
	if user, appErr := p.API.GetUser(args.UserId); appErr == nil {
		name = firstNonEmpty(user.FirstName, user.Nickname, user.Username)
	}
	w := wish{ID: model.NewId(), UserID: args.UserId, Name: name, Message: message, CreateAt: now}
	if err := p.updateWishes(func(list []wish) []wish {
		list = append(list, w)
		return list[max(0, len(list)-maxWishes):]
	}); err != nil {
		p.API.LogError("Failed to save Christmas wish", "error", err.Error())
		return reply("Sorry, your wish could not be saved. Please try again.")
	}
	_ = p.API.KVSet(cooldownKey, []byte(strconv.FormatInt(now, 10)))
	p.API.PublishWebSocketEvent("wish", map[string]any{"wish": w.payload()}, &model.WebsocketBroadcast{})
	return reply("🎄 Your wish is on the Christmas tree for everyone to see!")
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return "Someone"
}
