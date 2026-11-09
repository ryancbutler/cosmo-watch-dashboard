# COSMO dashboard

Private read-only watch dashboard and background collector, built with the Sites Vinext starter, React, TypeScript, Leaflet, and OpenStreetMap. The Python CLI is independent in `../cli/`.

## Setup and checks

Use Node 22.13 or newer. From this folder run `npm run install:ci`, `npm test`, `npm run typecheck`, and `python tests/trigger_test.py`. `npm run build` builds the Worker/site. The starter provides loopback simulated ChatGPT sign-in for local preview.

For a fresh preview, provision ignored `.dev.vars` containing `COSMO_EMAIL` and `COSMO_PASSWORD` only when live collection is needed. Prefer a separate private runtime checkout for live data: preview databases and credentials must not remain in this source checkout. `/demo` uses fictional fixtures and does not read the service or database.

## Documentation

- [Architecture and data](docs/ARCHITECTURE.md): collector boundaries, saved reports, timestamps, availability, and API evidence.
- [Operations](docs/OPERATIONS.md): UI behavior, history, migrations, scheduler, monitoring, and export.
- [Deployment](docs/DEPLOYMENT.md): generic configuration and private hosting requirements.
- [API contract](../api/README.md): endpoints and Swagger.

Deployment choices include [Docker Compose, Kubernetes, and a new private Sites installation](docs/DEPLOYMENT.md). All support `COSMO_DATA_MODE=realtime` (direct reads, no storage or history panels) or `history` (persistent reports; the default). The [Sites installation prompt](deploy/sites/INSTALL_PROMPT.md) creates a separate Site. The default hosting template enables D1 `DB` and MCP; no existing deployment is changed by these source templates.

### Homelab collector token

Stage `deploy/collector-vault-secrets.yaml` before applying the collector CronJob.
The Vault role `cosmo-collector-site-vso` reads `kv/data/apps/cosmo-collector/site`
and syncs the `service-token` key to `cosmo-site-service-vault`. Existing
installations can apply the guarded `deploy/collector-secret-ref.json` patch
to switch just the token volume. Keep the site's URL configuration and
the original Secret available for rollback.
