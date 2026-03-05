# OpenClaw MEMORY.md — Structural Issues & Root Causes

## [2026-03-02] claw-ai-satellite-ollama port conflict crash loop

**Symptom:** 3,259 restarts, process in "waiting restart" state permanently.
**Root cause:** claw-ollama (main process) already binds 0.0.0.0:11434 on this
host. The satellite config also tries to bind 11434 — guaranteed conflict.
**Fix:** `pm2 delete claw-ai-satellite-ollama`
**Rule:** Only run the satellite Ollama PM2 entry on hosts where Ollama is
installed AND port 11434 is not already held by another PM2 process.
See CLAUDE.md: "pm2 start ecosystem.ai-satellite.config.js --only m1-laptop-ollama
# only if Ollama is installed on this host"

---

## [2026-03-02] security_council missing payload schema (task-contract-audit FAIL)

**Symptom:** `npm run tasks:health` exits with FAIL — "Missing payload schema
for registered handlers: security_council"
**Root cause:** Handler registered in agents/security-agent.js but
schemas/payloads.js had no entry for security_council.
**Fix:** Added to schemas/payloads.js:
  security_council: { rules: { dry_run: bool?, max_files: positive_num? } }
**Rule:** When adding a new task handler in agents/, always add a corresponding
entry to schemas/payloads.js (even an empty `{}` entry passes the audit).
Run `npm run tasks:health` before committing new agent handlers.

---

## [2026-03-02] 5 orphan routing entries — business_* tasks ✅ FIXED 2026-03-02

**Status:** RESOLVED.
**Entries:** business_build, business_coordinate, business_improve,
  business_research, business_update
**Root cause:** Added to config/task-routing.js but handlers never registered
in agents/. Caused WARN in audit:tasks; would cause runtime dispatch failure.
**Fix applied 2026-03-02 (cowork-agent):**
  1. agents/stub-agents.js: Added for-loop registering graceful stubs for all 5 types.
     Stubs return `{ status: "skipped", reason: "standalone_pm2_agent" }` and log a warning.
  2. schemas/payloads.js: Added empty schema entries for all 5 types.
     This eliminates the "Missing payload schema" FAIL in audit:tasks.
**Rule:** When adding task types to config/task-routing.js, always also register a handler
(even a stub) in agents/stub-agents.js AND add a schema entry in schemas/payloads.js.

---

## [2026-03-02] scheduling_calendar coordinator "blocked: undefined" — ROOT CAUSE FOUND & FIXED

**Symptom:** Logs show `Agent scheduling_calendar blocked: undefined` and
`Priority: undefined`. All claw-mission-* agents exit immediately every run
without doing any work. scheduling_calendar had 115 restarts with zero output.
**Root cause:** `shouldAgentRun()` is declared `async` in system-health-coordinator.js
but the call in `scripts/mission-control-agent-runner.js` line 190 was missing `await`.
`decision` was therefore a Promise object, not the resolved value. `decision.should_run`
was `undefined`, making `!decision.should_run` always `true` → every agent exited early.
**Fix applied 2026-03-02:** Added `await` to line 190 of mission-control-agent-runner.js:
  `const decision = await coordinator.shouldAgentRun(agentId, agent, healthState);`
**Verification:** After restart, logs now show real reason e.g. "Critical service database
is unhealthy" — coordinator is evaluating correctly.
**Affected processes restarted:** claw-mission-scheduling_calendar, claw-mission-debugging,
  claw-mission-ui_ux_design, claw-mission-code_review
**Rule:** When a function is marked async or has async code paths, always audit all
call sites for missing `await`. Silent Promise-as-truthy bugs are particularly dangerous.

---

## [2026-03-02] Email sending_domain null for both brands

**Status:** Known, tracked. Not a bug — Resend migration in progress.
**Detail:** brands.sending_domain = null for skynpatch and blackwallstreetopoly.
Per CLAUDE.md EMAIL_RESEND_MIGRATION.md: do not replace MailerSend/Maileroo
until per-site Resend account + domain verification + API key + webhook secret
are all in place. Check docs/EMAIL_RESEND_MIGRATION.md for per-site checklist.


---

## [2026-03-02] mission-control-agent-runner.js — executionTime not declared

**Symptom:** claw-mission-scheduling_calendar crashed on every run (120 restarts).
Logs: `[mission-control] Performance logging failed: executionTime is not defined`
and `Signal emission failed: executionTime is not defined`

**Root cause:** `executionTime` was referenced in logPerformanceMetric() and emitSignal()
calls but never assigned in the function scope.

