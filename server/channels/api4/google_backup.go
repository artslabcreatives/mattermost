package api4

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/mlog"
	"github.com/mattermost/mattermost/server/v8/channels/app"
)

type GoogleBackupConfig struct {
	ClientID     string `json:"client_id"`
	ClientSecret string `json:"client_secret"`
	FolderID     string `json:"folder_id"`
	Enabled      bool   `json:"enabled"`
}

type GoogleBackupState struct {
	ConnectedEmail string    `json:"connected_email"`
	AccessToken    string    `json:"access_token"`
	RefreshToken   string    `json:"refresh_token"`
	Expiry         time.Time `json:"expiry"`
}

type BackupHistoryEntry struct {
	Filename  string    `json:"filename"`
	Size      int64     `json:"size"`
	Timestamp time.Time `json:"timestamp"`
	Status    string    `json:"status"` // "success", "failed", "running"
	Error     string    `json:"error,omitempty"`
}

var isBackupRunning = false

func (api *API) InitGoogleBackup() {
	api.BaseRoutes.APIRoot.Handle("/database/backup/config", api.APISessionRequired(getBackupConfig)).Methods(http.MethodGet)
	api.BaseRoutes.APIRoot.Handle("/database/backup/config", api.APISessionRequired(saveBackupConfig)).Methods(http.MethodPost)
	api.BaseRoutes.APIRoot.Handle("/database/backup/google/connect", api.APISessionRequired(googleBackupConnect)).Methods(http.MethodPost)
	api.BaseRoutes.APIRoot.Handle("/database/backup/google/callback", api.APIHandler(googleBackupCallback)).Methods(http.MethodGet)
	api.BaseRoutes.APIRoot.Handle("/database/backup/google/disconnect", api.APISessionRequired(googleBackupDisconnect)).Methods(http.MethodPost)
	api.BaseRoutes.APIRoot.Handle("/database/backup/run", api.APISessionRequired(runBackupImmediately)).Methods(http.MethodPost)
	api.BaseRoutes.APIRoot.Handle("/database/backup/history", api.APISessionRequired(getBackupHistory)).Methods(http.MethodGet)

	// Start background scheduler
	go startBackupScheduler(api.srv)
}

