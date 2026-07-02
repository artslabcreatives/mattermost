#!/usr/bin/env python3
import os
import sys
import json
import time
import subprocess
import requests

# Configuration
CONFIG_HISTORY_QUERY = "SELECT config FROM agents_confighistory WHERE active = true;"
STATE_FILE_PATH = "/var/www/mattermost-collab-staging/followup_reminded_threads.json"
BOT_USERNAME = "followup-bot"
ADMIN_USERNAME = "aura"      # We use aura's token because bots cannot post via PATs by default
ADMIN_USER_ID = "5okt5rse1pfudrogiguf5xfgmr"
CHECK_DAYS = 30         # Scan threads with activity in the last N days (configured to 30 for staging)
MIN_AGE_HOURS = 2       # Unanswered for at least M hours
API_BASE_URL = "http://localhost:8066/api/v4"

def load_env_file():
    env_path = "/var/www/mattermost-collab-staging/.env"
    if os.path.exists(env_path):
        with open(env_path, 'r') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#'):
                    continue
                if '=' in line:
                    key, val = line.split('=', 1)
                    val = val.strip('\'"')
                    os.environ[key.strip()] = val.strip()

def query_db(query):
    try:
        cmd = ["sudo", "-u", "postgres", "psql", "-d", "mattermost_staging", "-t", "-A", "-c", query]
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        return result.stdout.strip()
    except Exception as e:
        print(f"Error executing DB query: {e}")
        if hasattr(e, 'stderr') and e.stderr:
            print(f"Stderr: {e.stderr}")
        return None

def load_state():
    if os.path.exists(STATE_FILE_PATH):
        try:
            with open(STATE_FILE_PATH, 'r') as f:
                return json.load(f)
        except Exception as e:
            print(f"Error loading state file: {e}")
    return {}

def save_state(state):
    try:
        with open(STATE_FILE_PATH, 'w') as f:
            json.dump(state, f, indent=2)
    except Exception as e:
        print(f"Error saving state file: {e}")

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
            print(f"Error parsing config JSON: {e}")
    else:
        print("Could not retrieve active configuration from database.")
    return None, None

