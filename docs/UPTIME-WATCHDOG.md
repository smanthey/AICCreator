# Uptime Watchdog (Hourly)

**Purpose:** Detect what should be running but isn't, then restart/start/fix it automatically. Addresses "fall off" — things stop and never get restarted.

## Architecture (Agent + Subagents)

| Role | Subagent | Responsibility |
|------|----------|----------------|
| Orchestrator | `uptime-watchdog-hourly.js` | Runs checkers in parallel, sequences recovery, optional LLM diagnosis |
| Checker | `pm2Checker` | Always-on PM2 down? Cron process errored/crash-loop? |
| Checker | `heartbeatChecker` | Mission-control agents with stale heartbeats (memory log > threshold) |
| Checker | `queueChecker` | Dead letters, tasks:health status |
| Executor | `recoveryExecutor` | Restart PM2, force-run agents, reconcile deadletters |
| Diagnosis | `diagnosisAgent` | LLM analysis when recovery fails (suggests next steps) |

## Schedule

- **Cron:** `0 * * * *` (every hour on the hour)
- **PM2 process:** `claw-uptime-watchdog-hourly`

## Actions Taken

1. **Restart PM2** — Always-on processes that are stopped/errored; cron processes in crash-loop
2. **Force-run agents** — Mission-control agents with stale heartbeats (capped at 3 per cycle)
3. **Reconcile deadletters** — Run `tasks:reconcile-deadletters` if dead letters exist

## When Recovery Fails

If any recovery action fails, the diagnosis agent (LLM) analyzes:

- Findings from all checkers
- Recovery errors
- PM2 state

Output: actionable suggestions appended to the report.

## Usage

```bash
# Full run (gather + fix)
npm run uptime:watchdog

# Dry-run (gather + report only, no fixes)
npm run uptime:watchdog:dry

# Skip LLM diagnosis step
node scripts/uptime-watchdog-hourly.js --no-diagnosis
```

## Reports

- `reports/uptime-watchdog-latest.json` — Latest run
- `reports/uptime-watchdog-<timestamp>.json` — Stamped history

## Env

- `UPTIME_WATCHDOG_STALE_MINUTES` — Heartbeat stale threshold (default: 90, min: 30)

## Relation to Other Systems

- **claw-auto-recovery** (5 min) — PM2 restart for critical/important services only; uses execSync
- **claw-auto-heal-3h** — Heartbeat validation, diagnose, autofix, deadletters (no PM2 restart)
- **claw-uptime-watchdog-hourly** — Full orchestration: PM2 + heartbeats + queue + recovery + optional LLM diagnosis; uses async exec
