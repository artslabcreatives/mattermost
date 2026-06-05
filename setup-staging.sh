#!/usr/bin/env bash
# setup-staging.sh — One-shot setup for mattermost-collab-staging
# Run once as root: sudo bash /var/www/mattermost-collab-staging/setup-staging.sh

set -euo pipefail

STAGING_DIR="/var/www/mattermost-collab-staging"
PROD_DIR="/var/www/mattermost-collab-prod"
STAGING_DB="mattermost_staging"
STAGING_USER="mmuser_staging"
STAGING_PASS="StAgInG_s3cur3_2024!xR"
PROD_DB="mattermost_production"
STAGING_DOMAIN="staging.collab.artslabcreatives.com"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

[[ $EUID -ne 0 ]] && error "Run as root: sudo bash $0"

cd "$STAGING_DIR"

# 1. Create PostgreSQL user if needed
info "Setting up PostgreSQL staging user..."
if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${STAGING_USER}'" | grep -q 1; then
    warn "User '${STAGING_USER}' already exists."
else
    sudo -u postgres psql -c "CREATE USER ${STAGING_USER} WITH PASSWORD '${STAGING_PASS}';"
fi

# 2. Drop and recreate staging DB for a clean clone
info "Creating fresh staging database..."
sudo -u postgres psql -c "DROP DATABASE IF EXISTS ${STAGING_DB};"
sudo -u postgres psql -c "CREATE DATABASE ${STAGING_DB} OWNER ${STAGING_USER} ENCODING 'UTF8';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${STAGING_DB} TO ${STAGING_USER};"

# 3. Clone production -> staging
info "Cloning production DB '${PROD_DB}' -> '${STAGING_DB}' ..."
sudo -u postgres pg_dump "${PROD_DB}" | sudo -u postgres psql "${STAGING_DB}"

# Fix object ownership
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
info "Database clone complete."

# 4. Sync volumes from production (config, data, plugins)
info "Syncing Mattermost volumes from production..."
PROD_MM="${PROD_DIR}/volumes/app/mattermost"
STAGING_MM="${STAGING_DIR}/volumes/app/mattermost"
mkdir -p "${STAGING_MM}"

rsync -a --delete "${PROD_MM}/config/"          "${STAGING_MM}/config/"
rsync -a --delete "${PROD_MM}/data/"            "${STAGING_MM}/data/"
rsync -a --delete "${PROD_MM}/plugins/"         "${STAGING_MM}/plugins/"
rsync -a --delete "${PROD_MM}/client/plugins/"  "${STAGING_MM}/client/plugins/" 2>/dev/null || true
info "Volume sync complete."

# 5. Patch config.json site URL
CONFIG_JSON="${STAGING_MM}/config/config.json"
if [[ -f "${CONFIG_JSON}" ]]; then
    info "Patching config.json for staging..."
    python3 - <<PYEOF
import json
with open('${CONFIG_JSON}') as f: cfg = json.load(f)
cfg.setdefault('ServiceSettings', {})['SiteURL'] = 'https://${STAGING_DOMAIN}'
cfg.setdefault('EmailSettings', {})['SendEmailNotifications'] = False
with open('${CONFIG_JSON}', 'w') as f: json.dump(cfg, f, indent=4)
print("config.json patched.")
PYEOF
fi

# 6. Fix permissions (Mattermost runs as uid/gid 2000)
info "Setting volume permissions..."
chown -R 2000:2000 "${STAGING_DIR}/volumes/" || warn "chown skipped (may already be correct)"

# 7. Enable nginx site
NGINX_ENABLED="/etc/nginx/sites-enabled/collab-mattermost-staging.conf"
NGINX_AVAIL="/etc/nginx/sites-available/collab-mattermost-staging.conf"
[[ ! -f "${NGINX_AVAIL}" ]] && error "Nginx config not found at ${NGINX_AVAIL}"
if [[ ! -L "${NGINX_ENABLED}" ]]; then
    ln -s "${NGINX_AVAIL}" "${NGINX_ENABLED}"
fi
nginx -t && systemctl reload nginx
info "Nginx site enabled."

# 8. Obtain SSL certificate
if [[ ! -d "/etc/letsencrypt/live/${STAGING_DOMAIN}" ]]; then
    info "Obtaining SSL certificate for ${STAGING_DOMAIN}..."
    certbot --nginx -d "${STAGING_DOMAIN}" --non-interactive --agree-tos \
        --email "admin@artslabcreatives.com" --redirect
    nginx -t && systemctl reload nginx
else
    warn "SSL certificate already exists for ${STAGING_DOMAIN}."
fi

# 9. Launch staging stack
info "Starting staging Docker Compose stack..."
docker compose -f "${STAGING_DIR}/docker-compose.staging.yml" \
    --env-file "${STAGING_DIR}/.env" \
    --project-name mattermost-staging \
    up -d

info ""
info "=========================================================="
info " Staging is up: https://${STAGING_DOMAIN}"
info " DB: ${STAGING_DB} | Ports: MM=8066, TS=8112, Calls=8446"
info " Logs: docker logs -f mattermost-staging-server"
info "=========================================================="
