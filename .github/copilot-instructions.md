# Copilot instructions for mattermost-collab-prod

## Project map and architecture
- Mattermost is a monorepo: Go server in [server/](server/), React web app in [webapp/](webapp/), API docs in [api/](api/), and E2E tests in [e2e-tests/](e2e-tests/).
- The server builds into a single Linux binary and relies on PostgreSQL; see high-level context in [README.md](README.md).
- Web app code is split into packages; most of the former mattermost-webapp repo now lives under [webapp/channels/](webapp/channels/) with shared packages in [webapp/platform/](webapp/platform/).
- API reference is OpenAPI YAML in [api/v4/source/](api/v4/source/), built into [api/v4/html/](api/v4/html/).

## Key workflows and commands
- Production-like local deployment from source: run `./deploy.sh` or `docker compose -f docker-compose.prod.yml up -d --build` from repo root (see [README.md](README.md)).
- Web app uses npm workspaces; run npm commands from [webapp/](webapp/) with `--workspace` (see [webapp/README.md](webapp/README.md)).
  - Example: `npm run build --workspace=platform/client --workspace=platform/components`.
- API docs: `make build` outputs the bundled OpenAPI YAML to `api/v4/html/static/mattermost-openapi-v4.yaml`; `make run` serves it at http://127.0.0.1:8080 (see [api/README.md](api/README.md)).
- E2E tests: run `make` in [e2e-tests/](e2e-tests/) to start server + Cypress smoke tests; use `TEST=playwright make` or `TEST=none make` (see [e2e-tests/README.md](e2e-tests/README.md)).
  - Optional `.ci/env` controls dockerized test services and env vars; make targets generate docker-compose files.

## Project-specific conventions
- Web app dependencies and scripts must be run via npm workspaces in [webapp/](webapp/); avoid running `npm` inside subpackages directly unless required.
- API docs are edited as YAML, with routes added to area-specific files (e.g., channels) and definitions/tags maintained in shared files (see [api/README.md](api/README.md)).
- E2E pipeline scripts depend on docker-compose and a make-driven flow; environment variables in `.ci/env` are the primary knobs for test setup (see [e2e-tests/README.md](e2e-tests/README.md)).

## Testing and tooling notes
- Text-processing tests can be triggered via `/test url` in a running server when Enable Testing is set; details in [server/tests/README.md](server/tests/README.md).
- Updating test plugin bundles requires re-signing with the provided GPG keys (see [server/tests/README.md](server/tests/README.md)).
