package main

import (
	"encoding/json"
	"net/http"
	"strings"
	"sync"

	"github.com/mattermost/mattermost/server/public/plugin"
)

type Plugin struct {
	plugin.MattermostPlugin

	configurationLock sync.RWMutex
	configuration     *configuration
}

type configuration struct {
	AllowAllUsers  bool   `json:"AllowAllUsers"`
	AllowedUserIDs string `json:"AllowedUserIDs"`
}

func (p *Plugin) OnConfigurationChange() error {
	var config configuration
	if err := p.API.LoadPluginConfiguration(&config); err != nil {
		return err
	}

	p.configurationLock.Lock()
	p.configuration = &config
	p.configurationLock.Unlock()

	return nil
}

func (p *Plugin) getConfiguration() *configuration {
	p.configurationLock.RLock()
	defer p.configurationLock.RUnlock()
	if p.configuration == nil {
		return &configuration{AllowAllUsers: true}
	}
	return p.configuration
}

func (p *Plugin) ServeHTTP(c *plugin.Context, w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	switch r.URL.Path {
	case "/api/v1/check-access":
		p.handleCheckAccess(w, r)
	default:
		http.NotFound(w, r)
	}
}

func (p *Plugin) handleCheckAccess(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("Mattermost-User-Id")
	if userID == "" {
		_ = json.NewEncoder(w).Encode(map[string]bool{"allowed": false})
		return
	}

	cfg := p.getConfiguration()
	if cfg.AllowAllUsers {
		_ = json.NewEncoder(w).Encode(map[string]bool{"allowed": true})
		return
	}

	allowedList := strings.Split(cfg.AllowedUserIDs, ",")
	for _, entry := range allowedList {
		cleaned := strings.TrimSpace(entry)
		cleaned = strings.TrimPrefix(cleaned, "@")
		if cleaned == "" {
			continue
		}
		if strings.EqualFold(cleaned, userID) {
			_ = json.NewEncoder(w).Encode(map[string]bool{"allowed": true})
			return
		}
	}

	user, err := p.API.GetUser(userID)
	if err == nil && user != nil {
		for _, entry := range allowedList {
			cleaned := strings.TrimSpace(entry)
			cleaned = strings.TrimPrefix(cleaned, "@")
			if cleaned == "" {
				continue
			}
			if strings.EqualFold(cleaned, user.Username) {
				_ = json.NewEncoder(w).Encode(map[string]bool{"allowed": true})
				return
			}
		}
	}

	_ = json.NewEncoder(w).Encode(map[string]bool{"allowed": false})
}
