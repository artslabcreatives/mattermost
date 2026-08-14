package main

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/mattermost/mattermost/server/public/plugin"
)

type Plugin struct {
	plugin.MattermostPlugin

	configurationLock sync.RWMutex
	configuration     *configuration
}

type configuration struct {
	ClientID     string `json:"ClientID"`
	ClientSecret string `json:"ClientSecret"`
	ApiBaseUrl   string `json:"ApiBaseUrl"`     // e.g. https://accounts.zoho.com
	MailApiBaseUrl string `json:"MailApiBaseUrl"` // e.g. https://mail.zoho.com
}

type OAuthToken struct {
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"refresh_token"`
	Expiry       time.Time `json:"expiry"`
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
		return &configuration{
			ApiBaseUrl:     "https://accounts.zoho.com",
			MailApiBaseUrl: "https://mail.zoho.com",
		}
	}
	return p.configuration
}

func (p *Plugin) ServeHTTP(c *plugin.Context, w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// Handle attachment proxy (prefix match for path params)
	if strings.HasPrefix(r.URL.Path, "/api/v1/attachment") {
		p.handleAttachment(w, r)
		return
	}

	switch r.URL.Path {
	case "/api/v1/auth":
		p.handleAuth(w, r)
	case "/api/v1/oauth/callback":
		p.handleOAuthCallback(w, r)
	case "/api/v1/check-auth":
		p.handleCheckAuth(w, r)
	case "/api/v1/disconnect":
		p.handleDisconnect(w, r)
	case "/api/v1/folders":
		p.handleFolders(w, r)
	case "/api/v1/emails":
		p.handleEmails(w, r)
	case "/api/v1/email-detail":
		p.handleEmailDetail(w, r)
	case "/api/v1/send":
		p.handleSendEmail(w, r)
	default:
		http.NotFound(w, r)
	}
}

func (p *Plugin) handleAuth(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("Mattermost-User-Id")
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	cfg := p.getConfiguration()
	if cfg.ClientID == "" || cfg.ClientSecret == "" {
		http.Error(w, "Plugin not configured with Zoho Client ID and Secret", http.StatusInternalServerError)
		return
	}

	// Generate random state
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	state := hex.EncodeToString(b)

	// Save state in KV store with 10 minute expiry
	_ = p.API.KVSetWithExpiry("state_"+userID, []byte(state), 600)

	siteURL := *p.API.GetConfig().ServiceSettings.SiteURL
	redirectURI := fmt.Sprintf("%s/plugins/com.artslabcreatives.zohomail/api/v1/oauth/callback", siteURL)

	authURL := fmt.Sprintf("%s/oauth/v2/auth?response_type=code&client_id=%s&redirect_uri=%s&scope=ZohoMail.accounts.READ,ZohoMail.folders.READ,ZohoMail.messages.READ,ZohoMail.messages.CREATE&access_type=offline&prompt=consent&state=%s",
		cfg.ApiBaseUrl,
		url.QueryEscape(cfg.ClientID),
		url.QueryEscape(redirectURI),
		url.QueryEscape(state),
	)

	http.Redirect(w, r, authURL, http.StatusFound)
}

func (p *Plugin) handleOAuthCallback(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html")
	userID := r.Header.Get("Mattermost-User-Id")
	if userID == "" {
		_, _ = w.Write([]byte("<html><body><h3>Unauthorized</h3></body></html>"))
		return
	}

	code := r.URL.Query().Get("code")
	state := r.URL.Query().Get("state")

	// Validate state
	savedStateBytes, appErr := p.API.KVGet("state_" + userID)
	if appErr != nil || len(savedStateBytes) == 0 || string(savedStateBytes) != state {
		_, _ = w.Write([]byte("<html><body><h3>Invalid State Token. Please try again.</h3></body></html>"))
		return
	}
	_ = p.API.KVDelete("state_" + userID)

	cfg := p.getConfiguration()
	siteURL := *p.API.GetConfig().ServiceSettings.SiteURL
	redirectURI := fmt.Sprintf("%s/plugins/com.artslabcreatives.zohomail/api/v1/oauth/callback", siteURL)

	// Exchange code for token
	data := url.Values{}
	data.Set("code", code)
	data.Set("client_id", cfg.ClientID)
	data.Set("client_secret", cfg.ClientSecret)
	data.Set("redirect_uri", redirectURI)
	data.Set("grant_type", "authorization_code")

	tokenURL := fmt.Sprintf("%s/oauth/v2/token", cfg.ApiBaseUrl)
	resp, err := http.PostForm(tokenURL, data)
	if err != nil {
		_, _ = w.Write([]byte(fmt.Sprintf("<html><body><h3>Failed to request Zoho Token: %v</h3></body></html>", err)))
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		_, _ = w.Write([]byte(fmt.Sprintf("<html><body><h3>Zoho OAuth Error: %s</h3></body></html>", string(bodyBytes))))
		return
	}

	var tokenResponse struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int    `json:"expires_in"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&tokenResponse); err != nil {
		_, _ = w.Write([]byte("<html><body><h3>Failed to parse token response</h3></body></html>"))
		return
	}

	oauthToken := OAuthToken{
		AccessToken:  tokenResponse.AccessToken,
		RefreshToken: tokenResponse.RefreshToken,
		Expiry:       time.Now().Add(time.Duration(tokenResponse.ExpiresIn) * time.Second),
	}

	// Save token in KV store
	tokenBytes, _ := json.Marshal(oauthToken)
	_ = p.API.KVSet("token_"+userID, tokenBytes)

	// Return window close helper
	html := `
	<!DOCTYPE html>
	<html>
	<head>
		<title>Authentication Successful</title>
		<style>
			body { font-family: sans-serif; text-align: center; padding-top: 50px; background-color: #f5f5f7; }
			h2 { color: #238636; }
		</style>
		<script>
			window.onload = function() {
				if (window.opener) {
					window.opener.postMessage({ type: 'zoho-connected' }, '*');
				}
				window.close();
			};
		</script>
	</head>
	<body>
		<h2>Zoho Mail Connected Successfully!</h2>
		<p>This window will close automatically.</p>
	</body>
	</html>
	`
	_, _ = w.Write([]byte(html))
}

