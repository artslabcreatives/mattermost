# Mattermost Debug Commands

## Real-time Request Monitoring

### 1. Watch ALL HTTP requests (shows method, URL, status code, user)
```bash
cd /var/www/mattermost-collab-prod
./watch-requests.sh
```

### 2. Watch ALL server logs (full debug output)
```bash
sudo docker compose -f docker-compose.prod.yml logs -f mattermost
```

### 3. Watch only errors and warnings
```bash
sudo docker compose -f docker-compose.prod.yml logs -f mattermost 2>&1 | grep -i --line-buffered "error\|warn\|fail"
```

### 4. Watch API requests only (no static assets)
```bash
sudo docker compose -f docker-compose.prod.yml logs -f mattermost 2>&1 | grep --line-buffered "/api/"
```

### 5. Watch specific endpoint (e.g., login requests)
```bash
sudo docker compose -f docker-compose.prod.yml logs -f mattermost 2>&1 | grep --line-buffered "login"
```

## One-time Log Checks

### Last 50 requests
```bash
sudo docker compose -f docker-compose.prod.yml logs mattermost --tail 100 | grep "Received HTTP request"
```

### Last 50 errors
```bash
sudo docker compose -f docker-compose.prod.yml logs mattermost --tail 200 | grep -i "error"
```

### Check startup logs
```bash
sudo docker compose -f docker-compose.prod.yml logs mattermost | grep -E "Server is|listening|initialized"
```

## Test Requests

### Test system ping
```bash
curl -v http://localhost:8065/api/v4/system/ping
```

### Test main page
```bash
curl -v http://localhost:8065/ | head -20
```

### Test your email-only login endpoint
```bash
curl -v -X POST http://localhost:8065/api/v4/users/login/email_only \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'
```

### Test with redirect parameter
```bash
curl -v -X POST http://localhost:8065/api/v4/users/login/email_only \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com", "redirect_to":"abc123xyz456789012345678"}'
```

## Debug Info in Logs

When debug mode is enabled, each HTTP request shows:
- **timestamp**: When the request was received
- **method**: HTTP method (GET, POST, etc.)
- **url**: The endpoint being accessed
- **request_id**: Unique ID for tracking this request
- **user_id**: If authenticated, the user making the request
- **status_code**: HTTP response code (200, 401, 500, etc.)

### Example log entry:
```json
{
  "timestamp":"2026-02-18 11:36:55.517 Z",
  "level":"debug",
  "msg":"Received HTTP request",
  "caller":"web/handlers.go:175",
  "method":"GET",
  "url":"/api/v4/system/ping",
  "request_id":"bipswhsfaprzzej6qtcghduj1r",
  "status_code":"200"
}
```

## Common Status Codes

- **200**: Success
- **201**: Created
- **400**: Bad request (client error)
- **401**: Unauthorized (not logged in)
- **403**: Forbidden (logged in but no permission)
- **404**: Not found
- **500**: Server error

## Disable Debug Mode (for production)

Edit `/var/www/mattermost-collab-prod/.env`:
```bash
MM_ENABLE_DEVELOPER=false
MM_LOGSETTINGS_CONSOLELEVEL=INFO
```

Then restart:
```bash
sudo docker compose -f docker-compose.prod.yml restart mattermost
```
