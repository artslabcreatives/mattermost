package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/pluginapi"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	"google.golang.org/api/calendar/v3"
)

// manifestID must match plugin.json's id; it builds the plugin's own URLs.
const manifestID = "com.artslabcreatives.boardroom"

// One shared Google account owns the board room calendar. An admin connects it
// once and every booking is written there; the host and participants are
// invited by Google, so nobody else ever authenticates.
//
// This is the only way to sync without Google Workspace: domain-wide
// delegation, which would let the plugin act as any user, needs a Workspace
// domain, and this server's mail is on Zoho.

const (
	connectionKey = "br_gcal_conn"
	statePrefix   = "br_oauth_state_"
	stateTTL      = 10 * time.Minute
)

// connection is the stored Board Room account link.
type connection struct {
	Email          string `json:"email"`
	EncryptedToken string `json:"encrypted_token"`
	ConnectedBy    string `json:"connected_by"`
	ConnectedAt    int64  `json:"connected_at"`
}

func (p *Plugin) oauthConfig() (*oauth2.Config, error) {
	cfg := p.getConfiguration()
	if cfg.OAuthClientID == "" || cfg.OAuthClientSecret == "" {
		return nil, fmt.Errorf("the Google OAuth client ID and secret are not configured")
	}
	siteURL := strings.TrimRight(p.siteURL(), "/")
	if siteURL == "" {
		return nil, fmt.Errorf("the server has no SiteURL configured")
	}

	return &oauth2.Config{
		ClientID:     cfg.OAuthClientID,
		ClientSecret: cfg.OAuthClientSecret,
		Endpoint:     google.Endpoint,
		RedirectURL:  siteURL + "/plugins/" + manifestID + "/oauth/complete",
		Scopes: []string{
			calendar.CalendarEventsScope,
			// Used only to show which account is connected.
			"https://www.googleapis.com/auth/userinfo.email",
		},
	}, nil
}

func (p *Plugin) getConnection() (*connection, error) {
	var conn connection
	if err := p.client.KV.Get(connectionKey, &conn); err != nil {
		return nil, err
	}
	if conn.EncryptedToken == "" {
		return nil, nil
	}
	return &conn, nil
}

// token decrypts the stored refresh token.
func (p *Plugin) token(conn *connection) (*oauth2.Token, error) {
	raw, err := decryptString(p.getConfiguration().EncryptionKey, conn.EncryptedToken)
	if err != nil {
		return nil, err
	}
	var tok oauth2.Token
	if err := json.Unmarshal([]byte(raw), &tok); err != nil {
		return nil, fmt.Errorf("the stored token is corrupt; reconnect the Board Room account")
	}
	return &tok, nil
}

// requireAdmin gates the connect/disconnect endpoints. Linking the shared
// calendar is an administrative act, not something any user should do.
func (p *Plugin) requireAdmin(w http.ResponseWriter, userID string) bool {
	user, err := p.client.User.Get(userID)
	if err != nil || !user.IsSystemAdmin() {
		writeError(w, http.StatusForbidden, "Only a system administrator can connect the Board Room calendar.")
		return false
	}
	return true
}

// handleOAuthConnect sends the admin to Google's consent screen.
func (p *Plugin) handleOAuthConnect(w http.ResponseWriter, r *http.Request, userID string) {
	if !p.requireAdmin(w, userID) {
		return
	}
	conf, err := p.oauthConfig()
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	// A random, short-lived state ties the callback back to this request.
	state := model.NewId()
	if _, err := p.client.KV.Set(statePrefix+state, userID, pluginapi.SetExpiry(stateTTL)); err != nil {
		writeError(w, http.StatusInternalServerError, "Could not start the Google connection.")
		return
	}

	// offline + consent is what makes Google return a refresh token, so the
	// connection survives without anyone re-authorising.
	url := conf.AuthCodeURL(state,
		oauth2.AccessTypeOffline,
		oauth2.SetAuthURLParam("prompt", "consent"))
	http.Redirect(w, r, url, http.StatusFound)
}

