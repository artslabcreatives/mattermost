# Mattermost Production Deployment Guide

This guide covers deploying Mattermost from source using Docker Compose.

## Quick Start

1. **Copy environment file and configure**:
   ```bash
   cp .env.example .env
   nano .env  # Edit configuration
   ```

2. **Build and start**:
   ```bash
   docker compose -f docker-compose.prod.yml up -d --build
   ```

3. **Access Mattermost**:
   - Open browser to `http://your-server:8065`
   - Create first admin account
   - Complete setup wizard

## Prerequisites

- Docker Engine 20.10+
- Docker Compose 2.0+
- 2GB RAM minimum (4GB+ recommended)
- 10GB disk space minimum

## Environment Configuration

### Required Settings

Edit `.env` file and configure:

```bash
# Change this password!
POSTGRES_PASSWORD=your_secure_password_here

# Your domain or IP
MM_SITEURL=http://your-domain.com
```

### Optional Email Configuration

For email notifications and password resets:

```bash
MM_SEND_EMAIL=true
MM_SMTP_SERVER=smtp.gmail.com
MM_SMTP_PORT=587
MM_SMTP_USERNAME=your-email@gmail.com
MM_SMTP_PASSWORD=your-app-password
MM_FEEDBACK_EMAIL=noreply@yourdomain.com
MM_REPLYTO_EMAIL=noreply@yourdomain.com
```

## Docker Commands

### Start services
```bash
docker compose -f docker-compose.prod.yml up -d
```

### View logs
```bash
# All services
docker compose -f docker-compose.prod.yml logs -f

# Mattermost only
docker compose -f docker-compose.prod.yml logs -f mattermost

# PostgreSQL only
docker compose -f docker-compose.prod.yml logs -f postgres
```

### Stop services
```bash
docker compose -f docker-compose.prod.yml down
```

### Restart services
```bash
docker compose -f docker-compose.prod.yml restart
```

### Rebuild after code changes
```bash
docker compose -f docker-compose.prod.yml up -d --build
```

## Data Persistence

All data is stored in Docker volumes:

- `postgres_data` - Database data
- `mattermost_config` - Configuration files
- `mattermost_data` - Uploaded files and attachments
- `mattermost_logs` - Server logs
- `mattermost_plugins` - Installed plugins
- `mattermost_bleve_indexes` - Search indexes

### Backup

```bash
# Backup database
docker exec mattermost-postgres pg_dump -U mmuser mattermost > mattermost_backup_$(date +%Y%m%d).sql

# Backup volumes
docker run --rm -v mattermost_data:/data -v $(pwd):/backup alpine tar czf /backup/mattermost_data_$(date +%Y%m%d).tar.gz -C /data .
```

### Restore

```bash
# Restore database
docker exec -i mattermost-postgres psql -U mmuser mattermost < mattermost_backup.sql

# Restore volumes
docker run --rm -v mattermost_data:/data -v $(pwd):/backup alpine sh -c "cd /data && tar xzf /backup/mattermost_data.tar.gz"
```

## Email-Only Login Feature

This build includes a development endpoint for passwordless login:

**Endpoint**: `POST /api/v4/users/login/email_only`

```bash
curl -X POST http://localhost:8065/api/v4/users/login/email_only \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@example.com"}'
```

⚠️ **Security Warning**: This endpoint has NO authentication. Only use in:
- Development environments
- Trusted internal networks
- With additional security layers (VPN, firewall)

See [EMAIL_LOGIN_FEATURE.md](EMAIL_LOGIN_FEATURE.md) for details.

## HTTPS/SSL Configuration

For production, use a reverse proxy like nginx or Caddy:

### Option 1: Nginx with Let's Encrypt

1. Install nginx and certbot:
   ```bash
   sudo apt update
   sudo apt install nginx certbot python3-certbot-nginx
   ```