func (p *Plugin) handleCheckAuth(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("Mattermost-User-Id")
	if userID == "" {
		_ = json.NewEncoder(w).Encode(map[string]bool{"connected": false})
		return
	}

	tokenBytes, err := p.API.KVGet("token_" + userID)
	if err != nil || len(tokenBytes) == 0 {
		_ = json.NewEncoder(w).Encode(map[string]bool{"connected": false})
		return
	}

	_ = json.NewEncoder(w).Encode(map[string]bool{"connected": true})
}

func (p *Plugin) handleDisconnect(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("Mattermost-User-Id")
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	_ = p.API.KVDelete("token_" + userID)
	_ = json.NewEncoder(w).Encode(map[string]bool{"success": true})
}

// Helper to get active Zoho Mail client or refreshed token
func (p *Plugin) getValidToken(userID string) (string, error) {
	tokenBytes, appErr := p.API.KVGet("token_" + userID)
	if appErr != nil || len(tokenBytes) == 0 {
		return "", fmt.Errorf("no connected Zoho Mail account")
	}

	var oauthToken OAuthToken
	if err := json.Unmarshal(tokenBytes, &oauthToken); err != nil {
		return "", err
	}

	// Refresh token if expired or close to expiring (within 1 minute)
	if oauthToken.Expiry.Before(time.Now().Add(1 * time.Minute)) {
		if oauthToken.RefreshToken == "" {
			return "", fmt.Errorf("refresh token not available, please reconnect account")
		}

		cfg := p.getConfiguration()
		data := url.Values{}
		data.Set("refresh_token", oauthToken.RefreshToken)
		data.Set("client_id", cfg.ClientID)
		data.Set("client_secret", cfg.ClientSecret)
		data.Set("grant_type", "refresh_token")

		tokenURL := fmt.Sprintf("%s/oauth/v2/token", cfg.ApiBaseUrl)
		resp, err := http.PostForm(tokenURL, data)
		if err != nil {
			return "", err
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			return "", fmt.Errorf("failed to refresh token, status code: %d", resp.StatusCode)
		}

		var refreshResponse struct {
			AccessToken string `json:"access_token"`
			ExpiresIn   int    `json:"expires_in"`
		}

		if err := json.NewDecoder(resp.Body).Decode(&refreshResponse); err != nil {
			return "", err
		}

		oauthToken.AccessToken = refreshResponse.AccessToken
		oauthToken.Expiry = time.Now().Add(time.Duration(refreshResponse.ExpiresIn) * time.Second)

		// Save updated token
		updatedBytes, _ := json.Marshal(oauthToken)
		_ = p.API.KVSet("token_"+userID, updatedBytes)
	}

	return oauthToken.AccessToken, nil
}

