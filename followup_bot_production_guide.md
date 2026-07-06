# Production Deployment Guide: Mattermost Follow-Up Bot

This guide details how to implement the isolated, automated `followup-bot` scheduled reminders on your Mattermost Production environment. It ensures that the bot activity is dedicated to the `aura` service account, preventing any notifications from leaking into the administrator account (`sahan@artslabcreatives.com`).

---

## Step 1: Enable Local Mode on the Production Server
To generate authorization tokens programmatically via `mmctl` without exposing login credentials, **Local Mode** must be enabled on the Mattermost production container.

1. Open your production `docker-compose.yml` (usually in your production Mattermost directory) and ensure this environment variable is set under your Mattermost service:
   ```yaml
   - MM_DEVELOPERSETTINGS_ENABLELOCALMODE=true
   ```
2. Also check your production `.env` file to ensure the variable matches, or update it directly.
3. Re-create the production container to apply changes:
   ```bash
   docker compose up -d --force-recreate mattermost-server
   ```

---

## Step 2: Set Up the Dedicated "Aura" Service Account
We use a dummy administrator account named `aura` (`aura@localhost`) to run the API requests. This prevents the bot from ever touching or subscribing Sahan's account.

1. Check if the user `aura` exists in production. If not, create them:
   ```bash
   docker exec -it mattermost-server bin/mmctl user create --email aura@localhost --username aura --password "YourSuperSecurePassword123!" --local
   ```
2. Make `aura` a system administrator:
   ```bash
   docker exec -it mattermost-server bin/mmctl user system-admin --role system_admin aura --local
   ```
3. Add `aura` to your main team (e.g., `artslab-creatives`):
   ```bash
   docker exec -it mattermost-server bin/mmctl team users add artslab-creatives aura --local
   ```
4. Query the production database to retrieve `aura`'s User ID (needed for the scheduler configuration):
   ```bash
   sudo -u postgres psql -d mattermost_production -c "SELECT id FROM users WHERE username = 'aura';"
   ```

---

## Step 3: Clear Legacy Thread Subscriptions (Database Cleanup)
To ensure Sahan's account (`sahan@artslabcreatives.com`) does not receive notifications for any existing threads that the bot has touched:

1. Retrieve Sahan's User ID (e.g. `dy88ifmpx7d55xn47r38o1drzh`).
2. Run these SQL commands on the production PostgreSQL database:
   ```sql
   -- 1. Remove Sahan's User ID from the participants JSON list on all threads where the bot has participated
   UPDATE threads 
   SET participants = participants - 'SAHAN_USER_ID_HERE' 
   WHERE postid IN (
       SELECT DISTINCT COALESCE(rootid, id) 
       FROM posts 
       WHERE props::text LIKE '%"override_username": "followup-bot"%' 
          OR userid = 'AURA_USER_ID_HERE'
   );

   -- 2. Delete Sahan's subscriptions to these threads so they disappear from his sidebar/unread threads list
   DELETE FROM threadmemberships 
   WHERE userid = 'SAHAN_USER_ID_HERE' 
     AND postid IN (
         SELECT DISTINCT COALESCE(rootid, id) 
         FROM posts 
         WHERE props::text LIKE '%"override_username": "followup-bot"%' 
            OR userid = 'AURA_USER_ID_HERE'
     );
   ```

---

## Step 4: The AI Prompt for Deployment
Copy and paste the prompt below into a new chat with the AI assistant when you have your production workspace active:

