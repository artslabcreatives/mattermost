package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin"
)

type configuration struct {
	LicenseKey      string
	Enabled         bool
	Snow            bool
	Santa           bool
	Gifts           bool
	Snowman         bool
	Sound           bool
	SnowDensity     int
	SantaMinSeconds int
	SantaMaxSeconds int
	GiftGreetings   bool
	GiftMessages    string
	JustKidding     bool
	Tree            bool
	Wishes          bool
	StartDate       string
	EndDate         string
}

// defaultGiftMessages must match the GiftMessages default in plugin.json.
const defaultGiftMessages = `You got a special leave day! 🏖️ | Enjoy your extra day off.
You got a half-day leave! 🕐 | You can leave at lunch today.
You got a salary increment! 💰 | It will show on your next payslip.
You have been promoted! 🚀 | Your new title starts on Monday.
You got a year-end bonus! 🎉 | Santa approved it personally.
You got work-from-home for a month! 🏠 | Pyjamas are the new dress code.
Free lunch on the company today! 🍕 | Order whatever you like.
You got an extra week of holidays! 🎄 | Your calendar is all yours.`

func defaults() configuration {
	return configuration{
		Enabled: true, Snow: true, Santa: true, Gifts: true, Snowman: true, Sound: true, SnowDensity: 60, SantaMinSeconds: 30, SantaMaxSeconds: 90,
		GiftGreetings: true, GiftMessages: defaultGiftMessages, JustKidding: true, Tree: true, Wishes: true,
	}
}

func (c *configuration) validate() error {
	c.StartDate, c.EndDate = strings.TrimSpace(c.StartDate), strings.TrimSpace(c.EndDate)
	for _, date := range []string{c.StartDate, c.EndDate} {
		if date != "" {
			if _, err := time.Parse("2006-01-02", date); err != nil {
				return fmt.Errorf("Christmas Magic dates must use YYYY-MM-DD: %w", err)
			}
		}
	}
	if c.StartDate != "" && c.EndDate != "" && c.StartDate > c.EndDate {
		return fmt.Errorf("Christmas Magic end date must be on or after start date")
	}
	c.SnowDensity = min(150, max(0, c.SnowDensity))
	c.SantaMinSeconds = min(3600, max(30, c.SantaMinSeconds))
	c.SantaMaxSeconds = min(3600, max(c.SantaMinSeconds, c.SantaMaxSeconds))
	return nil
}

// public is the configuration as sent to every user's browser: without the license key.
func (c configuration) public() configuration {
	c.LicenseKey = ""
	return c
}

// payload converts the configuration to gob-encodable values. Plugin RPC cannot encode this
// package's struct inside a map[string]any; the failed write corrupts the API connection
// and the next API call never returns, which blocks plugin activation and server startup.
func (c configuration) payload() (map[string]any, error) {
	data, err := json.Marshal(c.public())
	if err != nil {
		return nil, err
	}
	var settings map[string]any
	return settings, json.Unmarshal(data, &settings)
}

type Plugin struct {
	plugin.MattermostPlugin
	mu     sync.RWMutex
	config configuration

	activated     bool   // OnActivate passed the license check.
	licensedKey   string // The key that check accepted; re-checked only when it changes.
	licenseURL    string // Overrides LicenseServerURL in tests.
	licenseClient *http.Client
}

func (p *Plugin) OnActivate() error {
	if err := p.OnConfigurationChange(); err != nil {
		return err
	}
	p.mu.RLock()
	key := strings.TrimSpace(p.config.LicenseKey)
	p.mu.RUnlock()

	// Enforce the one-server license; returning an error keeps Mattermost from enabling the plugin.
	valid, message := p.CheckAndActivateLicense(key)
	if !valid {
		p.API.LogError("Mattermost Christmas Magic failed to start", "reason", message)
		return fmt.Errorf("license error: %s", message)
	}
	p.mu.Lock()
	p.activated, p.licensedKey = true, key
	p.mu.Unlock()
	p.API.LogInfo("Mattermost Christmas Magic activated successfully!", "license", message)
	return p.registerCommand()
}

func (p *Plugin) OnConfigurationChange() error {
	cfg := defaults()
	if err := p.API.LoadPluginConfiguration(&cfg); err != nil {
		return err
	}
	if err := cfg.validate(); err != nil {
		// Fail closed rather than leaving old animations running after an invalid schedule.
		cfg.Enabled = false
		p.API.LogWarn("Christmas Magic disabled because its configuration is invalid", "error", err.Error())
	}
	key := strings.TrimSpace(cfg.LicenseKey)
	p.mu.Lock()
	p.config = cfg
	// Mattermost calls this on many configuration saves; only a changed key needs the license server.
	recheck := p.activated && key != p.licensedKey
	p.mu.Unlock()
	if recheck {
		if valid, message := p.CheckAndActivateLicense(key); valid {
			p.mu.Lock()
			p.licensedKey = key
			p.mu.Unlock()
		} else {
			p.API.LogWarn("Christmas Magic license status", "message", message)
		}
	}
	settings, err := cfg.payload()
	if err != nil {
		return err
	}
	p.API.PublishWebSocketEvent("configuration", map[string]any{"settings": settings}, &model.WebsocketBroadcast{})
	return nil
}

// ServeHTTP serves, to signed-in users only:
//
//	GET    /configuration  the animation settings
//	GET    /wishes         all saved Christmas wishes, oldest first
//	DELETE /wishes/{id}    remove one wish (system admins)
//	DELETE /wishes         remove every wish (system admins)
func (p *Plugin) ServeHTTP(_ *plugin.Context, w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("Mattermost-User-Id")
	if userID == "" {
		http.Error(w, "Authentication required", http.StatusUnauthorized)
		return
	}
	path := r.URL.Path
	switch {
	case path == "/configuration" && r.Method == http.MethodGet:
		p.mu.RLock()
		cfg := p.config
		p.mu.RUnlock()
		writeJSON(w, cfg.public())
	case path == "/wishes" && r.Method == http.MethodGet:
		list, _, err := p.loadWishes()
		if err != nil {
			http.Error(w, "Could not load wishes", http.StatusInternalServerError)
			return
		}
		writeJSON(w, list)
	case (path == "/wishes" || strings.HasPrefix(path, "/wishes/")) && r.Method == http.MethodDelete:
		if !p.API.HasPermissionTo(userID, model.PermissionManageSystem) {
			http.Error(w, "Only system administrators can remove wishes", http.StatusForbidden)
			return
		}
		id := strings.TrimPrefix(strings.TrimPrefix(path, "/wishes"), "/")
		if err := p.updateWishes(func(list []wish) []wish {
			if id == "" {
				return []wish{}
			}
			kept := list[:0]
			for _, item := range list {
				if item.ID != id {
					kept = append(kept, item)
				}
			}
			return kept
		}); err != nil {
			http.Error(w, "Could not remove wishes", http.StatusInternalServerError)
			return
		}
		p.API.PublishWebSocketEvent("wishes_removed", map[string]any{"id": id}, &model.WebsocketBroadcast{})
		w.WriteHeader(http.StatusNoContent)
	case path == "/configuration":
		methodNotAllowed(w, http.MethodGet)
	case path == "/wishes" || strings.HasPrefix(path, "/wishes/"):
		methodNotAllowed(w, http.MethodGet+", "+http.MethodDelete)
	default:
		http.NotFound(w, r)
	}
}

func methodNotAllowed(w http.ResponseWriter, allow string) {
	w.Header().Set("Allow", allow)
	http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
}

func writeJSON(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(value)
}

func main() { plugin.ClientMain(&Plugin{}) }