2. Create nginx config `/etc/nginx/sites-available/mattermost`:
   ```nginx
   upstream mattermost {
       server localhost:8065;
       keepalive 32;
   }

   proxy_cache_path /var/cache/nginx/mattermost levels=1:2 keys_zone=mattermost_cache:10m max_size=3g inactive=120m use_temp_path=off;

   server {
       listen 80;
       server_name your-domain.com;
       
       location ~ /api/v[0-9]+/(users/)?websocket$ {
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
           proxy_set_header Host $http_host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_set_header X-Frame-Options SAMEORIGIN;
           proxy_buffers 256 16k;
           proxy_buffer_size 16k;
           client_body_timeout 60;
           send_timeout 300;
           lingering_timeout 5;
           proxy_connect_timeout 90;
           proxy_send_timeout 300;
           proxy_read_timeout 90s;
           proxy_http_version 1.1;
           proxy_pass http://mattermost;
       }

       location / {
           client_max_body_size 50M;
           proxy_set_header Connection "";
           proxy_set_header Host $http_host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_set_header X-Frame-Options SAMEORIGIN;
           proxy_buffers 256 16k;
           proxy_buffer_size 16k;
           proxy_read_timeout 600s;
           proxy_http_version 1.1;
           proxy_pass http://mattermost;
       }
   }
   ```

3. Enable and get certificate:
   ```bash
   sudo ln -s /etc/nginx/sites-available/mattermost /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl restart nginx
   sudo certbot --nginx -d your-domain.com
   ```

4. Update `.env`:
   ```bash
   MM_SITEURL=https://your-domain.com
   ```

### Option 2: Caddy (Automatic HTTPS)

1. Create `Caddyfile`:
   ```
   your-domain.com {
       reverse_proxy localhost:8065
   }
   ```

2. Run Caddy:
   ```bash
   docker run -d \
     --name caddy \
     --network mattermost-network \
     -p 80:80 -p 443:443 \
     -v $PWD/Caddyfile:/etc/caddy/Caddyfile \
     -v caddy_data:/data \
     caddy:latest
   ```

## Troubleshooting

### Container won't start

```bash
# Check logs
docker compose -f docker-compose.prod.yml logs

# Check container status
docker compose -f docker-compose.prod.yml ps
```

### Database connection issues

```bash
# Verify database is running
docker exec mattermost-postgres pg_isready -U mmuser

# Check database connectivity
docker exec mattermost-postgres psql -U mmuser -d mattermost -c "SELECT version();"
```

### Reset admin password

```bash
docker exec -it mattermost-server /mattermost/bin/mmctl user reset-password admin@example.com --config /mattermost/config/config.json
```

### Permission issues

```bash
# Fix volume permissions
docker compose -f docker-compose.prod.yml down
docker volume rm mattermost_config mattermost_data mattermost_logs
docker compose -f docker-compose.prod.yml up -d
```

## Performance Tuning

### For high-traffic deployments

Edit `.env`:

```bash
# Database connections
MM_SQLSETTINGS_MAXOPENCONNS=300
MM_SQLSETTINGS_MAXIDLECONNS=20

# Use read replicas if available
MM_SQLSETTINGS_DATASOURCEREPLICAS=postgres://mmuser:password@postgres-replica:5432/mattermost

# Enable performance monitoring
MM_METRICSSETTINGS_ENABLE=true
MM_METRICSSETTINGS_LISTENADDRESS=:8067
```

## Monitoring

### Health checks

```bash
# Server health
curl http://localhost:8065/api/v4/system/ping

# Container health
docker compose -f docker-compose.prod.yml ps
```

### Metrics

Mattermost exposes Prometheus metrics on port 8067 (if enabled):

```bash
MM_METRICSSETTINGS_ENABLE=true
MM_METRICSSETTINGS_LISTENADDRESS=:8067
```

Then configure Prometheus to scrape `http://mattermost:8067/metrics`

## Upgrading

1. **Backup first** (see Backup section above)

2. **Pull latest code**:
   ```bash
   git pull
   ```

3. **Rebuild and restart**:
   ```bash
   docker compose -f docker-compose.prod.yml up -d --build
   ```

4. **Verify**:
   ```bash
   docker compose -f docker-compose.prod.yml logs -f mattermost
   ```

## Security Best Practices

1. ✅ Change default `POSTGRES_PASSWORD`
2. ✅ Use HTTPS with valid SSL certificate
3. ✅ Configure firewall (only ports 80/443 exposed)
4. ✅ Enable MFA: `MM_ENABLE_MFA=true`
5. ✅ Regular backups
6. ✅ Keep system updated
7. ✅ Use strong passwords
8. ✅ Disable email-only login in production
9. ✅ Configure rate limiting
10. ✅ Monitor logs for suspicious activity

## Support

- Documentation: https://docs.mattermost.com
- Community: https://mattermost.com/community/
- Issues: https://github.com/mattermost/mattermost/issues

## License

This deployment uses Mattermost Community Edition (MIT License).
See [LICENSE.txt](LICENSE.txt) for details.
