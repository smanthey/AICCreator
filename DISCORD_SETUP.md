# Discord Multi-Agent Setup

OpenClaw's Discord gateway routes messages to specialized Claude agents based on channel. Each channel maintains its own rolling memory. Two cron jobs handle overnight auto-update (4:00 AM) and secure backup (4:30 AM).

---

## 1. Create a Discord Application & Bot

1. Go to **https://discord.com/developers/applications** → **New Application** → name it `OpenClaw`
2. In the left sidebar → **Bot** → **Add Bot**
3. Under **Token** → **Reset Token** → copy the token → save as `DISCORD_BOT_TOKEN` in `.env`
4. Under **Privileged Gateway Intents**, enable:
   - ✅ **MESSAGE CONTENT INTENT** (required to read message text)
   - ✅ **SERVER MEMBERS INTENT** (optional, for member lookups)
5. Go to **OAuth2 → URL Generator**:
   - Scopes: `bot`
   - Bot Permissions: `Send Messages`, `Read Message History`, `Add Reactions`, `Use Slash Commands`
   - Copy the generated URL → open it in a browser → **Add to Server** (your OpenClaw server)

---

## 2. Create Your Discord Server

1. Create a new Discord server (or use an existing one)
2. Create these **text channels** (exact names matter — the bot routes by channel name):
   - `#research-agent` — deep dives, competitive intel, analysis
   - `#content-agent` — writing, editing, copywriting
   - `#code-agent` — development, debugging, architecture
   - `#admin-agent` — scheduling, logistics, life admin
   - `#monitoring` — automated alerts (bot posts here, doesn't respond to chat)
3. Copy your **Server ID**: Right-click the server name → **Copy Server ID** (requires Developer Mode: User Settings → Advanced → Developer Mode)

---

## 3. Create a Monitoring Webhook

The `#monitoring` channel receives automated reports via webhook (no bot token needed):

1. Open `#monitoring` channel settings → **Integrations** → **Webhooks** → **New Webhook**
2. Name it `OpenClaw Monitor`, keep the default avatar
3. Click **Copy Webhook URL** → save as `DISCORD_MONITORING_WEBHOOK_URL` in `.env`

---

## 4. Add Environment Variables

Add these to your `.env` file in the claw-architect repo root:

```bash
# Discord Bot (required)
DISCORD_BOT_TOKEN=your_bot_token_here
DISCORD_GUILD_ID=your_server_id_here        # optional: restrict bot to one server

# Discord Monitoring Webhook (required for overnight alerts)
DISCORD_MONITORING_WEBHOOK_URL=https://discord.com/api/webhooks/...

# Discord gateway tuning (optional, these are defaults)
DISCORD_MAX_CONTEXT_TURNS=20                # rolling memory window per channel
DISCORD_MODEL=claude-opus-4-5-20251101      # Claude model to use
DISCORD_BROWSER_FALLBACK=true               # use Playwright when APIs are blocked

# Backup repo (required for 4:30am backup)
BACKUP_REPO_PATH=/Users/tatsheen/claw-architect-backup
BACKUP_REPO_GIT_URL=git@github.com:yourname/claw-architect-backup.git
BACKUP_REPO_BRANCH=main
```

---

## 5. Install discord.js and Start

```bash
# In your claw-architect directory:
npm install

# Test the gateway manually first:
node scripts/discord-gateway.js

# Test the health check:
node scripts/discord-health-check.js

# If both look good, reload PM2:
pm2 reload ecosystem.background.config.js --update-env
pm2 save

# Verify the gateway is running:
pm2 list | grep discord
```

---

## 6. How It Works

### Talking to Agents

Just post in the appropriate channel — the bot responds automatically:

| Channel | Agent | Best for |
|---------|-------|----------|
| `#research-agent` | Research | Market intel, deep dives, fact-finding, trend analysis |
| `#content-agent` | Content | Blog posts, social copy, emails, brand voice |
| `#code-agent` | Code | Development, debugging, architecture, code review |
| `#admin-agent` | Admin | Scheduling, logistics, planning, admin tasks |

You can also `@mention` the bot in any channel to get a response outside its normal channels.

### Commands (in any agent channel)

| Command | Effect |
|---------|--------|
| `!clear` | Wipe this channel's conversation memory |
| `!memory` | Show how many turns are in memory |
| `!status` | Gateway uptime, message count, model info |

### Memory

Each channel stores its conversation in `agent-state/discord/{channel-name}/context.json`. Memory is capped at 20 turns (configurable via `DISCORD_MAX_CONTEXT_TURNS`). Use `!clear` to reset.

### Browser Fallback

When `DISCORD_BROWSER_FALLBACK=true`, if an agent needs to fetch data from a site that blocks direct API access, it falls back to Playwright headless browser automation. Every website is a slow API.

---

## 7. Overnight Cron Jobs

Both run automatically via PM2:

### 4:00 AM — Auto-Update (`claw-overnight-maintenance`)
1. `npm install` — updates packages, captures what changed
2. `pm2 restart claw-discord-gateway` — applies updates
3. `node scripts/clawdhub.js sync` — syncs skill registry
4. `node scripts/discord-health-check.js` — verifies gateway is healthy

Posts to `#monitoring` with step results, version info, and any errors.

### 4:30 AM — Secure Backup (`claw-overnight-backup`)
1. Collects all tracked files + critical files (SOUL.md, MEMORY.md, cron configs, skills)
2. Scans every text file for leaked secrets:
   - Private keys (RSA, EC, OpenSSH)
   - GitHub tokens (`gh[pousr]_...`)
   - Slack tokens (`xox[baprs]-...`)
   - Stripe keys (`sk_live_...`, `sk_test_...`)
   - Google API keys (`AIza...`)
   - JWTs
   - Postgres connection strings with passwords
   - Any `KEY=value` or `"key": "value"` env-style patterns
3. Replaces secrets with `[API_KEY]`, `[TOKEN]`, `[PRIVATE_KEY]`, `[PASSWORD]`
4. Commits with message: `backup 2026-02-28: files=312 sanitized=3 critical=8`
5. Pushes to your private GitHub backup repo
6. Posts one-line confirmation to `#monitoring`; alerts with 🚨 if anything fails

---

## 8. Troubleshooting

**Bot doesn't respond:**
- Check `pm2 logs claw-discord-gateway` for errors
- Verify `DISCORD_BOT_TOKEN` is set correctly in `.env`
- Confirm the bot has been invited to your server and can see the channel
- Make sure **MESSAGE CONTENT INTENT** is enabled in the Developer Portal

**Health check fails:**
- Run `node scripts/discord-health-check.js` manually to see the error
- Set `DISCORD_HEALTH_RESTART_GATEWAY=true` in PM2 env to auto-recover

**Backup fails to push:**
- Ensure `BACKUP_REPO_GIT_URL` is set and SSH keys are configured for that remote
- Run `node scripts/overnight-backup-sanitize-push.js --dry-run` to test without pushing

**No monitoring alerts:**
- Verify `DISCORD_MONITORING_WEBHOOK_URL` is set and valid
- Test: `node -e "require('./control/monitoring-notify').notifyMonitoring('test')"` from the repo root