// Fetch Zoho user mailbox account ID
func (p *Plugin) getZohoAccountId(accessToken string, cfg *configuration) (string, error) {
	req, _ := http.NewRequest("GET", fmt.Sprintf("%s/api/accounts", cfg.MailApiBaseUrl), nil)
	req.Header.Set("Authorization", "Zoho-oauthtoken "+accessToken)

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var result struct {
		Data []struct {
			AccountId string `json:"accountId"`
		} `json:"data"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil || len(result.Data) == 0 {
		return "", fmt.Errorf("unable to read Zoho account ID")
	}

	return result.Data[0].AccountId, nil
}

type ZohoFolder struct {
	FolderId      string `json:"folderId"`
	FolderName    string `json:"folderName"`
	MessageCount  int    `json:"messageCount"`
	UnreadCount   int    `json:"unreadCount"`
}

func (p *Plugin) getZohoFolders(accessToken string, accountId string, cfg *configuration) ([]ZohoFolder, error) {
	req, _ := http.NewRequest("GET", fmt.Sprintf("%s/api/accounts/%s/folders", cfg.MailApiBaseUrl, accountId), nil)
	req.Header.Set("Authorization", "Zoho-oauthtoken "+accessToken)

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		p.API.LogError("Zoho folders API network error", "error", err.Error())
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		p.API.LogError("Zoho folders API error", "status", fmt.Sprintf("%d", resp.StatusCode), "body", string(bodyBytes))
		return nil, fmt.Errorf("zoho folders API returned status %d: %s", resp.StatusCode, string(bodyBytes))
	}

	var result struct {
		Data []ZohoFolder `json:"data"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	return result.Data, nil
}

func (p *Plugin) getFolderIdByName(folders []ZohoFolder, name string) string {
	for _, f := range folders {
		if strings.EqualFold(f.FolderName, name) {
			return f.FolderId
		}
	}
	// fallback to first folder
	if len(folders) > 0 {
		return folders[0].FolderId
	}
	return ""
}

func (p *Plugin) handleFolders(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("Mattermost-User-Id")
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	accessToken, err := p.getValidToken(userID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return
	}

	cfg := p.getConfiguration()
	accountId, err := p.getZohoAccountId(accessToken, cfg)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	folders, err := p.getZohoFolders(accessToken, accountId, cfg)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	_ = json.NewEncoder(w).Encode(map[string]interface{}{"data": folders})
}

func (p *Plugin) handleEmails(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("Mattermost-User-Id")
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	accessToken, err := p.getValidToken(userID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return
	}

	cfg := p.getConfiguration()
	accountId, err := p.getZohoAccountId(accessToken, cfg)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Get all folders
	folders, err := p.getZohoFolders(accessToken, accountId, cfg)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Resolve folder from query param (default: Inbox)
	folderName := r.URL.Query().Get("folder")
	if folderName == "" {
		folderName = "Inbox"
	}

	folderId := p.getFolderIdByName(folders, folderName)
	if folderId == "" {
		http.Error(w, "Folder not found: "+folderName, http.StatusNotFound)
		return
	}

	// Fetch recent messages
	messagesURL := fmt.Sprintf("%s/api/accounts/%s/messages/view?folderId=%s&limit=20", cfg.MailApiBaseUrl, accountId, folderId)
	req, _ := http.NewRequest("GET", messagesURL, nil)
	req.Header.Set("Authorization", "Zoho-oauthtoken "+accessToken)

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}

func (p *Plugin) handleEmailDetail(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("Mattermost-User-Id")
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	messageID := r.URL.Query().Get("id")
	if messageID == "" {
		http.Error(w, "Missing email ID", http.StatusBadRequest)
		return
	}

	accessToken, err := p.getValidToken(userID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return
	}

	cfg := p.getConfiguration()
	accountId, err := p.getZohoAccountId(accessToken, cfg)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	folderID := r.URL.Query().Get("folderId")
	if folderID == "" {
		http.Error(w, "Missing folder ID", http.StatusBadRequest)
		return
	}

	client := &http.Client{}
	pluginBase := fmt.Sprintf("/plugins/%s/api/v1", "com.artslabcreatives.zohomail")

	// 1. Fetch email content
	detailURL := fmt.Sprintf("%s/api/accounts/%s/folders/%s/messages/%s/content", cfg.MailApiBaseUrl, accountId, folderID, messageID)
	req, _ := http.NewRequest("GET", detailURL, nil)
	req.Header.Set("Authorization", "Zoho-oauthtoken "+accessToken)

	resp, err := client.Do(req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		w.WriteHeader(resp.StatusCode)
		_, _ = io.Copy(w, resp.Body)
		return
	}

	// Read and parse the content response
	bodyBytes, _ := io.ReadAll(resp.Body)
	var contentResp map[string]interface{}
	if err := json.Unmarshal(bodyBytes, &contentResp); err != nil {
		// If not JSON, return raw
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(bodyBytes)
		return
	}

	// 2. Fetch attachments list
	attachURL := fmt.Sprintf("%s/api/accounts/%s/folders/%s/messages/%s/attachments", cfg.MailApiBaseUrl, accountId, folderID, messageID)
	attachReq, _ := http.NewRequest("GET", attachURL, nil)
	attachReq.Header.Set("Authorization", "Zoho-oauthtoken "+accessToken)

	var attachments []map[string]interface{}
	attachResp, err := client.Do(attachReq)
	if err != nil {
		p.API.LogError("FAILED to fetch attachments: " + err.Error())
	} else {
		defer attachResp.Body.Close()
		bodyBytes, _ := io.ReadAll(attachResp.Body)
		p.API.LogInfo(fmt.Sprintf("Zoho attachments status: %d body: %s", attachResp.StatusCode, string(bodyBytes)))
		
		var attachData struct {
			Data []map[string]interface{} `json:"data"`
		}
		if err := json.Unmarshal(bodyBytes, &attachData); err == nil && attachData.Data != nil {
			attachments = attachData.Data
		} else {
			var attachList []map[string]interface{}
			if err := json.Unmarshal(bodyBytes, &attachList); err == nil {
				attachments = attachList
			}
		}
	}

	// 3. Rewrite inline image URLs in content
	if data, ok := contentResp["data"]; ok {
		if dataMap, ok := data.(map[string]interface{}); ok {
			if content, ok := dataMap["content"].(string); ok {
				attachBytes, _ := json.Marshal(attachments)
				p.API.LogInfo("DEBUG attachments", "attachments", string(attachBytes))
				if len(content) > 1000 {
					p.API.LogInfo("DEBUG content start", "content", content[:1000])
				} else {
					p.API.LogInfo("DEBUG content", "content", content)
				}

				// Build CID -> proxy URL mapping from attachments
				cidMap := make(map[string]string)
				for _, att := range attachments {
					cid, _ := att["contentId"].(string)
					attachId, _ := att["attachmentId"].(string)
					if cid != "" && attachId != "" {
						// Remove angle brackets from CID if present
						cid = strings.TrimPrefix(cid, "<")
						cid = strings.TrimSuffix(cid, ">")
						cidMap[cid] = fmt.Sprintf("%s/attachment?accountId=%s&folderId=%s&messageId=%s&attachId=%s",
							pluginBase, accountId, folderID, messageID, attachId)
					}
				}

				// Replace cid: references
				for cid, proxyURL := range cidMap {
					content = strings.ReplaceAll(content, "cid:"+cid, proxyURL)
				}

				// Replace Zoho Mail image URLs (mail.zoho.com or mail.zoho.in etc.)
				zohoImgRe := regexp.MustCompile(`(src=["'])https?://mail\.zoho\.[a-z]+/([^"']+)(["'])`)
				content = zohoImgRe.ReplaceAllStringFunc(content, func(match string) string {
					submatches := zohoImgRe.FindStringSubmatch(match)
					if len(submatches) < 4 {
						return match
					}
					originalURL := "https://mail.zoho.com/" + submatches[2]
					return submatches[1] + pluginBase + "/attachment?proxyUrl=" + url.QueryEscape(originalURL) + submatches[3]
				})

				dataMap["content"] = content
				dataMap["attachments"] = attachments
			}
		}
	}

	resultBytes, _ := json.Marshal(contentResp)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(resultBytes)
}

func (p *Plugin) handleAttachment(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("Mattermost-User-Id")
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	accessToken, err := p.getValidToken(userID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return
	}

	cfg := p.getConfiguration()

	var targetURL string

	// Option 1: Direct proxy URL
	if proxyURL := r.URL.Query().Get("proxyUrl"); proxyURL != "" {
		targetURL = proxyURL
	} else {
		accountId := r.URL.Query().Get("accountId")
		if accountId == "" {
			var err error
			accountId, err = p.getZohoAccountId(accessToken, cfg)
			if err != nil {
				http.Error(w, "Failed to get account ID: "+err.Error(), http.StatusInternalServerError)
				return
			}
		}
		folderID := r.URL.Query().Get("folderId")
		messageID := r.URL.Query().Get("messageId")
		attachId := r.URL.Query().Get("attachId")

		if folderID == "" || messageID == "" || attachId == "" {
			http.Error(w, "Missing required parameters", http.StatusBadRequest)
			return
		}

		targetURL = fmt.Sprintf("%s/api/accounts/%s/folders/%s/messages/%s/attachments/%s",
			cfg.MailApiBaseUrl, accountId, folderID, messageID, attachId)
	}

	req, _ := http.NewRequest("GET", targetURL, nil)
	req.Header.Set("Authorization", "Zoho-oauthtoken "+accessToken)

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	// Copy content type and other headers from Zoho response
	if ct := resp.Header.Get("Content-Type"); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	if cd := resp.Header.Get("Content-Disposition"); cd != "" {
		w.Header().Set("Content-Disposition", cd)
	}
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}

func (p *Plugin) handleSendEmail(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("Mattermost-User-Id")
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var emailPayload struct {
		ToAddress string `json:"toAddress"`
		Subject   string `json:"subject"`
		Content   string `json:"content"`
	}

	if err := json.NewDecoder(r.Body).Decode(&emailPayload); err != nil {
		http.Error(w, "Invalid email payload", http.StatusBadRequest)
		return
	}

	accessToken, err := p.getValidToken(userID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return
	}

	cfg := p.getConfiguration()
	accountId, err := p.getZohoAccountId(accessToken, cfg)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Send email API payload
	sendData := map[string]interface{}{
		"toAddress": emailPayload.ToAddress,
		"subject":   emailPayload.Subject,
		"content":   emailPayload.Content,
	}
	jsonBytes, _ := json.Marshal(sendData)

	sendURL := fmt.Sprintf("%s/api/accounts/%s/messages", cfg.MailApiBaseUrl, accountId)
	req, _ := http.NewRequest("POST", sendURL, bytes.NewBuffer(jsonBytes))
	req.Header.Set("Authorization", "Zoho-oauthtoken "+accessToken)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}
