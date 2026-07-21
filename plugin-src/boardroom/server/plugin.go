package main

import (
	"strconv"
	"strings"
	"sync"
	"time"

	// The room's timezone turns a 09:00 booking into a real instant on Google
	// Calendar. Embedding the IANA database means that keeps working even if
	// the container image ever ships without tzdata, where LoadLocation would
	// otherwise fail silently and stop every sync.
	_ "time/tzdata"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin"
	"github.com/mattermost/mattermost/server/public/pluginapi"
)

// rawConfiguration mirrors plugin.json's settings_schema. Mattermost has no
// numeric setting type, so the hour and slot settings arrive as dropdown
// strings and are parsed into a configuration.
type rawConfiguration struct {
	OpeningHour        string `json:"OpeningHour"`
	ClosingHour        string `json:"ClosingHour"`
	SlotMinutes        string `json:"SlotMinutes"`
	NotifyOnBook       bool   `json:"NotifyOnBook"`
	EnableCalendarSync bool   `json:"EnableCalendarSync"`
	OAuthClientID      string `json:"OAuthClientID"`
	OAuthClientSecret  string `json:"OAuthClientSecret"`
	EncryptionKey      string `json:"EncryptionKey"`
	RoomTimezone       string `json:"RoomTimezone"`
	AttendeeDomain     string `json:"AttendeeDomain"`
}

// configuration is the parsed, always-usable form of the plugin settings.
type configuration struct {
	OpeningHour        int
	ClosingHour        int
	SlotMinutes        int
	NotifyOnBook       bool
	EnableCalendarSync bool
	OAuthClientID      string
	OAuthClientSecret  string
	EncryptionKey      string
	RoomTimezone       string
	AttendeeDomain     string
}

// clone guards against a reader mutating the shared configuration.
func (c *configuration) clone() *configuration {
	cloned := *c
	return &cloned
}

const (
	defaultOpeningHour = 8
	defaultClosingHour = 20
	defaultSlotMinutes = 30

	// The room is a physical place, so its timezone is a property of the room
	// and never of the server (the container runs in UTC).
	defaultRoomTimezone = "Asia/Colombo"
)

// parse turns the raw settings into a configuration, falling back to defaults
// for anything blank or nonsensical so a bad setting degrades to a usable
// calendar rather than an empty one.
func (r *rawConfiguration) parse() *configuration {
	c := &configuration{
		OpeningHour:        atoiOr(r.OpeningHour, defaultOpeningHour),
		ClosingHour:        atoiOr(r.ClosingHour, defaultClosingHour),
		SlotMinutes:        atoiOr(r.SlotMinutes, defaultSlotMinutes),
		NotifyOnBook:       r.NotifyOnBook,
		EnableCalendarSync: r.EnableCalendarSync,
		OAuthClientID:      strings.TrimSpace(r.OAuthClientID),
		OAuthClientSecret:  strings.TrimSpace(r.OAuthClientSecret),
		EncryptionKey:      r.EncryptionKey,
		RoomTimezone:       strings.TrimSpace(r.RoomTimezone),
		AttendeeDomain:     strings.TrimSpace(r.AttendeeDomain),
	}

	// An unreadable timezone would silently shift every synced event, so fall
	// back to a known-good zone rather than to UTC.
	if c.RoomTimezone == "" {
		c.RoomTimezone = defaultRoomTimezone
	}
	if _, err := time.LoadLocation(c.RoomTimezone); err != nil {
		c.RoomTimezone = defaultRoomTimezone
	}

	if c.SlotMinutes <= 0 || c.SlotMinutes > 240 || 60%c.SlotMinutes != 0 {
		c.SlotMinutes = defaultSlotMinutes
	}
	if c.OpeningHour < 0 || c.OpeningHour > 23 {
		c.OpeningHour = defaultOpeningHour
	}
	if c.ClosingHour < 1 || c.ClosingHour > 24 {
		c.ClosingHour = defaultClosingHour
	}
	// An inverted day would leave nothing bookable at all.
	if c.ClosingHour <= c.OpeningHour {
		c.OpeningHour = defaultOpeningHour
		c.ClosingHour = defaultClosingHour
	}
	return c
}

func atoiOr(s string, fallback int) int {
	n, err := strconv.Atoi(strings.TrimSpace(s))
	if err != nil {
		return fallback
	}
	return n
}

type Plugin struct {
	plugin.MattermostPlugin

	client *pluginapi.Client
	store  *store
	botID  string

	configurationLock sync.RWMutex
	configuration     *configuration

	syncRunnerLock sync.Mutex
	syncRunner     *syncRunner
}

func (p *Plugin) getConfiguration() *configuration {
	p.configurationLock.RLock()
	defer p.configurationLock.RUnlock()

	if p.configuration == nil {
		return (&rawConfiguration{}).parse()
	}
	return p.configuration.clone()
}

func (p *Plugin) OnConfigurationChange() error {
	raw := &rawConfiguration{}
	if err := p.API.LoadPluginConfiguration(raw); err != nil {
		return err
	}

	p.configurationLock.Lock()
	p.configuration = raw.parse()
	p.configurationLock.Unlock()

	p.startBackgroundSync()
	return nil
}

func (p *Plugin) OnActivate() error {
	p.client = pluginapi.NewClient(p.API, p.Driver)
	p.store = newStore(&p.client.KV)

	botID, err := p.client.Bot.EnsureBot(&model.Bot{
		Username:    "boardroom",
		DisplayName: "Board Room",
		Description: "Notifies you about board room bookings.",
	})
	if err != nil {
		return err
	}
	p.botID = botID

	p.startBackgroundSync()
	return nil
}

func (p *Plugin) OnDeactivate() error {
	p.stopBackgroundSync()
	return nil
}

func main() {
	plugin.ClientMain(&Plugin{})
}
