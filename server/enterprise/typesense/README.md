# Typesense Search Backend for Mattermost

This directory contains the Typesense search backend implementation for Mattermost. Typesense provides fast, typo-tolerant search capabilities for posts, channels, users, and files.

## Overview

Typesense is an open-source search engine optimized for instant search experiences. This integration allows Mattermost to use Typesense as an alternative search backend alongside Elasticsearch/OpenSearch.

## Features

- **Fast Search**: Optimized for speed with typo tolerance
- **Multiple Entity Types**: Supports searching posts, channels, users, and files
- **Real-time Indexing**: Live indexing with configurable batch sizes
- **Docker Integration**: Included in the Mattermost Docker stack
- **Easy Configuration**: Simple API key-based authentication

## Architecture

The implementation consists of:

- `common/common.go`: Shared constants for collection names
- `typesense/typesense.go`: Main implementation of the SearchEngineInterface
- `init.go`: Registration with the platform's search engine broker

## Configuration

### Environment Variables

Configure Typesense through environment variables in your `.env` file or docker-compose configuration:

```bash
# Typesense connection settings
MM_TYPESENSESETTINGS_CONNECTIONURL=http://typesense:8108
MM_TYPESENSESETTINGS_APIKEY=xyz

# Enable/disable features
MM_TYPESENSESETTINGS_ENABLEINDEXING=true
MM_TYPESENSESETTINGS_ENABLESEARCHING=true
MM_TYPESENSESETTINGS_ENABLEAUTOCOMPLETE=true

# Performance tuning
MM_TYPESENSESETTINGS_LIVEINDEXINGBATCHSIZE=10
MM_TYPESENSESETTINGS_BATCHSIZE=10000
MM_TYPESENSESETTINGS_REQUESTTIMEOUTSECONDS=30
MM_TYPESENSESETTINGS_SKIPTLSVERIFICATION=false
```

### Docker Setup

Typesense is automatically included in the Mattermost Docker stack:

#### Production (docker-compose.prod.yml)

```bash
# Start the stack
docker compose -f docker-compose.prod.yml up -d

# Check Typesense status
docker compose -f docker-compose.prod.yml ps typesense

# View Typesense logs
docker compose -f docker-compose.prod.yml logs -f typesense
```

#### Development (server/docker-compose.yaml)

Typesense is included as a service in the development stack and accessible at `http://localhost:8108`.

## Collections

The Typesense implementation creates four collections:

### 1. Posts
Fields: id, team_id, channel_id, user_id, message, hashtags, create_at, update_at, delete_at

### 2. Channels
Fields: id, team_id, name, display_name, purpose, header, type, create_at, update_at, delete_at

### 3. Users
Fields: id, username, first_name, last_name, nickname, email, teams, channels, create_at, update_at, delete_at

### 4. Files
Fields: id, channel_id, user_id, name, extension, content, create_at, update_at, delete_at

## API Endpoints

### Test Configuration
```
POST /api/v4/typesense/test
```
Tests the Typesense connection with the provided configuration.

### Purge Indexes
```
POST /api/v4/typesense/purge_indexes
```
Removes all documents from Typesense collections (admin only).

## Data Persistence

Typesense data is persisted to the host filesystem:

- Production: `./volumes/typesense/data`
- Development: Docker volume `typesense-data`

## Security Considerations

1. **API Key**: Change the default API key (`xyz`) in production
2. **Network**: Typesense should not be exposed directly to the internet
3. **TLS**: Enable TLS verification in production environments
4. **Access Control**: Only authenticated Mattermost users can search

## Performance Tuning

### Indexing Performance

- `LiveIndexingBatchSize`: Number of documents to batch before indexing (default: 10)
- `BatchSize`: Batch size for bulk indexing operations (default: 10000)

### Search Performance

- `RequestTimeoutSeconds`: Timeout for Typesense requests (default: 30)

## Monitoring

Check Typesense health:
```bash
curl http://localhost:8108/health
```

View collection statistics:
```bash
curl http://localhost:8108/collections/posts -H "X-TYPESENSE-API-KEY: xyz"
```

## Troubleshooting

### Connection Issues

If Mattermost cannot connect to Typesense:

1. Check Typesense is running: `docker ps | grep typesense`
2. Verify the connection URL in configuration
3. Ensure the API key matches between services
4. Check network connectivity between containers

### Indexing Issues

If documents are not being indexed:

1. Verify `EnableIndexing` is set to `true`
2. Check Mattermost logs for indexing errors
3. Verify Typesense collections exist
4. Check available disk space

### Search Issues

If search is not working:

1. Verify `EnableSearching` is set to `true`
2. Ensure documents have been indexed
3. Check search query syntax
4. Review Typesense logs for errors

## Migration from Database Search

To migrate from database search to Typesense:

1. Enable Typesense indexing:
   ```
   MM_TYPESENSESETTINGS_ENABLEINDEXING=true
   ```

2. Reindex existing content through the System Console or API

3. Enable Typesense searching:
   ```
   MM_TYPESENSESETTINGS_ENABLESEARCHING=true
   ```

4. Optionally disable database search:
   ```
   MM_SQLSETTINGS_DISABLEDATABASESEARCH=true
   ```

## License

This implementation is licensed under the Mattermost Enterprise License.
See LICENSE.enterprise for details.
