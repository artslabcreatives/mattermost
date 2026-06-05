#!/usr/bin/env bash
# clone-db.sh — Refresh staging DB from production (safe to run anytime)
# Usage: sudo bash /var/www/mattermost-collab-staging/clone-db.sh

set -euo pipefail

STAGING_DIR="/var/www/mattermost-collab-staging"
STAGING_DB="mattermost_staging"
STAGING_USER="mmuser_staging"
PROD_DB="mattermost_production"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

[[ $EUID -ne 0 ]] && error "Run as root: sudo bash $0"

info "Stopping staging Mattermost to drop connections..."
docker compose -f "${STAGING_DIR}/docker-compose.staging.yml" \
    --project-name mattermost-staging stop mattermost 2>/dev/null || true

info "Dropping and recreating staging DB..."
sudo -u postgres psql -c "DROP DATABASE IF EXISTS ${STAGING_DB};"
sudo -u postgres psql -c "CREATE DATABASE ${STAGING_DB} OWNER ${STAGING_USER} ENCODING 'UTF8';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${STAGING_DB} TO ${STAGING_USER};"

info "Cloning ${PROD_DB} -> ${STAGING_DB}..."
sudo -u postgres pg_dump "${PROD_DB}" | sudo -u postgres psql "${STAGING_DB}"

sudo -u postgres psql "${STAGING_DB}" -c "
DO \$\$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
    EXECUTE 'ALTER TABLE public.'||quote_ident(r.tablename)||' OWNER TO ${STAGING_USER}';
  END LOOP;
  FOR r IN SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema='public' LOOP
    EXECUTE 'ALTER SEQUENCE public.'||quote_ident(r.sequence_name)||' OWNER TO ${STAGING_USER}';
  END LOOP;
END \$\$;"

info "Restarting staging Mattermost..."
docker compose -f "${STAGING_DIR}/docker-compose.staging.yml" \
    --project-name mattermost-staging start mattermost

info "DB refresh complete."