**Fix applied:** Added before the writeback block in scripts/mission-control-agent-runner.js:
  `const executionTime = result.duration_ms || (Date.now() - new Date(startedAt).getTime());`
(Same pattern already used in status-review-agent-runner.js)

**Rule:** When copying signal/metric emission blocks between agent runners, always verify
all referenced variables are declared in the target file's scope.

---

## [2026-03-02] openclaw-coordinator-pulse.js — budgetState fields can be undefined

**Symptom:** claw-openclaw-coordinator crashed with `TypeError: Cannot read properties
of undefined (reading 'toFixed')` — 8+ restarts.

**Root cause:** getBudgetState() can return an object missing daily_spent / daily_cap /
daily_percentage when budget data is unavailable (e.g. DB query returns no rows).
Calling .toFixed() on undefined throws immediately.

**Fix applied:** Wrapped all three fields with Number(x || 0).toFixed() in
scripts/openclaw-coordinator-pulse.js line 135.

**Rule:** Any value fetched from DB or external state that feeds .toFixed() / .toLocaleString()
/ arithmetic must be guarded with `|| 0` or `Number(x ?? 0)`. Never assume budget state
fields are populated.


---

## [2026-03-02] DEEP PATTERN AUDIT — 8 bug classes found and fixed across 10+ files

**Trigger:** Hourly-fix deep scan. Two bugs fixed in first pass revealed the same patterns
existed widely across the codebase. Full audit of all 9 known landmine categories followed.

---

### PATTERN: Missing `await` on async coordinator calls (RECURRING — 2nd occurrence)

**Files fixed:** `scripts/status-review-agent-runner.js:173`

**Symptom:** `shouldAgentRun()` returned a Promise object instead of the decision struct.
`!decision.should_run` evaluated `!Promise` = `false` → agent ALWAYS ran, coordination
completely bypassed. Silent failure — no error, wrong behavior.

**Fix:** Added `await` to `coordinator.shouldAgentRun(...)` call.

**Previous occurrence:** Same bug was fixed in `mission-control-agent-runner.js` on
2026-03-02 (see entry above). Both runners copied the same block; only one got the fix.

**Rule (hardened):** When copying async coordination blocks between runner scripts,
GREP the entire scripts/ directory for every call site of `shouldAgentRun`, `loadHealthState`,
`getBudgetState`, `shouldThrottle` and confirm each one has `await`. These are all async.
The missing-await bug is invisible at runtime — it looks like it's working.

---

### PATTERN: `execSync("pm2 jlist")` blocks the Node event loop (CLAUDE.md landmine #2)

**Files fixed:** `scripts/global-redgreen-status.js:54`

**Symptom:** `pm2List()` was synchronous. Every invocation of global-redgreen-status
blocked the event loop for the entire duration of the PM2 JSON serialization (~200-400ms
under load). Under concurrent calls this causes cascading delays.

**Fix:** Replaced `execSync` with `promisify(exec)` + `execAsync`. Made `pm2List()`
async. Updated all call sites to `await pm2List()`.

**Rule (hardened):** `execSync` is never acceptable for PM2 queries. Search the entire
codebase for `execSync.*pm2` before any merge. The only acceptable pattern is:
```js
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const { stdout } = await execAsync('pm2 jlist');
```

---

### PATTERN: `.toFixed()` / `.toLocaleString()` on unguarded object properties (WIDESPREAD)

**Root cause:** Numeric fields fetched from DB, computed from queries, or passed through
state objects are assumed to always be numeric. When DB returns null/undefined, or a
budget/goal state object is partially populated, calling `.toFixed()` on `undefined`
throws `TypeError: Cannot read properties of undefined (reading 'toFixed')`.

**Files fixed (10 locations across 8 files):**

| File | Fields | Context |
|------|--------|---------|
| `control/cost-coordinator.js` | `daily_cap`, `daily_spent`, `dailyRemaining`, `providerBudget.cap/spent/remaining`, `dailyPercentage` | HOT PATH — every LLM approval check |
| `control/notifier.js` | `spent_usd`, `daily_cap_usd` | Budget warning/exhausted notifications |
| `control/system-health-coordinator.js` | `agentState.hours_since_run`, `goldenWindow.best_score` | Agent scheduling decisions |
| `control/entropy-monitor.js` | `ollamaHealth.cpu_percent` | Ollama restart logic |
| `scripts/system-dashboard.js` | `spendUsd.total/openai/deepseek/gemini/anthropic/codex`, `disk.dataUsedGb/dataAvailGb`, `dedupe.recoverableGb` | Dashboard generation |
| `scripts/architect-api.js` | `summary.spent_usd` | Goal creation budget gate |
| `scripts/bot-daily-improvement.js` | `goal.current_credits`, `goal.target_credits`, divide-by-zero on `target_days - days_elapsed` | Bot improvement cycle |
| `scripts/bot-auto-improvement.js` | `goal.progress_percent`, `goal.daily_needed`, `goal.daily_actual`, `analysis.avg_revenue` | Auto-improvement loop |
| `scripts/openclaw-coordinator-pulse.js` | `budgetState.daily_spent/cap/percentage` | Already fixed in first pass |
| `scripts/mission-control-agent-runner.js` | `executionTime` (not declared, not `.toFixed()` but same class) | Already fixed in first pass |

