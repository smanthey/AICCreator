# Weekly Trends Brief (AI + SaaS)

This runbook generates a weekly trends brief and writes it to:

- `~/notes/briefs/weekly/[YYYY-WW].md`

## Command

Manual run (fast, no refresh):

```bash
npm run brief:weekly
```

Manual run with fresh source refresh:

```bash
npm run brief:weekly -- --refresh
```

## What it includes

- SaaS opportunity trends (from latest `saas-opportunity-research` report)
- Pain-point opportunities (from latest `saas-pain-opportunity-report` report)
- Affiliate rollout opportunities (from latest `affiliate-rollout-research` report)
- External update signal summary (from `external_update_signals`, last 7 days) when DB is available
- Full source log used in the brief

## PM2 schedule

`ecosystem.background.config.js` includes:

- app: `claw-weekly-trends-brief`
- cron: Monday 5:35 PM local time
- args: `--refresh`

Apply schedule:

```bash
pm2 reload ecosystem.background.config.js --update-env
pm2 save
```

## Quick validation

```bash
npm run brief:weekly
ls -la ~/notes/briefs/weekly
```

