# Email-Only Login Feature

## Overview
A simple passwordless authentication endpoint that allows users to log in with only their email address. This is intended for development and trusted environments where security is not a concern.

## API Endpoint

**POST** `/api/v4/users/login/email_only`

### Request Body
```json
{
  "email": "user@example.com",
  "redirect_to": "xq7b9k3m5p8n2j4c6f1w9r0t", // Optional: channel ID or URL
  "device_id": "device123" // Optional
}
```

### Parameters

- **email** (required): The email address of the user to log in
- **redirect_to** (optional): Either a channel ID (26 characters) or a full URL/path to redirect to after login
- **device_id** (optional): Device identifier for the session

### Response

Success (200 OK):
```json
{
  "user": {
    "id": "user_id",
    "email": "user@example.com",
    "username": "username",
    // ... other user fields
  },
  "redirect_url": "https://your-site.com/channels/xq7b9k3m5p8n2j4c6f1w9r0t" // If redirect_to was provided
}
```

Error (400 Bad Request):
```json
{
  "id": "api.user.login_email_only.missing_email.app_error",
  "message": "Email is required"
}
```

Error (401 Unauthorized):
```json
{
  "id": "api.user.login_email_only.user_not_found.app_error",
  "message": "User not found"
}
```

## Security Warning

⚠️ **WARNING**: This endpoint provides NO SECURITY. Any request with a valid email address will authenticate the user without password verification.

**DO NOT USE IN PRODUCTION** unless you have additional security measures in place (e.g., network restrictions, VPN, etc.).

## Use Cases

1. **Development/Testing**: Quickly log in as different users without entering passwords
2. **Desktop Integration**: Simple integration with desktop applications in trusted environments
3. **Internal Tools**: Backend systems that need to impersonate users for automation

## Example Usage

### Using curl
```bash
# Login as a user
curl -X POST http://localhost:8065/api/v4/users/login/email_only \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com"
  }'

# Login and redirect to a specific channel
curl -X POST http://localhost:8065/api/v4/users/login/email_only \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "redirect_to": "xq7b9k3m5p8n2j4c6f1w9r0t"
  }'

# Login with a custom redirect URL
curl -X POST http://localhost:8065/api/v4/users/login/email_only \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "redirect_to": "/some/custom/path"
  }'
```

### Using JavaScript
```javascript
async function emailOnlyLogin(email, channelId) {
  const response = await fetch('/api/v4/users/login/email_only', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: email,
      redirect_to: channelId, // Optional
    }),
  });

  const data = await response.json();
  
  if (data.redirect_url) {
    // Redirect to the specified channel or URL
    window.location.href = data.redirect_url;
  }
  
  return data.user;
}

// Usage
emailOnlyLogin('admin@example.com', 'abc123def456ghi789jkl012');
```

### Desktop Application Integration
```bash
# Send email to login and get redirect URL
POST_DATA=$(cat <<EOF
{
  "email": "${USER_EMAIL}",
  "redirect_to": "${CHANNEL_ID}"
}
EOF
)

RESPONSE=$(curl -s -X POST "${MM_SERVER_URL}/api/v4/users/login/email_only" \
  -H "Content-Type: application/json" \
  -d "${POST_DATA}")

# Extract redirect URL and open in browser
REDIRECT_URL=$(echo "${RESPONSE}" | jq -r '.redirect_url')
xdg-open "${REDIRECT_URL}"  # Linux
# or
open "${REDIRECT_URL}"       # macOS
# or
start "${REDIRECT_URL}"      # Windows
```

## Implementation Details

The endpoint:
1. Validates that an email address is provided
2. Looks up the user by email address
3. Checks if the user is deleted/inactive
4. Creates a session without password verification
5. Attaches session cookies to the response
6. If `redirect_to` is provided and is 26 characters, treats it as a channel ID and builds a full URL
7. Otherwise, passes through the `redirect_to` value as-is

## Changes Made

### Files Modified

1. **Dockerfile.source**
   - Removed `BUILD_ENTERPRISE_READY=true` and `BUILD_ENTERPRISE_DIR=./enterprise` flags
   - Changed to Community Edition build

2. **server/channels/api4/user.go**
   - Added route registration in `InitUser()` at line 71
   - Implemented `loginEmailOnly()` function at the end of the file

### Build Configuration
The Mattermost server now builds as **Community Edition** instead of Enterprise Edition, which removes dependencies on the private enterprise repository.

## Testing

After deployment, test the endpoint:

```bash
# Create a test user first (if needed)
curl -X POST http://localhost:8065/api/v4/users \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "username": "testuser",
    "password": "testpassword123"
  }'

# Test email-only login
curl -X POST http://localhost:8065/api/v4/users/login/email_only \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com"
  }' \
  -v  # Verbose mode to see cookies being set
```

You should receive a successful response with the user object and session cookies will be set in the response headers.