// handleOAuthComplete receives Google's callback.
func (p *Plugin) handleOAuthComplete(w http.ResponseWriter, r *http.Request, userID string) {
	if errMsg := r.URL.Query().Get("error"); errMsg != "" {
		writeHTMLResult(w, "Google refused the connection", errMsg)
		return
	}

	state := r.URL.Query().Get("state")
	code := r.URL.Query().Get("code")
	if state == "" || code == "" {
		writeHTMLResult(w, "Something went wrong", "Google's response was missing information.")
		return
	}

	var storedUserID string
	if err := p.client.KV.Get(statePrefix+state, &storedUserID); err != nil || storedUserID == "" {
		writeHTMLResult(w, "That link expired", "Start the connection again from the System Console.")
		return
	}
	_ = p.client.KV.Delete(statePrefix + state)

	// The browser finishing the flow must be the one that started it.
	if storedUserID != userID {
		writeHTMLResult(w, "That link wasn't for you", "Start the connection again from your own account.")
		return
	}
	if !p.isSystemAdmin(userID) {
		writeHTMLResult(w, "Not allowed", "Only a system administrator can connect the Board Room calendar.")
		return
	}

	conf, err := p.oauthConfig()
	if err != nil {
		writeHTMLResult(w, "Not configured", err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), googleTimeout)
	defer cancel()

	tok, err := conf.Exchange(ctx, code)
	if err != nil {
		writeHTMLResult(w, "Google rejected the connection", err.Error())
		return
	}
	if tok.RefreshToken == "" {
		writeHTMLResult(w, "Google didn't return a refresh token",
			"Remove this app at myaccount.google.com/permissions and connect again, so Google issues a fresh long-lived token.")
		return
	}

	email, err := p.accountEmail(ctx, conf, tok)
	if err != nil {
		writeHTMLResult(w, "Could not read the account", err.Error())
		return
	}

	raw, err := json.Marshal(tok)
	if err != nil {
		writeHTMLResult(w, "Could not store the token", err.Error())
		return
	}
	encrypted, err := encryptString(p.getConfiguration().EncryptionKey, string(raw))
	if err != nil {
		writeHTMLResult(w, "Could not encrypt the token", err.Error())
		return
	}

	conn := &connection{
		Email:          email,
		EncryptedToken: encrypted,
		ConnectedBy:    userID,
		ConnectedAt:    model.GetMillis(),
	}
	if _, err := p.client.KV.Set(connectionKey, conn); err != nil {
		writeHTMLResult(w, "Could not save the connection", err.Error())
		return
	}

	p.client.Log.Info("Board room calendar connected", "email", email, "connected_by", userID)
	go p.resyncFailedBookings()
	writeHTMLResult(w, "Board Room calendar connected",
		"Bookings will now appear on "+email+" and attendees will be invited. You can close this tab.")
}

// accountEmail asks Google which account just authorised us.
func (p *Plugin) accountEmail(ctx context.Context, conf *oauth2.Config, tok *oauth2.Token) (string, error) {
	res, err := conf.Client(ctx, tok).Get("https://www.googleapis.com/oauth2/v2/userinfo")
	if err != nil {
		return "", err
	}
	defer res.Body.Close()

	var info struct {
		Email string `json:"email"`
	}
	if err := json.NewDecoder(res.Body).Decode(&info); err != nil {
		return "", err
	}
	if info.Email == "" {
		return "", fmt.Errorf("Google did not return an email address")
	}
	return info.Email, nil
}

func (p *Plugin) isSystemAdmin(userID string) bool {
	user, err := p.client.User.Get(userID)
	return err == nil && user.IsSystemAdmin()
}

func (p *Plugin) handleOAuthDisconnect(w http.ResponseWriter, _ *http.Request, userID string) {
	if !p.requireAdmin(w, userID) {
		return
	}
	if err := p.client.KV.Delete(connectionKey); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type connectionStatus struct {
	Connected   bool   `json:"connected"`
	Email       string `json:"email,omitempty"`
	SyncEnabled bool   `json:"sync_enabled"`
	Configured  bool   `json:"configured"`
	ConnectURL  string `json:"connect_url,omitempty"`
	CanConnect  bool   `json:"can_connect"`
}

// handleConnectionStatus tells the panel whether sync is actually working, so
// a half-finished setup is visible instead of silently not syncing.
func (p *Plugin) handleConnectionStatus(w http.ResponseWriter, _ *http.Request, userID string) {
	cfg := p.getConfiguration()
	conn, err := p.getConnection()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	status := connectionStatus{
		Connected:   conn != nil,
		SyncEnabled: cfg.EnableCalendarSync,
		Configured:  cfg.OAuthClientID != "" && cfg.OAuthClientSecret != "",
		CanConnect:  p.isSystemAdmin(userID),
	}
	if conn != nil {
		status.Email = conn.Email
	}
	if status.CanConnect {
		status.ConnectURL = strings.TrimRight(p.siteURL(), "/") + "/plugins/" + manifestID + "/oauth/connect"
	}
	writeJSON(w, http.StatusOK, status)
}

func writeHTMLResult(w http.ResponseWriter, title, detail string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, `<!doctype html><html><head><meta charset="utf-8"><title>%s</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:34rem;margin:4rem auto;padding:0 1rem;line-height:1.5;color:#1a1a1a}
h1{font-size:1.25rem}p{color:#555}</style></head>
<body><h1>%s</h1><p>%s</p></body></html>`,
		htmlEscape(title), htmlEscape(title), htmlEscape(detail))
}

func htmlEscape(s string) string {
	r := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&#39;")
	return r.Replace(s)
}
