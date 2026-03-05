# Daily Fix Agent Runbook

How to run health → blockers → errors → gap analysis and fix issues.

**See also:** [DAILY-FIX-PREVENTION.md](./DAILY-FIX-PREVENTION.md) — root-cause fixes so these steps are needed less often. Use this to direct an agent (or human) to fix daily, or let the 3x-daily pulse do it automatically.

## 1. Sequence (run in order)

| Step | Command | Purpose |
|------|---------|---------|
| 1. Health | `npm run tasks:health` | Topology, runtime audit, task contract, agent drift |
| 2. Blockers / Gaps | `npm run audit:gaps` | Gap score, hard blockers (e.g. security_pulse_recent), soft gaps |
| 3. Errors | `npm run audit:runtime` | Dead letters, stale task runs, stale workers |
| 4. Dead letters list | `node cli/dead-letters.js` | See which tasks are DEAD_LETTER and why |
| 5. Fix: security pulse | `npm run security:sweep` then `node scripts/record-orchestrator-step.js security_sweep COMPLETED` | Makes gap analysis `security_pulse_recent` pass (within 4h) |
| 6. Fix: dead letters | `npm run tasks:reconcile-deadletters -- --requeue` | Requeue recoverable dead letters (e.g. missing handler after deploy) |
| 6b. Manual requeue one task | `npm run tasks:reconcile-deadletters -- --requeue-id <task-uuid>` | Force requeue a single dead-letter task (e.g. reaper-quarantined copy_lab_run). List IDs with `node cli/dead-letters.js`. |

## 2. One-command pulse (recommended)

```bash
npm run daily:fix
# or with LLM analysis (Gemini/DeepSeek) for fix suggestions:
npm run daily:fix -- --analyze
```

This runs: health → gaps → dead letters → (if needed) security:sweep + record → reconcile-deadletters, and writes `reports/daily-fix-latest.json`. With `--analyze` it also calls the model router (triage → Gemini/DeepSeek) and stores fix suggestions in the report.

## 3. How to direct an agent to fix daily

Give the agent this prompt (or equivalent):

- "Run the daily fix sequence: `npm run daily:fix -- --analyze`. Then read `reports/daily-fix-latest.json`. If there are `errors` or gap `FAIL`s or dead letters, apply the fixes: (1) If `security_sweep_recorded` is false, run `npm run security:sweep` and `node scripts/record-orchestrator-step.js security_sweep COMPLETED`. (2) If there are dead letters, run `npm run tasks:reconcile-deadletters -- --requeue`. (3) If the report contains `llm_suggestions`, consider running the suggested npm/script commands. (4) If a task type is missing a handler (e.g. copy_lab_run), ensure the agent that registers that handler is loaded in workers (see workers/worker.js) and restart workers if needed."

Short form for agents:

- "Run `npm run daily:fix -- --analyze`. Read `reports/daily-fix-latest.json`. Fix any reported errors and blockers using the steps in docs/DAILY-FIX-AGENT-RUNBOOK.md."

## 4. Scheduled 3x daily (Gemini / DeepSeek fixing)

The app `claw-daily-fix-pulse` runs 3x per day (06:00, 14:00, 22:00 UTC) when started with the background ecosystem:

```bash
pm2 start ecosystem.background.config.js
# or ensure claw-daily-fix-pulse is in your PM2 config
```

It runs `npm run daily:fix -- --analyze`, which:

- Runs health, gaps, dead-letter list
- Runs security:sweep and records it if older than 4h
- Requeues recoverable dead letters
- Calls the model router (triage → Gemini/DeepSeek) with the report and saves fix suggestions to the report

To run the same manually 3x daily: add a cron entry or run when convenient:

```bash
0 6,14,22 * * * cd /path/to/claw-architect && npm run daily:fix -- --analyze
```

## 5. Common blockers and fixes

| Blocker | Fix |
|--------|-----|
| `security_pulse_recent=false` | `npm run security:sweep` then `node scripts/record-orchestrator-step.js security_sweep COMPLETED` |
| Dead letter: "No handler registered for type X" | Ensure the agent that registers X is required in workers/worker.js; restart workers; then `npm run tasks:reconcile-deadletters -- --requeue` |
| Dead letter: "stale dispatched requeue loop cleanup" (e.g. copy_lab_run) | Reaper-quarantined; not auto-requeued. When convenient: `npm run tasks:reconcile-deadletters -- --requeue-id <task-uuid>`. List IDs: `node cli/dead-letters.js`. |
| Gap: Credit outcome_learning_loop (WARN) | Soft gap; feed credit_action_outcomes / credit_learning_events when available |
| Task contract: routing orphans (business_*) | Optional; add handlers when those task types are needed |

## 5b. Known behaviors (do not misdiagnose)

- **BUDGET_BLOCKED** in daily-fix `--analyze` — Daily LLM spend cap exhausted (often late evening). Auto-resolves at midnight. Only affects the analyze step; core pipelines unaffected.
- **Deep audit FAIL: schema_audit / security_sweep** — schema_audit here is separate from db-level schema check (which can be GREEN). Security sweep failures expected while criticals are in Greptile sprint.
- **Repo_autofix tasks quarantined** — Reaper is correct. Tasks lost in DISPATCHED after 5 cycles get quarantined. May indicate worker timeout on complex jobs; investigate if persistent.

## 6. Files

- `scripts/daily-fix-pulse.js` — Main pulse script (checks + safe fixes + optional LLM).
- `scripts/record-orchestrator-step.js` — Records a step run for gap analysis.
- `reports/daily-fix-latest.json` — Latest run report (errors, gaps summary, llm_suggestions).
