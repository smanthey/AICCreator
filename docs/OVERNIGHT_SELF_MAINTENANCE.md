# Overnight Self-Maintenance (4:00 / 4:30)

This config runs two unattended maintenance jobs daily:

1. `04:00` — update + gateway restart + skills sync + gateway health check
2. `04:30` — critical file manifest + secret sanitization + commit/push to private backup repo

## Jobs

- PM2 app: `claw-overnight-maintenance`
  - script: `scripts/overnight-self-maintenance.js`
  - cron: `0 4 * * *`
- PM2 app: `claw-overnight-backup`
  - script: `scripts/overnight-backup-sanitize-push.js`
  - cron: `30 4 * * *`

## Monitoring destination (`#monitoring`)

Set at least one:

- `MONITORING_SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...`
- or Telegram fallback:
  - `TELEGRAM_BOT_TOKEN=...`
  - `MONITORING_TELEGRAM_CHAT_ID=...` (or `TELEGRAM_OPERATOR_CHAT_ID`)

If a job fails, it sends a failure alert.

## Backup repo settings

- `BACKUP_REPO_PATH=$HOME/claw-architect-backup` (default if unset)
- `BACKUP_REPO_GIT_URL=git@github.com:<you>/<private-backup-repo>.git` (required if path not cloned yet)
- `BACKUP_REPO_BRANCH=main` (default)

## What gets sanitized

The backup script replaces likely secrets with placeholders:

- private key blocks -> `[PRIVATE_KEY]`
- common API keys/tokens -> `[API_KEY]` / `[TOKEN]`
- DB URI passwords -> `[PASSWORD]`
- secret-like env/value assignments -> `[API_KEY]`

## Critical file coverage

The backup job writes `_meta/critical-files-YYYY-MM-DD.json` in backup repo, including:

- `SOUL.md`, `MEMORY.md`, `AGENTS.md`, `IDENTITY.md`, `USER.md`
- PM2 cron configs (`ecosystem*.config.js`)
- skills under `agents/skills/`
- plus tracked workspace files in sanitized form

## Enable

```bash
cd $HOME/claw-architect
npm run pm2:background:reload
pm2 save
```

## Dry run checks

```bash
npm run overnight:maintain -- --dry-run
npm run overnight:backup -- --dry-run
```

