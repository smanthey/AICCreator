# NAS Dashboard Hosting (Access Anywhere)

This hosts all architect dashboards behind HTTPS on the NAS and makes them reachable from anywhere.

## What gets exposed

From one base URL:

- `/` (Mission Control)
- `/local-alternatives`
- `/offgrid-home`
- `/workshop-openclaw`
- `/openclaw-creator-studio`
- `/api/*` (still API-key protected)

## Files added

- `docker-compose.nas.dashboard.yml`
- `infra/caddy/Caddyfile`
- `env.nas.dashboard.example`

## 1) Prepare env on NAS

Copy and edit:

```bash
cp env.nas.dashboard.example .env.nas.dashboard
```

Set:

- `DASHBOARD_DOMAIN` (DNS name pointed to NAS or tunnel)
- `DASHBOARD_EMAIL`
- `DASHBOARD_BASICAUTH_USER`
- `DASHBOARD_BASICAUTH_HASH`
- `ARCHITECT_API_KEY`
- Optional `CLOUDFLARE_TUNNEL_TOKEN`

Generate the basic-auth hash:

```bash
docker run --rm caddy:2.9-alpine caddy hash-password --plaintext 'YOUR_STRONG_PASSWORD'
```

Put the hash result into `DASHBOARD_BASICAUTH_HASH`.

## 2) Start dashboard stack

Without tunnel (direct HTTPS on NAS):

```bash
set -a; source .env.nas.dashboard; set +a
npm run compose:nas:dashboard
```

With Cloudflare tunnel (recommended when no port-forwarding):

```bash
set -a; source .env.nas.dashboard; set +a
npm run compose:nas:dashboard:tunnel
```

## 3) Verify

```bash
docker compose -f docker-compose.nas.dashboard.yml ps
curl -s https://$DASHBOARD_DOMAIN/health
curl -s https://$DASHBOARD_DOMAIN/api/progress -H "x-api-key: $ARCHITECT_API_KEY" | jq '.status'
```

## 4) Security defaults

- Caddy `basic_auth` protects dashboard pages.
- `/api/*` still requires `ARCHITECT_API_KEY`.
- CORS is restricted by `ARCHITECT_ALLOWED_ORIGINS`.

## Local + NAS at the same time

Hosting on NAS does not disable local development.

- Local still works at `http://127.0.0.1:4051` (your PM2/local process).
- NAS-hosted URL works at `https://$DASHBOARD_DOMAIN`.
- Keep both origins in `ARCHITECT_ALLOWED_ORIGINS` so browser API calls succeed from both.

## 5) Stop

```bash
npm run compose:nas:dashboard:down
```
