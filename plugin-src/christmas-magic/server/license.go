package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const (
	LicenseServerURL = "https://buy.sahanranasingha.me"
	LicenseAppID     = "MATTERMOST_CHRISTMAS_MAGIC"
	// Where administrators buy a key; shown in the System Console and in activation errors.
	LicensePurchaseURL = "https://buymeacoffee.com/rsahan/e/594048"

	licenseKVKey = "license"
	// If the license server cannot be reached, a key verified on this server within this
	// window still counts, so a license-server outage cannot take the plugin down on restart.
	licenseGrace = 7 * 24 * time.Hour
)

var errLicenseUnreachable = errors.New("license server unreachable")

type LicenseRequest struct {
	LicenseKey  string `json:"licenseKey"`
	AppId       string `json:"appId"`
	MachineId   string `json:"machineId"`
	MachineName string `json:"machineName,omitempty"`
}

type LicenseResponse struct {
	Valid   bool   `json:"valid"`
	Status  string `json:"status"`
	Message string `json:"message"`
}

// licenseRecord remembers the last successful verification; only a hash of the key is stored.
type licenseRecord struct {
	KeyHash    string `json:"key_hash"`
	MachineID  string `json:"machine_id"`
	VerifiedAt int64  `json:"verified_at"`
}

// serverIdentity returns the ID the key is bound to (the Mattermost diagnostic ID, which is
// permanent and unique to this installation) and the site URL as a readable name.
func (p *Plugin) serverIdentity() (id, name string) {
	if cfg := p.API.GetConfig(); cfg != nil && cfg.ServiceSettings.SiteURL != nil {
		name = *cfg.ServiceSettings.SiteURL
	}
	id = p.API.GetDiagnosticId()
	if id == "" {
		id = name
	}
	if id == "" {
		id = "mattermost-server-default"
	}
	return id, name
}

func (p *Plugin) callLicenseServer(path string, request LicenseRequest) (LicenseResponse, error) {
	base, client := p.licenseURL, p.licenseClient
	if base == "" {
		base = LicenseServerURL
	}
	if client == nil {
		client = &http.Client{Timeout: 8 * time.Second}
	}
	body, err := json.Marshal(request)
	if err != nil {
		return LicenseResponse{}, err
	}
	resp, err := client.Post(base+path, "application/json", bytes.NewReader(body))
	if err != nil {
		return LicenseResponse{}, fmt.Errorf("%w: %v", errLicenseUnreachable, err)
	}
	defer resp.Body.Close()
	var result LicenseResponse
	if resp.StatusCode >= http.StatusInternalServerError || json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&result) != nil {
		return LicenseResponse{}, fmt.Errorf("%w: HTTP %d", errLicenseUnreachable, resp.StatusCode)
	}
	result.Valid = result.Valid && resp.StatusCode == http.StatusOK
	return result, nil
}

func hashKey(key string) string {
	sum := sha256.Sum256([]byte(key))
	return hex.EncodeToString(sum[:])
}

func (p *Plugin) rememberLicense(key, machineID string) {
	data, _ := json.Marshal(licenseRecord{KeyHash: hashKey(key), MachineID: machineID, VerifiedAt: time.Now().UnixMilli()})
	if appErr := p.API.KVSet(licenseKVKey, data); appErr != nil {
		p.API.LogWarn("Could not save the Christmas Magic license verification", "error", appErr.Error())
	}
}

func (p *Plugin) recentlyVerified(key, machineID string) (time.Time, bool) {
	data, appErr := p.API.KVGet(licenseKVKey)
	var record licenseRecord
	if appErr != nil || data == nil || json.Unmarshal(data, &record) != nil || record.KeyHash != hashKey(key) || record.MachineID != machineID {
		return time.Time{}, false
	}
	verified := time.UnixMilli(record.VerifiedAt)
	return verified, time.Since(verified) < licenseGrace
}

// CheckAndActivateLicense verifies the key with the license server and binds it to this
// Mattermost installation on first use. A key can be active on one server only.
func (p *Plugin) CheckAndActivateLicense(licenseKey string) (bool, string) {
	key := strings.TrimSpace(licenseKey)
	if key == "" {
		return false, "License key is missing. Get one at " + LicensePurchaseURL + " and enter it in the System Console."
	}
	machineID, siteURL := p.serverIdentity()

	// Fast path: the key is already activated on this server.
	if result, err := p.callLicenseServer("/api/license/verify", LicenseRequest{LicenseKey: key, AppId: LicenseAppID, MachineId: machineID}); err == nil && result.Valid {
		p.rememberLicense(key, machineID)
		return true, "License verified"
	}

	// First time on this server: activate and bind the key to it.
	result, err := p.callLicenseServer("/api/license/activate", LicenseRequest{LicenseKey: key, AppId: LicenseAppID, MachineId: machineID, MachineName: siteURL})
	switch {
	case err != nil:
		if verified, ok := p.recentlyVerified(key, machineID); ok {
			p.API.LogWarn("License server unreachable; using this server's previous verification", "verified_at", verified.UTC().Format(time.RFC3339), "error", err.Error())
			return true, "License server unreachable; using this server's previous successful verification"
		}
		p.API.LogError("Failed to connect to license server", "error", err.Error())
		return false, "Unable to reach license server. Check server internet connectivity."
	case result.Valid:
		p.rememberLicense(key, machineID)
		return true, "License successfully activated on this Mattermost server!"
	case result.Status == "max_activations_reached":
		return false, "Activation failed: This license key is already in use by another Mattermost server! Get a key for this server at " + LicensePurchaseURL
	default:
		return false, fmt.Sprintf("License validation failed: %s", result.Message)
	}
}