```markdown
I want to implement the automated Follow-up Bot reminder script in my Mattermost production environment. We need to:
1. Deploy the scheduler script (`followup_scheduler.py`) to the production directory.
2. Ensure the bot activities are isolated under the dedicated admin user `aura` to stop sahan@artslabcreatives.com from receiving thread notifications.
3. Clean up the database to unfollow sahan from legacy threads.

Here is the exact implementation of the scheduler script we tested and verified in staging:

=== START OF SCRIPT ===
import os
import sys
import json
import time
import subprocess
import requests

# Configuration
CONFIG_HISTORY_QUERY = "SELECT config FROM agents_confighistory WHERE active = true;"
STATE_FILE_PATH = "/var/www/mattermost-collab/followup_reminded_threads.json"
BOT_USERNAME = "followup-bot"
ADMIN_USERNAME = "aura"
ADMIN_USER_ID = "AURA_PRODUCTION_USER_ID"  # Replace with production Aura user ID
CHECK_DAYS = 30
MIN_AGE_HOURS = 2
API_BASE_URL = "http://localhost:8065/api/v4"  # Update port if different in production

def query_db(query):
    try:
        cmd = ["sudo", "-u", "postgres", "psql", "-d", "mattermost_production", "-t", "-A", "-c", query]
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        return result.stdout.strip()
    except Exception as e:
        print(f"Error executing DB query: {e}")
        return None

def load_state():
    if os.path.exists(STATE_FILE_PATH):
        try:
            with open(STATE_FILE_PATH, 'r') as f:
                return json.load(f)
        except Exception as e:
            print(f"Error loading state: {e}")
    return {}

def save_state(state):
    try:
        with open(STATE_FILE_PATH, 'w') as f:
            json.dump(state, f, indent=2)
    except Exception as e:
        print(f"Error saving state: {e}")

def get_openai_credentials():
    # 1. Try environment variables first (allows running without the Mattermost AI plugin)
    env_key = os.environ.get("OPENAI_API_KEY")
    if env_key:
        return env_key, os.environ.get("OPENAI_MODEL", "gpt-4o-mini")

    # 2. Fall back to database query (requires mattermost-ai plugin configured)
    config_json = query_db(CONFIG_HISTORY_QUERY)
    if config_json:
        try:
            config = json.loads(config_json)
            services = config.get("services", [])
            for service in services:
                if service.get("type") == "openai":
                    return service.get("apiKey"), service.get("defaultModel", "gpt-4o-mini")
        except Exception as e:
            print(f"Error parsing config: {e}")
    return None, None

def get_admin_token():
    query = f"SELECT token FROM useraccesstokens WHERE userid = '{ADMIN_USER_ID}' AND description = 'Scheduler Token' LIMIT 1;"
    token = query_db(query)
    if token:
        return token.strip()
        
    try:
        cmd = ["sudo", "docker", "exec", "mattermost-server", "bin/mmctl", "token", "generate", ADMIN_USERNAME, "Scheduler Token", "--local", "--json"]
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        tokens_info = json.loads(result.stdout)
        if tokens_info:
            return tokens_info[0]["token"]
    except Exception as e:
        print(f"Error generating token: {e}")
    return None

def get_unanswered_threads(bot_user_id):
    time_cutoff_ms = int((time.time() - (CHECK_DAYS * 86400)) * 1000)
    age_cutoff_ms = int((time.time() - (MIN_AGE_HOURS * 3600)) * 1000)

    query = f"""
    WITH thread_latest AS (
        SELECT 
            COALESCE(NULLIF(rootid, ''), id) AS thread_id,
            id AS post_id,
            userid,
            message,
            createat,
            channelid,
            ROW_NUMBER() OVER (PARTITION BY COALESCE(NULLIF(rootid, ''), id) ORDER BY createat DESC) as rn
        FROM posts
        WHERE deleteat = 0
    )
    SELECT tl.thread_id || '|' || tl.post_id || '|' || tl.userid || '|' || u.username || '|' || replace(replace(tl.message, E'\\n', ' '), '|', ' ') || '|' || CAST(tl.createat AS VARCHAR) || '|' || tl.channelid || '|' || c.name || '|' || t.name
    FROM thread_latest tl
    JOIN channels c ON tl.channelid = c.id
    JOIN teams t ON c.teamid = t.id
    JOIN users u ON tl.userid = u.id
    WHERE tl.rn = 1
      AND c.type IN ('O', 'P')
      AND c.deleteat = 0
      AND tl.userid != '{bot_user_id}'
      AND tl.createat > {time_cutoff_ms}
      AND tl.createat < {age_cutoff_ms}
      AND EXISTS (SELECT 1 FROM posts rp WHERE rp.id = tl.thread_id AND rp.deleteat = 0)
    ORDER BY tl.createat DESC;
    """
    output = query_db(query)
    if not output:
        return []

    threads = []
    for line in output.split('\n'):
        parts = line.split('|')
        if len(parts) >= 9:
            threads.append({
                "thread_id": parts[0],
                "latest_post_id": parts[1],
                "userid": parts[2],
                "username": parts[3],
                "message": parts[4],
                "createat": int(parts[5]),
                "channel_id": parts[6],
                "channel_name": parts[7],
                "team_name": parts[8]
            })
    return threads

def get_thread_history(thread_id):
    query = f"""
    SELECT u.username || ': ' || replace(posts.message, E'\\n', ' ')
    FROM posts 
    JOIN users u ON posts.userid = u.id 
    WHERE posts.id = '{thread_id}' OR posts.rootid = '{thread_id}' 
    ORDER BY posts.createat ASC
    LIMIT 6;
    """
    output = query_db(query)
    if not output:
        return ""
    return "\n".join(output.split('\n'))

def call_openai_analyzer(api_key, model, thread_history):
    url = "https://api.openai.com/v1/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    system_prompt = (
        "You are the Follow-up Assistant bot. Review the following thread history. "
        "Determine if the last message is a question or request that needs a reply. "
        "If resolved or doesn't need follow-up, respond with {\"needs_followup\": false}. "
        "If it needs follow-up: "
        "1. Identify the responsible person. "
        "2. Write a polite nudge tagging them (e.g. \"Hi @username, could you look into this?\"). "
        "3. Respond ONLY with: {\"needs_followup\": true, \"responsible_user\": \"username\", \"reminder_message\": \"message\"}"
    )
    data = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Thread History:\n{thread_history}"}
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.2
    }
    try:
        response = requests.post(url, headers=headers, json=data, timeout=30)
        response.raise_for_status()
        return json.loads(response.json()["choices"][0]["message"]["content"])
    except Exception as e:
        print(f"Error calling OpenAI API: {e}")
        return None

def post_reminder(token, bot_user_id, channel_id, thread_id, message):
    url = f"{API_BASE_URL}/posts"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    data = {
        "channel_id": channel_id,
        "root_id": thread_id,
        "message": message,
        "props": {
            "from_webhook": "true",
            "override_username": BOT_USERNAME,
            "override_icon_url": f"/api/v4/users/{bot_user_id}/image"
        }
    }
    try:
        response = requests.post(url, headers=headers, json=data, timeout=10)
        response.raise_for_status()
        return True
    except Exception as e:
        print(f"Error posting reminder via REST API: {e}")
        if hasattr(e, 'response') and e.response is not None:
            print(f"Response: {e.response.text}")
        return False

def ensure_channel_membership(token, user_id, channel_id):
    url = f"{API_BASE_URL}/channels/{channel_id}/members"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    data = {"user_id": user_id}
    try:
        response = requests.post(url, headers=headers, json=data, timeout=10)
        return response.status_code in [200, 201]
    except Exception as e:
        print(f"Error joining channel: {e}")
        return False

def main():
    bot_id_output = query_db(f"SELECT id FROM users WHERE username = '{BOT_USERNAME}';")
    if not bot_id_output:
        print(f"Error: User {BOT_USERNAME} not found.")
        sys.exit(1)
    bot_user_id = bot_id_output.strip()
    
    token = get_admin_token()
    if not token:
        sys.exit(1)
        
    api_key, model = get_openai_credentials()
    if not api_key:
        sys.exit(1)

    state = load_state()
    threads = get_unanswered_threads(bot_user_id)

    for thread in threads:
        thread_id = thread["thread_id"]
        latest_post_id = thread["latest_post_id"]
        if state.get(thread_id) == latest_post_id:
            continue
            
        thread_history = get_thread_history(thread_id)
        if not thread_history:
            continue
            
        decision = call_openai_analyzer(api_key, model, thread_history)
        if not decision or not decision.get("needs_followup"):
            continue
            
        msg = decision.get("reminder_message")
        ensure_channel_membership(token, ADMIN_USER_ID, thread["channel_id"])
        
        success = post_reminder(token, bot_user_id, thread["channel_id"], thread_id, msg)
        if success:
            state[thread_id] = latest_post_id
            save_state(state)
            time.sleep(1)

if __name__ == "__main__":
    main()
=== END OF SCRIPT ===

Please guide me through setting this up in production, verifying user IDs, updating configurations, cleaning the database tables `threads` and `threadmemberships` for Sahan, and setting up the crontab for hourly automation.
```