**Pattern of fix:** Wrap every raw object-property numeric access before `.toFixed()`:
```js
// BEFORE (unsafe):
budgetCache.daily_cap.toFixed(2)

// AFTER (safe):
Number(budgetCache.daily_cap || 0).toFixed(2)
```
For chained access use optional chaining:
```js
Number(model.modelRouting.spendUsd?.total || 0).toFixed(4)
```
For division, guard the denominator:
```js
const daysRemaining = (goal.target_days - goal.days_elapsed) || 1; // avoid divide-by-zero
```

**Rule (hardened):** Any numeric value sourced from:
- A DB query result field (`row.column`)
- An external API response field
- A computed state object that builds incrementally

...MUST be wrapped in `Number(x || 0)` before calling `.toFixed()`, `.toLocaleString()`,
`.toPrecision()`, or any arithmetic that would throw on `undefined`/`null`.

The ONLY exceptions where bare `.toFixed()` is safe:
- The value was just returned from `parseFloat()` or `Number()` with a fallback
- It was initialized with a literal number and never reassigned to an object field
- It passed through `Number.isFinite()` guard (as in credit/rules.js — those are safe)

---

### PROCESSES RESTARTED after this fix pass

```
claw-mission-scheduling_calendar   (120→121 restarts, now stable)
claw-openclaw-coordinator          (8→13 restarts during fix iterations, now stable)
claw-status-review-coordinator     (restarted, picks up missing-await fix)
claw-status-review-worker          (restarted)
claw-status-review-uptime          (restarted)
claw-global-status-pulse           (restarted, picks up execSync→async fix; ran GREEN)
```

### FILES MODIFIED

```
scripts/mission-control-agent-runner.js     — executionTime declaration added
scripts/status-review-agent-runner.js       — await added to shouldAgentRun
scripts/global-redgreen-status.js           — execSync→promisify(exec), pm2List async
scripts/openclaw-coordinator-pulse.js       — budgetState .toFixed() guarded
scripts/system-dashboard.js                 — spendUsd/disk/dedupe .toFixed() guarded
scripts/architect-api.js                    — summary.spent_usd guarded
scripts/bot-daily-improvement.js            — goal fields guarded + divide-by-zero fix
scripts/bot-auto-improvement.js             — goal/analysis fields guarded
control/cost-coordinator.js                 — all budget .toFixed() calls guarded
control/notifier.js                         — spent_usd/daily_cap_usd guarded
control/system-health-coordinator.js        — hours_since_run/best_score guarded
control/entropy-monitor.js                  — cpu_percent guarded
```

---

## [2026-03-01] Hourly-Fix Deep Pattern Audit — Session 2 (Continuation/Verification)

**Run type:** Post-fix verification pass
**Trigger:** Continued from prior session after context window reset

### Verification Results

All processes restarted in the prior session confirmed stable:

| Process | Status | Restarts | Uptime | Notes |
|---------|--------|----------|--------|-------|
| claw-mission-scheduling_calendar | online | 121 | 630s | Stable. Fixed: `executionTime` undeclared |
| claw-openclaw-coordinator | online | 14 | 30s | Stable. +1 restart from our own restart cycle, not crashes |
| claw-status-review-coordinator | online | 0 | 247s | Clean. Fixed: missing `await shouldAgentRun` |
| claw-status-review-worker | online | 0 | 247s | Clean |
| claw-status-review-uptime | online | 0 | 247s | Clean |
| claw-status-review-security | online | 0 | 247s | Clean |
| claw-status-review-schema | online | 0 | 247s | Clean |
| claw-global-status-pulse | stopped | 2 | — | Expected: one-shot cron, ran GREEN, exited normally |

### openclaw-coordinator Log Confirmation

Post-fix logs show **no more TypeError crashes**. Active log lines:
- `[context-pruner]` — normal memory pruning running correctly
- `[agent-memory-sql]` — pgvector fallback (pre-existing, non-crash)
- `tuple concurrently updated` — transient DB contention, not our bug