func getBackupConfig(c *Context, w http.ResponseWriter, r *http.Request) {
	if !c.App.SessionHasPermissionToAndNotRestrictedAdmin(*c.AppContext.Session(), model.PermissionManageSystem) {
		c.SetPermissionError(model.PermissionManageSystem)
		return
	}

	cfg, state, _, err := loadBackupConfigState(c.App)
	if err != nil {
		c.Err = model.NewAppError("getBackupConfig", "api.database.backup.load_failed", nil, err.Error(), http.StatusInternalServerError)
		return
	}

	response := map[string]any{
		"client_id":       cfg.ClientID,
		"folder_id":       cfg.FolderID,
		"enabled":         cfg.Enabled,
		"connected_email": state.ConnectedEmail,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func saveBackupConfig(c *Context, w http.ResponseWriter, r *http.Request) {
	if !c.App.SessionHasPermissionToAndNotRestrictedAdmin(*c.AppContext.Session(), model.PermissionManageSystem) {
		c.SetPermissionError(model.PermissionManageSystem)
		return
	}

	var req GoogleBackupConfig
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		c.SetInvalidParam("config")
		return
	}

	cfg, state, history, err := loadBackupConfigState(c.App)
	if err != nil {
		c.Err = model.NewAppError("saveBackupConfig", "api.database.backup.load_failed", nil, err.Error(), http.StatusInternalServerError)
		return
	}

	cfg.ClientID = req.ClientID
	if req.ClientSecret != "" {
		cfg.ClientSecret = req.ClientSecret
	}
	cfg.FolderID = req.FolderID
	cfg.Enabled = req.Enabled

	if err := saveBackupConfigState(c.App, cfg, state, history); err != nil {
		c.Err = model.NewAppError("saveBackupConfig", "api.database.backup.save_failed", nil, err.Error(), http.StatusInternalServerError)
		return
	}

	ReturnStatusOK(w)
}

func googleBackupConnect(c *Context, w http.ResponseWriter, r *http.Request) {
	if !c.App.SessionHasPermissionToAndNotRestrictedAdmin(*c.AppContext.Session(), model.PermissionManageSystem) {
		c.SetPermissionError(model.PermissionManageSystem)
		return
	}

	cfg, _, _, err := loadBackupConfigState(c.App)
	if err != nil {
		c.Err = model.NewAppError("googleBackupConnect", "api.database.backup.load_failed", nil, err.Error(), http.StatusInternalServerError)
		return
	}

	clientID := cfg.ClientID
	if clientID == "" {
		clientID = os.Getenv("GOOGLE_DRIVE_CLIENT_ID")
	}

	if clientID == "" {
		c.Err = model.NewAppError("googleBackupConnect", "api.database.backup.client_id_missing", nil, "Google Client ID is not configured", http.StatusBadRequest)
		return
	}

	siteURL := *c.App.Config().ServiceSettings.SiteURL
	if siteURL == "" {
		siteURL = "https://staging.collab.artslabcreatives.com"
	}
	redirectURI := fmt.Sprintf("%s/api/v4/database/backup/google/callback", strings.TrimSuffix(siteURL, "/"))

	authURL := fmt.Sprintf("https://accounts.google.com/o/oauth2/v2/auth?client_id=%s&redirect_uri=%s&response_type=code&scope=%s&access_type=offline&prompt=consent",
		clientID,
		redirectURI,
		"https://www.googleapis.com/auth/drive.file+https://www.googleapis.com/auth/userinfo.email",
	)

	response := map[string]string{
		"url": authURL,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func googleBackupCallback(c *Context, w http.ResponseWriter, r *http.Request) {
	code := r.URL.Query().Get("code")
	if code == "" {
		http.Redirect(w, r, "/admin_console/environment/database_backup?error=missing_code", http.StatusTemporaryRedirect)
		return
	}

	cfg, state, history, err := loadBackupConfigState(c.App)
	if err != nil {
		mlog.Error("Failed to load backup config in callback", mlog.Err(err))
		http.Redirect(w, r, "/admin_console/environment/database_backup?error=load_failed", http.StatusTemporaryRedirect)
		return
	}

	clientID := cfg.ClientID
	if clientID == "" {
		clientID = os.Getenv("GOOGLE_DRIVE_CLIENT_ID")
	}
	clientSecret := cfg.ClientSecret
	if clientSecret == "" {
		clientSecret = os.Getenv("GOOGLE_DRIVE_CLIENT_SECRET")
	}

	if clientID == "" || clientSecret == "" {
		http.Redirect(w, r, "/admin_console/environment/database_backup?error=credentials_missing", http.StatusTemporaryRedirect)
		return
	}

	siteURL := *c.App.Config().ServiceSettings.SiteURL
	if siteURL == "" {
		siteURL = "https://staging.collab.artslabcreatives.com"
	}
	redirectURI := fmt.Sprintf("%s/api/v4/database/backup/google/callback", strings.TrimSuffix(siteURL, "/"))

	// Exchange authorization code for tokens
	tokenURL := "https://oauth2.googleapis.com/token"
	formData := fmt.Sprintf("code=%s&client_id=%s&client_secret=%s&redirect_uri=%s&grant_type=authorization_code",
		code, clientID, clientSecret, redirectURI)

	resp, err := http.Post(tokenURL, "application/x-www-form-urlencoded", strings.NewReader(formData))
	if err != nil {
		mlog.Error("Failed to request tokens", mlog.Err(err))
		http.Redirect(w, r, "/admin_console/environment/database_backup?error=token_exchange_failed", http.StatusTemporaryRedirect)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		mlog.Error("Token exchange returned non-200 status", mlog.Int("status", resp.StatusCode), mlog.String("body", string(bodyBytes)))
		http.Redirect(w, r, "/admin_console/environment/database_backup?error=token_exchange_failed_status", http.StatusTemporaryRedirect)
		return
	}

	var tokenResp struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int    `json:"expires_in"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
		mlog.Error("Failed to decode token response", mlog.Err(err))
		http.Redirect(w, r, "/admin_console/environment/database_backup?error=decode_failed", http.StatusTemporaryRedirect)
		return
	}

	state.AccessToken = tokenResp.AccessToken
	if tokenResp.RefreshToken != "" {
		state.RefreshToken = tokenResp.RefreshToken
	}
	state.Expiry = time.Now().Add(time.Duration(tokenResp.ExpiresIn) * time.Second)

	// Fetch user email
	email, err := getGoogleUserInfo(state.AccessToken)
	if err != nil {
		mlog.Error("Failed to fetch Google user email", mlog.Err(err))
		email = "Connected Account"
	}
	state.ConnectedEmail = email

	if err := saveBackupConfigState(c.App, cfg, state, history); err != nil {
		mlog.Error("Failed to save state in callback", mlog.Err(err))
		http.Redirect(w, r, "/admin_console/environment/database_backup?error=save_failed", http.StatusTemporaryRedirect)
		return
	}

	http.Redirect(w, r, "/admin_console/environment/database_backup?success=connected", http.StatusTemporaryRedirect)
}

func googleBackupDisconnect(c *Context, w http.ResponseWriter, r *http.Request) {
	if !c.App.SessionHasPermissionToAndNotRestrictedAdmin(*c.AppContext.Session(), model.PermissionManageSystem) {
		c.SetPermissionError(model.PermissionManageSystem)
		return
	}

	cfg, state, history, err := loadBackupConfigState(c.App)
	if err != nil {
		c.Err = model.NewAppError("googleBackupDisconnect", "api.database.backup.load_failed", nil, err.Error(), http.StatusInternalServerError)
		return
	}

	state.AccessToken = ""
	state.RefreshToken = ""
	state.ConnectedEmail = ""
	state.Expiry = time.Time{}

	if err := saveBackupConfigState(c.App, cfg, state, history); err != nil {
		c.Err = model.NewAppError("googleBackupDisconnect", "api.database.backup.save_failed", nil, err.Error(), http.StatusInternalServerError)
		return
	}

	ReturnStatusOK(w)
}

func runBackupImmediately(c *Context, w http.ResponseWriter, r *http.Request) {
	if !c.App.SessionHasPermissionToAndNotRestrictedAdmin(*c.AppContext.Session(), model.PermissionManageSystem) {
		c.SetPermissionError(model.PermissionManageSystem)
		return
	}

	if isBackupRunning {
		c.Err = model.NewAppError("runBackupImmediately", "api.database.backup.already_running", nil, "Backup is already running", http.StatusBadRequest)
		return
	}

	go func() {
		triggerBackup(c.App, true)
	}()

	ReturnStatusOK(w)
}

func getBackupHistory(c *Context, w http.ResponseWriter, r *http.Request) {
	if !c.App.SessionHasPermissionToAndNotRestrictedAdmin(*c.AppContext.Session(), model.PermissionManageSystem) {
		c.SetPermissionError(model.PermissionManageSystem)
		return
	}

	_, _, history, err := loadBackupConfigState(c.App)
	if err != nil {
		c.Err = model.NewAppError("getBackupHistory", "api.database.backup.load_failed", nil, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(history)
}

// Helper functions for loading/saving backup state in the DB Systems table
func loadBackupConfigState(app *app.App) (*GoogleBackupConfig, *GoogleBackupState, []*BackupHistoryEntry, error) {
	cfg := &GoogleBackupConfig{}
	state := &GoogleBackupState{}
	var history []*BackupHistoryEntry

	// Load Config
	sysCfg, err := app.Srv().Store().System().GetByName("GoogleBackupConfig")
	if err == nil && sysCfg != nil && sysCfg.Value != "" {
		json.Unmarshal([]byte(sysCfg.Value), cfg)
	}

	// Load State
	sysState, err := app.Srv().Store().System().GetByName("GoogleBackupState")
	if err == nil && sysState != nil && sysState.Value != "" {
		json.Unmarshal([]byte(sysState.Value), state)
	}

	// Load History
	sysHistory, err := app.Srv().Store().System().GetByName("GoogleBackupHistory")
	if err == nil && sysHistory != nil && sysHistory.Value != "" {
		json.Unmarshal([]byte(sysHistory.Value), &history)
	}

	if history == nil {
		history = make([]*BackupHistoryEntry, 0)
	}

	return cfg, state, history, nil
}

func saveBackupConfigState(app *app.App, cfg *GoogleBackupConfig, state *GoogleBackupState, history []*BackupHistoryEntry) error {
	cfgBytes, _ := json.Marshal(cfg)
	if err := app.Srv().Store().System().SaveOrUpdate(&model.System{Name: "GoogleBackupConfig", Value: string(cfgBytes)}); err != nil {
		return err
	}

	stateBytes, _ := json.Marshal(state)
	if err := app.Srv().Store().System().SaveOrUpdate(&model.System{Name: "GoogleBackupState", Value: string(stateBytes)}); err != nil {
		return err
	}

	historyBytes, _ := json.Marshal(history)
	if err := app.Srv().Store().System().SaveOrUpdate(&model.System{Name: "GoogleBackupHistory", Value: string(historyBytes)}); err != nil {
		return err
	}

	return nil
}

func getGoogleUserInfo(accessToken string) (string, error) {
	req, _ := http.NewRequest("GET", "https://www.googleapis.com/oauth2/v2/userinfo", nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("userinfo request returned status %d", resp.StatusCode)
	}

	var userInfo struct {
		Email string `json:"email"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&userInfo); err != nil {
		return "", err
	}

	return userInfo.Email, nil
}

func refreshGoogleAccessToken(clientID, clientSecret, refreshToken string) (string, time.Time, error) {
	tokenURL := "https://oauth2.googleapis.com/token"
	formData := fmt.Sprintf("client_id=%s&client_secret=%s&refresh_token=%s&grant_type=refresh_token",
		clientID, clientSecret, refreshToken)

	resp, err := http.Post(tokenURL, "application/x-www-form-urlencoded", strings.NewReader(formData))
	if err != nil {
		return "", time.Time{}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return "", time.Time{}, fmt.Errorf("refresh token failed status %d: %s", resp.StatusCode, string(bodyBytes))
	}

	var tokenResp struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
		return "", time.Time{}, err
	}

	return tokenResp.AccessToken, time.Now().Add(time.Duration(tokenResp.ExpiresIn) * time.Second), nil
}

// Resumable Google Drive file upload
func uploadFileToGoogleDrive(accessToken, folderID, filePath, fileName string) error {
	fileInfo, err := os.Stat(filePath)
	if err != nil {
		return err
	}
	fileSize := fileInfo.Size()

	reqBody := map[string]any{
		"name": fileName,
	}
	if folderID != "" {
		reqBody["parents"] = []string{folderID}
	}
	reqBytes, _ := json.Marshal(reqBody)

	// Initiate Resumable Upload session
	req, err := http.NewRequest("POST", "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable", bytes.NewReader(reqBytes))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json; charset=UTF-8")
	req.Header.Set("X-Upload-Content-Type", "application/gzip")
	req.Header.Set("X-Upload-Content-Length", fmt.Sprintf("%d", fileSize))

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to initiate upload status %d: %s", resp.StatusCode, string(bodyBytes))
	}

	uploadURL := resp.Header.Get("Location")
	if uploadURL == "" {
		return fmt.Errorf("upload URL not returned by Google Drive")
	}

	// Perform actual upload PUT request
	file, err := os.Open(filePath)
	if err != nil {
		return err
	}
	defer file.Close()

	putReq, err := http.NewRequest("PUT", uploadURL, file)
	if err != nil {
		return err
	}
	putReq.Header.Set("Content-Length", fmt.Sprintf("%d", fileSize))
	putReq.Header.Set("Content-Type", "application/gzip")

	putResp, err := http.DefaultClient.Do(putReq)
	if err != nil {
		return err
	}
	defer putResp.Body.Close()

	if putResp.StatusCode != http.StatusOK && putResp.StatusCode != http.StatusCreated {
		bodyBytes, _ := io.ReadAll(putResp.Body)
		return fmt.Errorf("upload session PUT failed status %d: %s", putResp.StatusCode, string(bodyBytes))
	}

	return nil
}

