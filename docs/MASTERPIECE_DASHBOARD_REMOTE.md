# Masterpiece Dashboard (Remote Access)

## URL
- Primary URL: `https://<DASHBOARD_DOMAIN>/masterpiece`
- Main dashboard remains: `https://<DASHBOARD_DOMAIN>/`

## NAS Host Setup
1. Copy env template:
   - `cp env.nas.dashboard.example .env.nas.dashboard`
2. Fill at least:
   - `DASHBOARD_DOMAIN`
   - `DASHBOARD_EMAIL`
   - `DASHBOARD_BASICAUTH_USER`
   - `DASHBOARD_BASICAUTH_HASH`
   - `ARCHITECT_API_KEY`
3. Start dashboard stack on NAS:
   - `npm run -s compose:nas:dashboard`

## Access From Anywhere (No Port Forward)
1. Create a Cloudflare Tunnel for your dashboard hostname.
2. Put tunnel token in `.env.nas.dashboard`:
   - `CLOUDFLARE_TUNNEL_TOKEN=...`
3. Start tunnel profile:
   - `npm run -s compose:nas:dashboard:tunnel`
4. Open:
   - `https://<DASHBOARD_DOMAIN>/masterpiece`

## Security
- Caddy `basic_auth` protects the dashboard page.
- `/api/*` also requires `ARCHITECT_API_KEY` bearer token.
- The Masterpiece page stores API key in browser localStorage for your session.

## Health Checks
- `curl -I https://<DASHBOARD_DOMAIN>/masterpiece`
- `curl -H "Authorization: Bearer <ARCHITECT_API_KEY>" https://<DASHBOARD_DOMAIN>/api/masterpiece/summary`
