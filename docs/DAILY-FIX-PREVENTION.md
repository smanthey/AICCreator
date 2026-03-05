# Preventive Measures — So Hourly/Daily Fixes Aren't Needed

**Purpose:** Address root causes of recurring issues so auto-heal, daily-fix, and SRE triage are needed less often.

---

## 1. PM2 Restart Loops (Highest Impact)

### Problem

- **claw-mission-scheduling_calendar**: 115 restarts — crash loop
- **claw-backlog-orchestrator**: 37 restarts — frequent crashes
- **claw-mission-ui_ux_design** (8), **claw-mission-debugging** (7), **claw-mission-code_review** (6): mission agents restarting

### Root Cause

Mission-control-agent-runner spawns `backlog:orchestrator --dry-run` and other commands. Failures (pg lock contention, timeout, spawn errors) cause exit code non-zero → PM2 restarts. Cron jobs with `autorestart: false` still restart on each cron tick, but if the script crashes before completing, PM2 counts it.

### Prevention

1. **Cap restarts for cron jobs:** Add `max_restarts: 3` and `restart_delay: 60000` to mission-control cron apps so a broken agent doesn't spin forever.
2. **Fix backlog-orchestrator:** Add robust error handling:
   - Wrap main() in try/finally to always release pg connection
   - If advisory lock fails, exit 0 (skip gracefully) not crash
   - Add `--timeout` to spawnSync for sub-steps to avoid hang
3. **Investigate scheduling_calendar:** 115 restarts = ~7–8/hour. Run manually to capture stderr: `npm run -s backlog:orchestrator -- --dry-run 2>&1 | tee /tmp/backlog.log`
4. **Stop crash-loop processes** (from CLAUDE.md): `pm2 delete claw-experiment-engine 2>/dev/null; pm2 delete m1-laptop-ollama 2>/dev/null` — remove known one-shot/optional processes from PM2.

---

## 2. copy_lab_run Dead Letter (Stale Dispatched Loop)

### Problem

Tasks like `copy_lab_run` get lost in DISPATCHED, reaper returns them to CREATED, they get dispatched again, no worker picks them up. After 5 cycles in 60 min → quarantined and dead-lettered.

### Root Cause

- `copy_lab_run` routes to `claw_tasks_ai` with `required_tags: ["ai"]`
- If no worker with `ai` tag is active, or workers are saturated, the job sits in Redis unprocessed
- Dispatcher moves task to DISPATCHED and adds to BullMQ; worker never completes it within 120s
- Reaper sees DISPATCHED > 120s, moves back to CREATED → cycle repeats

### Prevention

1. **Ensure AI workers are running:** Verify `claw-worker-ai` or equivalent has `WORKER_TAGS` including `ai` and is on a machine that can process copy_lab_run (model access).
2. **Increase DISPATCHED_REAP_SECONDS for AI tasks:** Long-running LLM tasks may need 300s+ before reaper considers them "lost". Use per-type override or env `DISPATCHED_REAP_SECONDS=300` during peak.
3. **Quarantine earlier with user visibility:** After 3 reaped cycles (not 5), move to a "needs_attention" state and notify, rather than silent requeue. Reduces wasted cycles.
4. **Worker timeout vs reaper:** Ensure `copy_lab_run` handler has appropriate `timeout_seconds` so worker doesn't abandon mid-run. Check `agents/content-agent.js` or handler config.

---

## 3. BUDGET_BLOCKED for Daily-Fix --analyze

### Problem

When daily LLM spend caps are exhausted, `npm run daily:fix -- --analyze` fails with `BUDGET_BLOCKED: no eligible provider for triage`. Core pipelines unaffected; only the LLM suggestion step fails.

### Prevention

1. **Graceful degradation:** In `daily-fix-pulse.js`, catch `BUDGET_BLOCKED` and set `llm_suggestions: "Budget exhausted; will retry after reset. Core fixes still applied."` — don't treat as error, don't exit 1.
2. **Ollama fallback:** When all paid providers are capped, try Ollama for triage (cost $0). Add to model-router fallback chain for `triage` when budget blocked.
3. **Document in report:** Write to report that analyze was skipped due to budget; next run will retry.

---

## 4. tasks:health Timeout / Failure

### Problem

`daily-fix-latest.json` shows `tasks:health` failed (exitCode null — may be timeout). tasks:health runs verify:topology, audit:runtime, audit:tasks, audit:drift sequentially.

### Prevention

1. **Parallelize or shorten:** Run audits in parallel where independent; add `--quick` mode that skips drift for faster feedback.
2. **Increase spawn timeout:** daily-fix-pulse uses 90s for tasks:health; audit:drift can be slow. Raise to 120s or split into faster pre-check + full audit.
3. **Fail open for downstream:** If tasks:health times out, still run dead-letter reconcile and security sweep — don't block all fixes on health passing.

---

## 5. QA Finding Spam (FEEDBACK-LOG)

### Problem

Same message repeated hundreds of times: "Detected N high-priority QA findings across M/6 repos. Prioritize scenario coverage gaps first."

### Prevention

1. **Deduplicate by content hash:** Before appending to FEEDBACK-LOG, hash the message; if same hash in last 24h, skip or append "(repeated)".
2. **Throttle qa-human-grade runs:** Code review agent runs every 2h; if it always finds the same 2–6 findings, consider running less often until fixes land.
3. **Actionable feedback only:** Only log when finding count or repo set changes; same count+same repos = no new log line.

---

## 6. Known Landmines (Already Documented)

CLAUDE.md lists these; ensure no reintroduction:

- No read-modify-write on JSON from concurrent agents → use PostgreSQL
- No execSync for PM2 → use async exec
- No `const` inside try if needed outside → use `let` before try
- No token burn before validation → cross-check in WHERE
- No unclosed fd after spawn → close in parent
- No hardcoded action IDs → use DASHBOARD_ACTIONS
- No duplicate constants → module-level only

---

## 7. SRE Hourly / Daily Output

The SRE scripts (`sre-hourly-triage`, `sre-daily-maintenance`) write to `reports/sre-*-latest.json` and `~/logs/infra-changes.md`. If they've only run in dry-run, no fixes have been logged yet.

**To capture real fixes:** Run once without dry-run:

```bash
npm run sre:hourly    # Requires LLM; uses triage model
```

Then read `reports/sre-hourly-triage-latest.json` and `~/logs/infra-changes.md` for "What I found" and "Next recommended actions". Implement those as preventive code/config changes.

---

## Priority Order

| Priority | Issue | Action |
|----------|-------|--------|
| P0 | scheduling_calendar / backlog-orchestrator crash loops | Fix or disable; add max_restarts |
| P0 | copy_lab_run DISPATCHED loop | Verify AI workers; tune reaper or quarantine threshold |
| P1 | BUDGET_BLOCKED graceful handling | Catch in daily-fix; skip analyze without failing |
| P1 | tasks:health timeout | Parallelize or lengthen timeout; fail open |
| P2 | QA feedback spam | Deduplicate; throttle |
| P2 | SRE infra-changes log | Run sre:hourly once to populate; then implement recommendations |