// Executes database pg_dump, compresses it, and uploads it to Google Drive
func triggerBackup(app *app.App, manual bool) {
	isBackupRunning = true
	defer func() {
		isBackupRunning = false
	}()

	cfg, state, history, err := loadBackupConfigState(app)
	if err != nil {
		mlog.Error("Backup failed: unable to load configuration", mlog.Err(err))
		return
	}

	// Create a new running entry in the history
	timestamp := time.Now()
	fileName := fmt.Sprintf("mattermost_backup_%s.sql.gz", timestamp.Format("2006_01_02_15_04_05"))
	entry := &BackupHistoryEntry{
		Filename:  fileName,
		Timestamp: timestamp,
		Status:    "running",
	}

	// Insert at the beginning of history list (max 10 entries)
	history = append([]*BackupHistoryEntry{entry}, history...)
	if len(history) > 10 {
		history = history[:10]
	}
	saveBackupConfigState(app, cfg, state, history)

	errorOut := func(errStr string) {
		entry.Status = "failed"
		entry.Error = errStr
		saveBackupConfigState(app, cfg, state, history)
		mlog.Error("Database backup failed: " + errStr)
	}

	if state.RefreshToken == "" {
		errorOut("Google Drive is not connected")
		return
	}

	// Get database credentials
	dbURL := *app.Config().SqlSettings.DataSource
	if dbURL == "" {
		errorOut("Database connection string is empty in configuration")
		return
	}

	// Clean database credentials (remove parameters not supported by pg_dump/libpq, like binary_parameters)
	cleanDBURL := dbURL
	if parsedURL, err := url.Parse(dbURL); err == nil {
		q := parsedURL.Query()
		q.Del("binary_parameters")
		parsedURL.RawQuery = q.Encode()
		cleanDBURL = parsedURL.String()
	}

	// Refresh OAuth Token
	clientID := cfg.ClientID
	if clientID == "" {
		clientID = os.Getenv("GOOGLE_DRIVE_CLIENT_ID")
	}
	clientSecret := cfg.ClientSecret
	if clientSecret == "" {
		clientSecret = os.Getenv("GOOGLE_DRIVE_CLIENT_SECRET")
	}

	accessToken, expiry, err := refreshGoogleAccessToken(clientID, clientSecret, state.RefreshToken)
	if err != nil {
		errorOut("Token refresh failed: " + err.Error())
		return
	}
	state.AccessToken = accessToken
	state.Expiry = expiry
	saveBackupConfigState(app, cfg, state, history)

	// Run pg_dump
	tempDir := os.TempDir()
	tempFilePath := filepath.Join(tempDir, fileName)

	mlog.Info("Running pg_dump for database backup to " + tempFilePath)
	// We run pg_dump with the cleaned connection string and set pipefail
	cmd := exec.Command("bash", "-c", fmt.Sprintf("set -o pipefail; pg_dump -d %q | gzip > %q", cleanDBURL, tempFilePath))
	var errBuf bytes.Buffer
	cmd.Stderr = &errBuf
	if err := cmd.Run(); err != nil {
		errorOut(fmt.Sprintf("pg_dump failed: %v, stderr: %s", err, errBuf.String()))
		return
	}

	// Check file size
	fileInfo, err := os.Stat(tempFilePath)
	if err != nil {
		errorOut("Failed to inspect backup file: " + err.Error())
		os.Remove(tempFilePath)
		return
	}
	entry.Size = fileInfo.Size()
	saveBackupConfigState(app, cfg, state, history)

	// Upload to Google Drive
	mlog.Info(fmt.Sprintf("Uploading backup file %s (%d bytes) to Google Drive Folder %s", fileName, entry.Size, cfg.FolderID))
	err = uploadFileToGoogleDrive(state.AccessToken, cfg.FolderID, tempFilePath, fileName)
	os.Remove(tempFilePath) // Cleanup file immediately

	if err != nil {
		errorOut("Google Drive upload failed: " + err.Error())
		return
	}

	// Mark success
	entry.Status = "success"
	saveBackupConfigState(app, cfg, state, history)
	mlog.Info("Database backup completed successfully and uploaded to Google Drive: " + fileName)
}

// Background scheduler loop
func startBackupScheduler(srv *app.Server) {
	mlog.Info("Starting Google Drive automated database backup scheduler")
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()

	// Recover if we restarted but didn't run today
	for range ticker.C {
		appInstance := app.New(app.ServerConnector(srv.Channels()))
		cfg, state, _, err := loadBackupConfigState(appInstance)
		if err != nil || !cfg.Enabled || state.RefreshToken == "" {
			continue
		}

		now := time.Now()
		// Trigger daily at 12 AM (midnight)
		if now.Hour() == 0 {
			// Check if we already did a backup today
			lastRunDate, _ := srv.Store().System().GetByName("GoogleBackupLastRunDate")
			todayStr := now.Format("2006-01-02")

			if lastRunDate == nil || lastRunDate.Value != todayStr {
				mlog.Info("Initializing daily scheduled database backup...")
				// Mark as run today first to prevent duplicate triggers
				srv.Store().System().SaveOrUpdate(&model.System{Name: "GoogleBackupLastRunDate", Value: todayStr})
				// Trigger the backup
				triggerBackup(appInstance, false)
			}
		}
	}
}
