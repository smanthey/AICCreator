# Agent Team (Shared Context + Telegram Links)

This defines a 6-agent coordination lane with one-writer-per-file rules in:

- `~/notes/agents/shared-context/`

## Roles and owned files

- `PA/Coordinator` -> `DAILY-BRIEF.md`
- `X Growth` -> `X_DRAFTS.md`
- `Opportunities Scout` -> `OPPORTUNITIES.md`
- `Trading (paper only)` -> `TRADING_LOG.md`
- `Security Monitor` -> `SECURITY_STATUS.md`
- `Builder` -> `SHIP_LOG.md`

Ownership is enforced via:

- `~/notes/agents/shared-context/OWNERSHIP.json`

## Commands

Initialize workspace and seed files:

```bash
npm run agent:team:init
```

Run one agent:

```bash
npm run agent:team:run -- --agent opportunities_scout --refresh
```

Run all agents with refresh:

```bash
npm run agent:team:run:all
```

Send Telegram summary with links only:

```bash
npm run agent:team:telegram:summary
```

## Telegram behavior

- summaries + alerts only
- no giant message bodies
- each agent update posts the file path link target in shared-context

Uses:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_MONITORING_CHAT_ID` (fallback: `TELEGRAM_CHAT_ID`)

## PM2 scheduled jobs

`ecosystem.background.config.js` includes:

- `claw-team-pa-coordinator`
- `claw-team-x-growth`
- `claw-team-opportunities-scout`
- `claw-team-trading-paper`
- `claw-team-security-monitor`
- `claw-team-builder`
- `claw-team-telegram-summary`

Apply:

```bash
pm2 reload ecosystem.background.config.js --update-env
pm2 save
```

