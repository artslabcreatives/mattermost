# Uppy Companion — Deployment Guide

## Overview

This directory contains the deployment configuration for
[Uppy Companion](https://uppy.io/docs/companion/), which enables Mattermost
users to upload files from remote providers (Google Drive, Dropbox, OneDrive,
etc.) directly to DigitalOcean Spaces without routing file bytes through the
Mattermost server.

## Prerequisites

- DigitalOcean Spaces bucket (or any S3-compatible store)
- Docker + Docker Compose
- Mattermost configured with the S3 file backend

## Quick Start

1. Copy the environment template and fill in your credentials:

   ```bash
   cp .env.example .env
   $EDITOR .env
   ```

2. Start Companion:

   ```bash
   docker compose up -d
   ```

3. Verify it is healthy:

   ```bash
   curl http://localhost:3020/metrics
   ```

## Nginx Integration

Add the contents of `nginx-companion.conf` to the `server {}` block of your
Mattermost Nginx configuration.  Companion will then be reachable at
`https://YOUR_DOMAIN/api/companion/`.

Set the Companion URL in the Uppy configuration (see
`webapp/channels/src/hooks/useUppyDirectUpload.ts`):

```ts
companionUrl: 'https://YOUR_DOMAIN/api/companion',
```

## Enabling Direct Uploads in Mattermost

In your Mattermost System Console → File Storage, or in `config.json`:

```json
{
  "FileSettings": {
    "EnableDirectUploads": true
  }
}
```

## Security Notes

- `COMPANION_UPLOAD_URLS` **must** be set to your Spaces bucket endpoint.
  Companion will refuse to upload to any other URL, preventing SSRF.
- `COMPANION_SECRET` must be a long, random string.  Rotate it if compromised.
- `COMPANION_CLIENT_ORIGINS` must list only your Mattermost domain(s).
  Wildcards (`*`) are never allowed in production.
- OAuth credentials (Google Drive, Dropbox, OneDrive) should be stored in the
  `.env` file and never committed to source control.

## Horizontal Scaling

Uncomment the `redis` service in `docker-compose.yml` and set
`COMPANION_REDIS_URL` to enable Redis-backed sessions, which allows you to
run multiple Companion replicas behind a load balancer.
