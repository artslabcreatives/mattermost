#!/bin/bash
set -eo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RUN_AS_USER="${SUDO_USER:-$USER}"
RUN_AS_HOME="$(eval echo "~$RUN_AS_USER")"

create_log_dir() {
  local base_dir="${TMPDIR:-/tmp}"
  local log_dir=""

  if log_dir=$(mktemp -d "${base_dir%/}/mattermost-rebuild-XXXXXX" 2>/dev/null); then
    printf '%s\n' "$log_dir"
    return 0
  fi

  log_dir="$REPO_ROOT/.tmp/rebuild-logs"
  mkdir -p "$log_dir"
  chmod 700 "$log_dir"
  printf '%s\n' "$log_dir"
}

run_as_build_user() {
  if [ "$(id -un)" = "$RUN_AS_USER" ]; then
    bash -lc "$1"
  else
    sudo -u "$RUN_AS_USER" bash -lc "$1"
  fi
}

setup_node_env_cmd() {
  cat <<EOF
set -eo pipefail
export NVM_DIR="${RUN_AS_HOME}/.nvm"
if [ -s "\$NVM_DIR/nvm.sh" ]; then
  . "\$NVM_DIR/nvm.sh"
fi
cd "$REPO_ROOT/webapp"
if command -v nvm >/dev/null 2>&1 && [ -f "$REPO_ROOT/.nvmrc" ]; then
  if ! nvm use >/dev/null 2>&1; then
    nvm install >/dev/null
    nvm use >/dev/null
  fi
fi
command -v node >/dev/null 2>&1
command -v npm >/dev/null 2>&1
node -v
npm -v
EOF
}

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
NODE_ENV_CMD="$(setup_node_env_cmd)"

if ! run_as_build_user "$NODE_ENV_CMD" >/dev/null 2>&1; then
  echo "❌ Node.js/npm are not available for user '$RUN_AS_USER'."
  echo "   Install nvm + Node $(cat "$REPO_ROOT/.nvmrc" 2>/dev/null || echo "from .nvmrc") or run rebuild with that user's shell environment loaded."
  exit 1
fi

LOG_DIR="$(create_log_dir)"
WEBAPP_LOG="$(mktemp "$LOG_DIR/webapp-build-XXXXXX.log")"
SERVER_LOG="$(mktemp "$LOG_DIR/server-build-XXXXXX.log")"
GOWORK_LOG="$(mktemp "$LOG_DIR/gowork-XXXXXX.log")"

echo "[1/4] Building webapp and server in parallel..."
echo "      Logs: $WEBAPP_LOG  $SERVER_LOG"
echo "      Go work setup log: $GOWORK_LOG"
echo ""

(
  run_as_build_user "$NODE_ENV_CMD
npm install --workspace=channels
npm run build --workspace=channels" > "$WEBAPP_LOG" 2>&1
  echo "✓ Webapp build complete"
) &
WEBAPP_PID=$!

(
  cd "$REPO_ROOT/server"
  make setup-go-work > "$GOWORK_LOG" 2>&1
  make build-linux-amd64 \
    BUILD_NUMBER=custom \
    BUILD_TAGS="sourceavailable" \
    BUILD_ENTERPRISE_DIR=./enterprise \
    > "$SERVER_LOG" 2>&1
  echo "✓ Server build complete"
) &
SERVER_PID=$!

# Wait for both and check exit codes
WEBAPP_OK=0
SERVER_OK=0

wait $WEBAPP_PID || WEBAPP_OK=$?
wait $SERVER_PID || SERVER_OK=$?

if [ $WEBAPP_OK -ne 0 ]; then
  echo "❌ Webapp build FAILED — see $WEBAPP_LOG"
  tail -20 "$WEBAPP_LOG"
  exit 1
fi

if [ $SERVER_OK -ne 0 ]; then
  echo "❌ Server build FAILED — see $SERVER_LOG"
  tail -20 "$SERVER_LOG"
  exit 1
fi

echo ""
echo "[2/4] Building mmctl..."
cd "$REPO_ROOT/server"
make mmctl-build >> "$SERVER_LOG" 2>&1
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

sudo chmod 777 "$REPO_ROOT/volumes/app/mattermost/plugins" -R
sudo chmod 777 ./volumes/app/mattermost/plugins/ -R