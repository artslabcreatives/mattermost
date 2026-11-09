package main

import (
	"encoding/gob"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin"
)

func TestConfiguration(t *testing.T) {
	for _, dates := range [][2]string{{"2026-02-30", ""}, {"2026-12-30", "2026-12-01"}, {"12-01", ""}} {
		cfg := defaults()
		cfg.StartDate, cfg.EndDate = dates[0], dates[1]
		if cfg.validate() == nil {
			t.Errorf("accepted invalid dates %v", dates)
		}
	}
	cfg := defaults()
	cfg.SnowDensity, cfg.SantaMinSeconds, cfg.SantaMaxSeconds = 10000, 0, -1
	if err := cfg.validate(); err != nil {
		t.Fatal(err)
	}
	if cfg.SnowDensity != 150 || cfg.SantaMinSeconds != 30 || cfg.SantaMaxSeconds != 30 {
		t.Fatalf("unbounded config: %+v", cfg)
	}
}

func TestConfigurationEventEncodesOverRPC(t *testing.T) {
	settings, err := defaults().payload()
	if err != nil {
		t.Fatal(err)
	}
	args := &plugin.Z_PublishWebSocketEventArgs{A: "configuration", B: map[string]any{"settings": settings}, C: &model.WebsocketBroadcast{}}
	if err := gob.NewEncoder(io.Discard).Encode(args); err != nil {
		t.Fatalf("plugin RPC cannot encode the configuration event: %v", err)
	}
	if settings["Enabled"] != true || settings["SnowDensity"] != float64(60) {
		t.Fatalf("unexpected settings payload: %v", settings)
	}
}

func TestConfigurationEndpoint(t *testing.T) {
	p := &Plugin{config: defaults()}
	for _, tc := range []struct {
		method, path, user string
		want               int
	}{
		{"GET", "/configuration", "", 401},
		{"POST", "/configuration", "user", 405},
		{"GET", "/unknown", "user", 404},
		{"GET", "/configuration", "user", 200},
	} {
		r := httptest.NewRequest(tc.method, tc.path, nil)
		r.Header.Set("Mattermost-User-Id", tc.user)
		w := httptest.NewRecorder()
		p.ServeHTTP(nil, w, r)
		if w.Code != tc.want {
			t.Errorf("%s %s: got %d, want %d", tc.method, tc.path, w.Code, tc.want)
		}
		if w.Code == http.StatusOK && w.Header().Get("Cache-Control") != "no-store" {
			t.Error("configuration must not be cached")
		}
	}
}