def get_admin_token():
    # 1. Try to fetch existing token from database
    query = f"SELECT token FROM useraccesstokens WHERE userid = '{ADMIN_USER_ID}' AND description = 'Scheduler Token' LIMIT 1;"
    token = query_db(query)
    if token:
        return token.strip()
        
    # 2. If not found, generate it using mmctl
    print("No scheduler token found for admin. Generating a new one...")
    try:
        cmd = [
            "sudo", "docker", "exec", "mattermost-staging-server",
            "bin/mmctl", "token", "generate", ADMIN_USERNAME, "Scheduler Token",
            "--local", "--json"
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        tokens_info = json.loads(result.stdout)
        if tokens_info:
            return tokens_info[0]["token"]
    except Exception as e:
        print(f"Error generating token via mmctl: {e}")
        if hasattr(e, 'stderr') and e.stderr:
            print(f"Stderr: {e.stderr}")
    return None

def get_unanswered_threads(bot_user_id):
    # Fetch threads where the latest post is:
    # 1. Not from followup-bot
    # 2. In a public ('O') or private ('P') channel
    # 3. Created in the last CHECK_DAYS days
    # 4. Older than MIN_AGE_HOURS hours
    time_cutoff_ms = int((time.time() - (CHECK_DAYS * 86400)) * 1000)
    age_cutoff_ms = int((time.time() - (MIN_AGE_HOURS * 3600)) * 1000)

    query = f"""
    WITH bot_users AS (
        SELECT userid FROM bots
        UNION
        SELECT id FROM users WHERE username = '{BOT_USERNAME}'
    ),
    thread_stats AS (
        SELECT 
            COALESCE(NULLIF(rootid, ''), id) AS thread_id,
            COUNT(CASE WHEN userid = '{bot_user_id}' OR props::text LIKE '%"override_username": "followup-bot"%' THEN 1 END) AS bot_reminder_count,
            MAX(CASE WHEN userid = '{bot_user_id}' OR props::text LIKE '%"override_username": "followup-bot"%' THEN createat END) AS latest_bot_reminder_createat
        FROM posts
        WHERE deleteat = 0
        GROUP BY COALESCE(NULLIF(rootid, ''), id)
    ),
    thread_latest AS (
        SELECT 
            COALESCE(NULLIF(rootid, ''), id) AS thread_id,
            id AS post_id,
            userid,
            message,
            createat,
            channelid,
            props,
            ROW_NUMBER() OVER (PARTITION BY COALESCE(NULLIF(rootid, ''), id) ORDER BY createat DESC) as rn
        FROM posts
        WHERE deleteat = 0
    )
    SELECT 
        tl.thread_id || '|' || 
        tl.post_id || '|' || 
        tl.userid || '|' || 
        u.username || '|' || 
        replace(replace(tl.message, E'\\n', ' '), '|', ' ') || '|' || 
        CAST(tl.createat AS VARCHAR) || '|' || 
        tl.channelid || '|' || 
        c.name || '|' || 
        t.name || '|' || 
        CAST(ts.bot_reminder_count AS VARCHAR) || '|' || 
        COALESCE(CAST(ts.latest_bot_reminder_createat AS VARCHAR), '0') || '|' ||
        CASE WHEN rp.userid IN (SELECT userid FROM bot_users) OR rp.props::text LIKE '%"from_webhook"%' OR rp.props::text LIKE '%"override_username"%' THEN '1' ELSE '0' END || '|' ||
        CASE WHEN (tl.userid IN (SELECT userid FROM bot_users) OR tl.props::text LIKE '%"from_webhook"%' OR tl.props::text LIKE '%"override_username"%') 
                  AND NOT (tl.userid = '{bot_user_id}' OR tl.props::text LIKE '%"override_username": "followup-bot"%') THEN '1' ELSE '0' END
    FROM thread_latest tl
    JOIN thread_stats ts ON tl.thread_id = ts.thread_id
    JOIN channels c ON tl.channelid = c.id
    JOIN teams t ON c.teamid = t.id
    JOIN users u ON tl.userid = u.id
    JOIN posts rp ON tl.thread_id = rp.id
    WHERE tl.rn = 1
      AND c.type IN ('O', 'P')
      AND c.deleteat = 0
      AND tl.createat > {time_cutoff_ms}
      AND tl.createat < {age_cutoff_ms}
      AND rp.deleteat = 0
    ORDER BY tl.createat DESC;
    """

    output = query_db(query)
    if not output:
        return []

    threads = []
    for line in output.split('\n'):
        parts = line.split('|')
        if len(parts) >= 13:
            threads.append({
                "thread_id": parts[0],
                "latest_post_id": parts[1],
                "userid": parts[2],
                "username": parts[3],
                "message": parts[4],
                "createat": int(parts[5]),
                "channel_id": parts[6],
                "channel_name": parts[7],
                "team_name": parts[8],
                "bot_reminder_count": int(parts[9]),
                "latest_bot_reminder_createat": int(parts[10]),
                "is_root_bot": parts[11],
                "is_latest_other_bot": parts[12]
            })
    return threads

def get_thread_history(thread_id):
    # Fetch last 6 messages in the thread to provide context
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

def call_openai_analyzer(api_key, model, thread_history, is_second_reminder=False):
    url = "https://api.openai.com/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    
    system_prompt = (
        "You are the Follow-up Assistant bot. Review the following thread history from a Mattermost channel. "
        "Determine if the last message in the thread is a question, request, or update that has gone unanswered by the team members and needs a reply. "
        "If it is already resolved, answered, or does not need a follow-up reminder, respond with {\"needs_followup\": false}. "
        "If it needs a follow-up: "
        "1. Identify the team member/agent who is responsible or mentioned/should reply. "
        "2. Write a brief, polite nudge/reminder message tagging that person (e.g. \"Hi @miyuru, could you look into this?\"). "
    )
    if is_second_reminder:
        system_prompt += (
            "NOTE: We have already sent one follow-up reminder and received no response. "
            "This is the second (and final) reminder. Please make it polite but clearly state that this is a second check-in."
        )
    system_prompt += (
        "\n3. Respond ONLY with a valid JSON object of this structure: "
        "{\"needs_followup\": true, \"responsible_user\": \"username\", \"reminder_message\": \"nudge message\"}"
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
        resp_data = response.json()
        content = resp_data["choices"][0]["message"]["content"]
        return json.loads(content)
    except Exception as e:
        print(f"Error calling OpenAI API: {e}")
        return None

def post_reminder(token, bot_user_id, channel_id, thread_id, message):
    url = f"{API_BASE_URL}/posts"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
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
        print(f"Successfully posted reminder to thread {thread_id} using REST API")
        return True
    except Exception as e:
        print(f"Error posting reminder via REST API: {e}")
        if hasattr(e, 'response') and e.response is not None:
            print(f"Response: {e.response.text}")
        return False

def ensure_channel_membership(token, user_id, channel_id):
    url = f"{API_BASE_URL}/channels/{channel_id}/members"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    data = {"user_id": user_id}
    try:
        response = requests.post(url, headers=headers, json=data, timeout=10)
        if response.status_code in [200, 201]:
            return True
        else:
            print(f"Failed to add user to channel via API: {response.status_code} - {response.text}")
            return False
    except Exception as e:
        print(f"Error adding user to channel via API: {e}")
        return False

def main():
    load_env_file()
    print(f"--- Starting Follow-up Bot Scheduler at {time.strftime('%Y-%m-%d %H:%M:%S')} ---")
    
    # 1. Get bot user ID
    bot_id_output = query_db(f"SELECT id FROM users WHERE username = '{BOT_USERNAME}';")
    if not bot_id_output:
        print(f"Error: User {BOT_USERNAME} not found in database.")
        sys.exit(1)
    bot_user_id = bot_id_output.strip()
    
    # 2. Get Admin token
    token = get_admin_token()
    if not token:
        print("Error: Could not retrieve or generate Admin token.")
        sys.exit(1)
    
    # 3. Get OpenAI credentials
    api_key, model = get_openai_credentials()
    if not api_key:
        print("Error: OpenAI API Key not found in configuration.")
        sys.exit(1)
    print(f"Using model: {model}")

    # 4. Load state of previously reminded threads
    state = load_state()
    
    # 5. Fetch unanswered threads
    threads = get_unanswered_threads(bot_user_id)
    print(f"Found {len(threads)} candidate threads to analyze.")

    reminded_count = 0
    for thread in threads:
        thread_id = thread["thread_id"]
        latest_post_id = thread["latest_post_id"]
        
        # 1. Filter out bot-initiated or other bot-ended threads
        if thread["is_root_bot"] == '1':
            continue
        if thread["is_latest_other_bot"] == '1':
            continue

        # 2. Limit to maximum of 2 reminders per thread
        reminder_count = thread["bot_reminder_count"]
        if reminder_count >= 2:
            continue

        # 3. If exactly 1 reminder exists, the second reminder is sent only if:
        # - The latest post in the thread IS that first reminder (no response yet)
        # - The first reminder was sent at least 6 hours ago
        is_second_reminder = False
        if reminder_count == 1:
            latest_post_is_reminder = (thread["createat"] == thread["latest_bot_reminder_createat"])
            if latest_post_is_reminder:
                time_since_reminder_ms = int(time.time() * 1000) - thread["latest_bot_reminder_createat"]
                if time_since_reminder_ms < 6 * 3600 * 1000:
                    # Not yet 6 hours since the first reminder
                    continue
                is_second_reminder = True
            else:
                # A user has replied since our first reminder.
                # Since the latest post is a user post, the query's age_cutoff_ms (2 hours)
                # already ensures it has been quiet for at least 2 hours.
                pass

        # Check if already reminded for this post
        if state.get(thread_id) == latest_post_id:
            # We already posted a reminder for the latest message in this thread
            continue
            
        print(f"Analyzing thread {thread_id} (Channel: {thread['team_name']}:{thread['channel_name']})...")
        
        # Fetch thread history
        thread_history = get_thread_history(thread_id)
        if not thread_history:
            continue
            
        # Call LLM
        decision = call_openai_analyzer(api_key, model, thread_history, is_second_reminder=is_second_reminder)
        if not decision:
            continue
            
        if decision.get("needs_followup"):
            msg = decision.get("reminder_message")
            responsible = decision.get("responsible_user")
            print(f"  -> Thread needs follow-up! Responsible: @{responsible}. Nudge: '{msg}'")
            
            # Ensure the dummy admin is in the channel first
            ensure_channel_membership(token, ADMIN_USER_ID, thread["channel_id"])
            
            # Post reminder using the REST API with bot overrides
            success = post_reminder(token, bot_user_id, thread["channel_id"], thread_id, msg)
            if success:
                # Save state so we don't repeat this reminder
                state[thread_id] = latest_post_id
                save_state(state)
                reminded_count += 1
                # Small sleep to prevent rate limiting or log flooding
                time.sleep(1)
        else:
            print("  -> Thread does not need follow-up.")

    print(f"--- Finished Follow-up Bot Scheduler. Reminders posted: {reminded_count} ---")

if __name__ == "__main__":
    main()
