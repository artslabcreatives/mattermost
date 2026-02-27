#!/bin/bash
set -eo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "================================"
echo "  Mattermost Rebuild & Deploy"
echo "================================"
echo ""

# ── Load env vars ────────────────────────────────────────────────────
if [ -f "$REPO_ROOT/.env" ]; then
  source "$REPO_ROOT/.env"
  # URL-decode the password (pipe through python3 so bash vars are readable)
  POSTGRES_PASSWORD_DECODED=$(printf '%s' "$POSTGRES_PASSWORD" | python3 -c "import sys, urllib.parse; print(urllib.parse.unquote(sys.stdin.read().strip()), end='')")
fi

# ── Postgres backup ──────────────────────────────────────────────────
BACKUP_DIR="$REPO_ROOT/volumes/db/backups"
mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date +"%d-%m-%y-%H-%M-%S")
BACKUP_FILE="$BACKUP_DIR/mattermost_${TIMESTAMP}.sql.gz"

echo "[0/4] Backing up PostgreSQL database..."
if PGPASSWORD="$POSTGRES_PASSWORD_DECODED" pg_dump \
    -h localhost \
    -U "${POSTGRES_USER:-mmuser_prod}" \
    "${POSTGRES_DB:-mattermost_production}" \
    | gzip > "$BACKUP_FILE"; then
  echo "✓ Backup saved → $BACKUP_FILE ($(du -sh "$BACKUP_FILE" | cut -f1))"
else
  echo "⚠️  Backup failed — continuing without backup (check DB credentials)"
  rm -f "$BACKUP_FILE"
fi
echo ""

# ── Fix plugins directory permissions ───────────────────────────────
echo "      Fixing plugins directory permissions..."
sudo chmod 777 "$REPO_ROOT/volumes/app/mattermost/plugins" -R
echo "✓ Plugins directory set to 777"
echo ""

# ── Build webapp and server in parallel ─────────────────────────────
echo "[1/4] Building webapp and server in parallel..."
echo "      Logs: /tmp/webapp-build.log  /tmp/server-build.log"
echo ""

(
  cd "$REPO_ROOT/webapp"
  npm run build --workspace=channels > /tmp/webapp-build.log 2>&1
  echo "✓ Webapp build complete"
) &
WEBAPP_PID=$!

(
  cd "$REPO_ROOT/server"
  make setup-go-work > /tmp/gowork.log 2>&1
  make build-linux-amd64 \
    BUILD_NUMBER=custom \
    BUILD_TAGS="sourceavailable" \
    BUILD_ENTERPRISE_DIR=./enterprise \
    > /tmp/server-build.log 2>&1
  echo "✓ Server build complete"
) &
SERVER_PID=$!

# Wait for both and check exit codes
WEBAPP_OK=0
SERVER_OK=0

wait $WEBAPP_PID || WEBAPP_OK=$?
wait $SERVER_PID || SERVER_OK=$?

if [ $WEBAPP_OK -ne 0 ]; then
  echo "❌ Webapp build FAILED — see /tmp/webapp-build.log"
  tail -20 /tmp/webapp-build.log
  exit 1
fi

if [ $SERVER_OK -ne 0 ]; then
  echo "❌ Server build FAILED — see /tmp/server-build.log"
  tail -20 /tmp/server-build.log
  exit 1
fi

echo ""
echo "[2/4] Building mmctl..."
cd "$REPO_ROOT/server"
make mmctl-build >> /tmp/server-build.log 2>&1
echo "✓ mmctl build complete"

echo ""
ls -lh "$REPO_ROOT/server/bin/mattermost" "$REPO_ROOT/server/bin/mmctl"
echo ""

# ── Rebuild Docker image and restart ────────────────────────────────
echo "[3/4] Rebuilding Docker image and restarting containers..."
cd "$REPO_ROOT"
sudo docker compose -f docker-compose.prod.yml up -d --build

echo ""
echo "[4/4] Waiting for health check..."
sleep 15

PING=$(curl -sf http://localhost:8065/api/v4/system/ping 2>/dev/null || true)
if echo "$PING" | grep -q '"OK"'; then
  echo "✓ Mattermost is up and healthy"
else
  echo "⚠️  Health check not yet ready — check logs:"
  echo "   sudo docker compose -f docker-compose.prod.yml logs -f mattermost"
fi

echo ""
echo "================================"
echo "  Deploy complete!"
echo "================================"
sudo docker compose -f docker-compose.prod.yml ps