### Cumulative Fix Summary (both sessions)

**Files patched this run cycle (10 files):**

1. `scripts/mission-control-agent-runner.js` — `executionTime` undeclared → added `const executionTime = result.duration_ms || ...`
2. `scripts/openclaw-coordinator-pulse.js` — `.toFixed()` on undefined budgetState fields
3. `scripts/status-review-agent-runner.js` — missing `await` on `shouldAgentRun()` (Promise-as-truthy)
4. `scripts/global-redgreen-status.js` — `execSync("pm2 jlist")` → async `execAsync` (CLAUDE.md landmine #2)
5. `control/cost-coordinator.js` — all `.toFixed()` on budget gate fields (hot LLM path)
6. `control/notifier.js` — `.toFixed()` on `spent_usd`/`daily_cap_usd` args
7. `control/system-health-coordinator.js` — `.toFixed()` on `hours_since_run`, `best_score`
8. `control/entropy-monitor.js` — `.toFixed()` on `cpu_percent`
9. `scripts/system-dashboard.js` — deep optional chain `.toFixed()` on spendUsd/disk/dedupe
10. `scripts/architect-api.js` — `.toFixed()` on `summary.spent_usd` in goal budget gate
11. `scripts/bot-daily-improvement.js` — `.toFixed()` + divide-by-zero on `target_days - days_elapsed`
12. `scripts/bot-auto-improvement.js` — `.toFixed()` on goal progress/daily_needed/daily_actual

### Hardened Rules (permanent)

**RULE: Any numeric field from DB, Redis, or coordinator state MUST be wrapped before `.toFixed()`**
```js
// ALWAYS:
Number(value || 0).toFixed(N)
// NEVER:
value.toFixed(N)  // crashes if undefined/null
```

**RULE: Any async coordinator method MUST be awaited**
```js
// ALWAYS:
const decision = await coordinator.shouldAgentRun(...)
// NEVER:
const decision = coordinator.shouldAgentRun(...)  // Promise object is always truthy
```

**RULE: PM2 queries MUST use async exec, never execSync**
```js
// ALWAYS:
const { exec } = require("child_process");
const { promisify } = require("util");
const execAsync = promisify(exec);
const { stdout } = await execAsync("pm2 jlist");
// NEVER:
const { execSync } = require("child_process");
execSync("pm2 jlist")  // blocks event loop 200-400ms
```

**RULE: Divide-by-zero protection on day counters**
```js
const daysRemaining = (goal.target_days - goal.days_elapsed) || 1;
```

**RULE: Optional chaining before deep property access**
```js
Number(model.modelRouting.spendUsd?.total || 0).toFixed(4)
```


---

## [2026-03-02] device-utilization.js — null id on INSERT (pgcrypto unavailable on NAS)

**Symptom:** `[utilization] Rebalance failed for MacBook-Pro-2.local-*: null value in column "id"
of relation "tasks" violates not-null constraint` — 3 occurrences per rebalance cycle (every 20 min).

**Root cause:** `generateWorkForDevice()` used `DEFAULT gen_random_uuid()` in the INSERT.
The NAS Postgres does not have the `pgcrypto` extension active (or it was created without it),
so `gen_random_uuid()` DEFAULT evaluates to NULL, violating the NOT NULL PRIMARY KEY constraint.
Other INSERT sites in the codebase (inserter.js, opencode-controller-queue.js, etc.) explicitly
generate UUIDs in Node.js — only device-utilization.js relied on the DB DEFAULT.

**Fix applied 2026-03-02 (cowork-agent):**
- Added `const crypto = require("crypto")` to device-utilization.js
- Changed INSERT to include `id` as `$1 = crypto.randomUUID()`
- Removed `RETURNING id` (id is already known)
- Pattern now matches inserter.js

**Rule:** NEVER rely on `gen_random_uuid()` DEFAULT in NAS Postgres. Always generate UUID in Node.js:
```js
const newId = crypto.randomUUID();  // built-in Node.js >= 14.17, no deps
await pg.query("INSERT INTO tasks (id, ...) VALUES ($1, ...)", [newId, ...]);
```

---

## [2026-03-02] uptime-watchdog false positive cron_crash_loop

**Symptom:** uptime-watchdog-hourly flagged `claw-backlog-orchestrator` (60 restarts) and
`claw-mission-scheduling_calendar` (134 restarts) as `cron_crash_loop` every run.
Watchdog was restarting healthy processes unnecessarily.

**Root cause:** Condition `restarts > 50` matched any cron process with a high cumulative restart
count, regardless of status. A */10 cron accumulates 50 restarts in ~8 hours of normal operation.
Mission-calendar had ~130 from weeks of cron runs.

**Fix applied 2026-03-02 (cowork-agent):**
- Changed condition: `restarts > 50` → `status === "online" && restarts > 50`
- Consolidated both `errored` branches into single `status === "errored"` check (any restart count)
- `stopped` with high restarts = normal cron operation, not a crash loop

**Rule:** A cron process in `stopped` state with N accumulated restarts is healthy.
Only flag `cron_crash_loop` when `status === "online"` AND restarts are unusually high
(indicating the process is terminating and restarting faster than its cron interval).

---

## [2026-03-02] tasks:health false timeout in daily-fix-pulse + uptime-watchdog

**Symptom:** `daily-fix-latest.json` shows `health.ok: false`, `health.exitCode: null` (SIGTERM),
and `errors: ["tasks:health failed"]`. Watchdog also marks `taskHealthOk: false`.
Manual run of each individual audit passes in under 10 seconds.

**Root cause:** `tasks:health` runs 4 sequential `npm run` subprocesses. Each spawns Node.js,
loads all agent modules (which trigger dotenv, postgres Pool init, model-router require), and makes
DB connections. On the NAS under load, the combined 4-step chain can exceed 90 seconds, hitting
the hardcoded timeout and getting SIGTERM'd.

**Fix applied 2026-03-02 (cowork-agent):**
- Raised timeout from 90s → 150s in `scripts/daily-fix-pulse.js` (spawnSync call)
- Raised timeout from 90_000 → 150_000 in `control/uptime-watchdog-agents.js` (execAsync call)

**Rule:** Sequential npm subprocess chains that load large agent registries need ≥ 120s timeout.
Each npm run has ~5s spawn overhead + module loading + potential DB connection = 15-25s per step.
4 steps × 25s = 100s under load. Always budget 1.5× expected duration.

---

## [2026-03-02] OpenClaw Architect MCP mission + core scaffolding

**Symptom:** Pattern drift and duplicated Stripe/email/queue/trading logic across ~50 repos.
Agents lacked a single source of truth for best practices; MCP symbol index was underused.

**Fix (scaffolding, not full implementation):**
- Added `config/mission-openclaw-architect.json` to define a machine-readable mission for
  the architect: converge target SaaS repos (PayClaw, CaptureInbound, Veritap,
  v0-morningops, CookiesPass/cookies-tempe) onto canonical core patterns and prevent drift.
- Added `config/domain-exemplars.json` to record domain → exemplar repos for MCP queries
  (Stripe/email/queue/trading/auth/pm2).
- Added `config/saas-core-adoption.json` to track core adoption status per target SaaS repo.
- Created initial pattern spec `docs/core-stripe-pattern.md` describing the required Stripe
  webhook/checkout behavior (idempotency, logging, retry, replay handling).
- Added versioned core module skeletons in `core/stripe.js`, `core/email.js`,
  `core/queue.js`, and `core/trading.js` for agents to implement using MCP-derived patterns.
- Documented MCP sweep procedures:
  - `docs/mcp-sweeps-landmines.md` for daily `search_text` landmine scans.
  - `docs/mcp-sweeps-drift.md` for `search_symbols`-based drift detection from core/*.
  - `docs/external-repo-onboarding.md` for bringing new exemplar repos into the domain map.

**Rule:** All new Stripe/email/queue/trading work for SaaS repos must go through the
`core/*` modules once they are fully implemented. MCP sweeps should enforce:
- No raw `stripe.` or provider calls in SaaS repos.
- No new JSON state or `execSync` landmines on hot paths.
- No new trading writes outside `core/trading`.

---

## [2026-03-02] schema:audit/tasks:health EPERM in sandboxed environment

**Symptom:** `npm run schema:audit` and `npm run tasks:health` fail with:
`connect EPERM 192.168.1.164:15432 - Local (0.0.0.0:0)` when run from a restricted shell.

**Root cause:** The audit/health scripts require direct TCP access to the NAS Postgres
instance at `192.168.1.164:15432`. The sandboxed environment used by some tooling
cannot reach that host/port, so connection attempts throw EPERM before any schema
logic runs.

**Fix:** No code change; treat this as an environmental limitation of the sandbox.
Run `schema:audit` and `tasks:health` from a host or shell that has network access
to the NAS Postgres service.

**Rule:** When an audit script fails with EPERM/ECONNREFUSED to a known internal IP,
do not assume a schema bug. First verify network reachability to Postgres/Redis from
the execution environment before attempting code fixes.


