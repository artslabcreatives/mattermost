package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin/plugintest"
	"github.com/stretchr/testify/mock"
)

// fakeLicenseServer answers verify/activate with the given status code and body per path.
func fakeLicenseServer(t *testing.T, replies map[string]func(LicenseRequest) (int, LicenseResponse)) *httptest.Server {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request LicenseRequest
		_ = json.NewDecoder(r.Body).Decode(&request)
		if request.AppId != LicenseAppID || request.MachineId != "diag-1" {
			t.Errorf("unexpected request %+v", request)
		}
		reply, ok := replies[r.URL.Path]
		if !ok {
			t.Errorf("unexpected call to %s", r.URL.Path)
			return
		}
		code, body := reply(request)
		w.WriteHeader(code)
		_ = json.NewEncoder(w).Encode(body)
	}))
	t.Cleanup(server.Close)
	return server
}

func newLicensePlugin(t *testing.T, url string) (*Plugin, *plugintest.API) {
	api := &plugintest.API{}
	siteURL := "https://chat.example.com"
	api.On("GetConfig").Return(&model.Config{ServiceSettings: model.ServiceSettings{SiteURL: &siteURL}}).Maybe()
	api.On("GetDiagnosticId").Return("diag-1").Maybe()
	api.On("LogError", mock.Anything, mock.Anything, mock.Anything).Maybe()
	api.On("LogWarn", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything).Maybe()
	p := &Plugin{config: defaults(), licenseURL: url, licenseClient: &http.Client{Timeout: 2 * time.Second}}
	p.SetAPI(api)
	return p, api
}

func TestLicenseMissingKey(t *testing.T) {
	p, _ := newLicensePlugin(t, "http://127.0.0.1:1")
	if valid, message := p.CheckAndActivateLicense("  "); valid || !strings.Contains(message, "missing") {
		t.Fatalf("got %v %q", valid, message)
	}
}

func TestLicenseVerifiedAndActivated(t *testing.T) {
	invalid := func(LicenseRequest) (int, LicenseResponse) {
		return http.StatusNotFound, LicenseResponse{Status: "not_activated", Message: "Not activated"}
	}
	for name, tc := range map[string]struct {
		replies map[string]func(LicenseRequest) (int, LicenseResponse)
		valid   bool
		message string
	}{
		"already active here": {map[string]func(LicenseRequest) (int, LicenseResponse){
			"/api/license/verify": func(LicenseRequest) (int, LicenseResponse) { return http.StatusOK, LicenseResponse{Valid: true} },
		}, true, "License verified"},
		"first activation": {map[string]func(LicenseRequest) (int, LicenseResponse){
			"/api/license/verify": invalid,
			"/api/license/activate": func(r LicenseRequest) (int, LicenseResponse) {
				if r.MachineName != "https://chat.example.com" {
					t.Errorf("machine name %q", r.MachineName)
				}
				return http.StatusOK, LicenseResponse{Valid: true}
			},
		}, true, "successfully activated"},
		"used on another server": {map[string]func(LicenseRequest) (int, LicenseResponse){
			"/api/license/verify": invalid,
			"/api/license/activate": func(LicenseRequest) (int, LicenseResponse) {
				return http.StatusForbidden, LicenseResponse{Status: "max_activations_reached"}
			},
		}, false, "already in use by another Mattermost server"},
		"unknown key": {map[string]func(LicenseRequest) (int, LicenseResponse){
			"/api/license/verify": invalid,
			"/api/license/activate": func(LicenseRequest) (int, LicenseResponse) {
				return http.StatusNotFound, LicenseResponse{Status: "not_found", Message: "Invalid license key"}
			},
		}, false, "License validation failed: Invalid license key"},
	} {
		t.Run(name, func(t *testing.T) {
			p, api := newLicensePlugin(t, fakeLicenseServer(t, tc.replies).URL)
			api.On("KVSet", licenseKVKey, mock.Anything).Return((*model.AppError)(nil)).Maybe()
			valid, message := p.CheckAndActivateLicense(" MMXMAS-AAAA-BBBB-CCCC-DDDD ")
			if valid != tc.valid || !strings.Contains(message, tc.message) {
				t.Fatalf("got %v %q, want %v %q", valid, message, tc.valid, tc.message)
			}
		})
	}
}

func TestLicenseServerOutageGrace(t *testing.T) {
	key := "MMXMAS-AAAA-BBBB-CCCC-DDDD"
	record := func(age time.Duration) []byte {
		data, _ := json.Marshal(licenseRecord{KeyHash: hashKey(key), MachineID: "diag-1", VerifiedAt: time.Now().Add(-age).UnixMilli()})
		return data
	}
	for name, tc := range map[string]struct {
		stored []byte
		valid  bool
	}{
		"verified yesterday": {record(24 * time.Hour), true},
		"verified long ago":  {record(30 * 24 * time.Hour), false},
		"never verified":     {nil, false},
	} {
		t.Run(name, func(t *testing.T) {
			p, api := newLicensePlugin(t, "http://127.0.0.1:1") // Nothing listens here.
			api.On("KVGet", licenseKVKey).Return(tc.stored, (*model.AppError)(nil))
			if valid, message := p.CheckAndActivateLicense(key); valid != tc.valid {
				t.Fatalf("got %v %q", valid, message)
			}
		})
	}
}

func TestLicenseKeyNeverSentToUsers(t *testing.T) {
	p := &Plugin{config: defaults()}
	p.config.LicenseKey = "MMXMAS-SECRET"
	settings, err := p.config.payload()
	if err != nil || settings["LicenseKey"] != "" {
		t.Fatalf("websocket payload exposes key: %v %v", settings["LicenseKey"], err)
	}
	r := httptest.NewRequest(http.MethodGet, "/configuration", nil)
	r.Header.Set("Mattermost-User-Id", "user")
	w := httptest.NewRecorder()
	p.ServeHTTP(nil, w, r)
	if strings.Contains(w.Body.String(), "SECRET") {
		t.Fatalf("configuration endpoint exposes key: %s", w.Body)
	}
}

func TestActivationRequiresLicense(t *testing.T) {
	p, api := newLicensePlugin(t, "http://127.0.0.1:1")
	api.On("LoadPluginConfiguration", mock.Anything).Return(nil)
	api.On("PublishWebSocketEvent", "configuration", mock.Anything, mock.Anything).Return()
	err := p.OnActivate()
	if err == nil || !strings.Contains(err.Error(), "license error: License key is missing") {
		t.Fatalf("activated without a license: %v", err)
	}
	api.AssertNotCalled(t, "RegisterCommand", mock.Anything)
}
