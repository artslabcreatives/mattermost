#!/bin/bash
# Watch HTTP requests in real-time
echo "=== Monitoring HTTP requests (Ctrl+C to stop) ==="
echo ""
sudo docker compose -f /var/www/mattermost-collab-prod/docker-compose.prod.yml logs -f mattermost 2>&1 | grep --line-buffered -E "Received HTTP request|method|url|status_code|user_id|request_id"

