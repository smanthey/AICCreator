# Mission Control Dashboard — Senior Dev Audit Report
**Date:** 2026-02-28
**Files:** `dashboard/index.html` (998 lines), `scripts/architect-api.js` (2016 lines)
**Auditor:** OCD senior dev, caffeinated

---

## EXECUTIVE SUMMARY

The Mission Control dashboard is architecturally solid — tabbed SPA, hash routing, live polling,
runbook actions. But three unconditional crash-level bugs make core endpoints always-failing in
production, and a cluster of HIGH/MEDIUM issues compound into data loss risk, stale UI, and
misleading UX. All 11 issues and 8 capability gaps documented below with exact line references and
ready-to-apply patches.

**Severity breakdown:**
- 🔴 CRITICAL (crashes / security): 3
- 🟠 HIGH (data loss / fd leak / logic error): 5
- 🟡 MEDIUM (wrong data / wrong tab / UX confusion): 6
- 🔵 LOW (polish / DX): 4
- ⬜ GAPS (missing capability): 8

---

## 🔴 CRITICAL BUGS

### C1 — `taskPlan` block-scope ReferenceError in `handlePostGoal`
**File:** `scripts/architect-api.js` ~line 425
**Severity:** CRITICAL — `/api/goal` POST always crashes after planning

**Root cause:**
`const taskPlan` is declared *inside* the first `try` block, but then referenced at lines 433, 438,
439, and 444–488 which are all *outside* that `try`. JavaScript `const`/`let` are block-scoped, so
every reference outside the block is an unconditional `ReferenceError`.

**Buggy code:**
```javascript
try {
  const taskPlan = await planner.plan(goal);   // block-scoped!
  await checkBudget(taskPlan.estimated_cost_usd || 0);
} catch (budgetErr) {
  return jsonResponse(res, 429, { error: budgetErr.message });
}

try {
  await verifyPlan(taskPlan);                   // ReferenceError ← always throws
} catch (verifyErr) { ... }

const { planId } = await insertPlan(taskPlan); // ReferenceError
```

**Fix:**
```javascript
let taskPlan;
try {
  taskPlan = await planner.plan(goal);          // assign, not declare
  await checkBudget(taskPlan.estimated_cost_usd || 0);
} catch (budgetErr) {
  return jsonResponse(res, 429, { error: budgetErr.message });
}

try {
  await verifyPlan(taskPlan);                   // now in scope ✓
} catch (verifyErr) { ... }

const { planId } = await insertPlan(taskPlan); // in scope ✓
```

---

### C2 — Plan approve token consumed before `plan_id` cross-check
**File:** `scripts/architect-api.js` ~line 520 (`handlePostPlanApprove`)
**Severity:** CRITICAL — approval token is burned before validating it belongs to the right plan

**Root cause:**
The UPDATE runs first (setting `approved = true`, consuming the one-time token), then *after* the
query the code checks `if (rows[0].plan_id !== planId)`. If someone has a valid token for plan A and
calls approve with plan B's ID, the check will fail — but the token for plan A was already consumed.

**Buggy flow:**
```javascript
// 1. Burns the token unconditionally
const { rows } = await query(
  `UPDATE plan_approvals SET approved = true
   WHERE approval_token = $1 AND approved = false AND expires_at > NOW()
   RETURNING *`,
  [token]
);

// 2. Checks plan_id — too late, token already consumed!
if (rows[0].plan_id !== planId) {
  return jsonResponse(res, 403, { error: "Token does not match plan" });
}
```

**Fix:** Add `plan_id = $2` to the WHERE clause so the UPDATE only fires for the correct plan:
```javascript
const { rows } = await query(
  `UPDATE plan_approvals SET approved = true
   WHERE approval_token = $1
     AND plan_id = $2
     AND approved = false
     AND expires_at > NOW()
   RETURNING *`,
  [token, planId]
);
if (rows.length === 0) {
  return jsonResponse(res, 403, { error: "Invalid, expired, or already-used token" });
}
// No plan_id check needed — the WHERE clause already enforces it
```

---

### C3 — `research-copy/regenerate` queues wrong action IDs
**File:** `scripts/architect-api.js` ~line 1784
**Severity:** CRITICAL — clicking Regenerate on the Research/Copy tab triggers unrelated workflow

**Root cause:**
The `research-copy/regenerate` handler hardcodes `["workflow_continue", "repo_scan_continue"]` which
are CI/workflow actions, not research regeneration actions.

**Buggy code:**
```javascript
case "research-copy/regenerate": {
  const actionIds = ["workflow_continue", "repo_scan_continue"]; // Wrong!
  // ... queues CI actions instead of research
}
```

**Fix:**
```javascript
case "research-copy/regenerate": {
  const actionIds = ["saas_pain_report", "saas_opportunity", "affiliate_research"];
  // ... queue research regeneration
}
```
Also add these three to the `DASHBOARD_ACTIONS` array (currently absent — see Gap G1).

---

## 🟠 HIGH ISSUES

### H1 — File descriptor leak: `openSync` fds never closed after `spawn`
**File:** `scripts/architect-api.js` ~line 344 (`handlePostAction`)
**Severity:** HIGH — leaks 2 fds per action invocation; under load will exhaust OS fd limit

**Buggy code:**
```javascript
const outFd = fs.openSync(stdoutPath, "a");
const errFd = fs.openSync(stderrPath, "a");
const proc = spawn("bash", ["-lc", def.command], {
  stdio: ["ignore", outFd, errFd],
  detached: true,
});
proc.unref();
// outFd and errFd are NEVER closed in the parent process
```

**Fix:** Close fds in the parent after `spawn`:
```javascript
const outFd = fs.openSync(stdoutPath, "a");
const errFd = fs.openSync(stderrPath, "a");
const proc = spawn("bash", ["-lc", def.command], {
  stdio: ["ignore", outFd, errFd],
  detached: true,
});
proc.unref();
fs.closeSync(outFd);   // ← add these two lines
fs.closeSync(errFd);
```

---

### H2 — `execSync` blocks the event loop on every dashboard request
**File:** `scripts/architect-api.js`, `buildProgressData()` function
**Severity:** HIGH — synchronous `execSync("pm2 jlist")` freezes the entire Node process while PM2
responds; all concurrent requests queue behind it

**Fix:** Switch to `execFile` with a callback or promisified `exec`:
```javascript
const { promisify } = require("node:util");
const execAsync = promisify(require("node:child_process").exec);

async function getPm2List() {
  try {
    const { stdout } = await execAsync("pm2 jlist", { timeout: 5000 });
    return JSON.parse(stdout);
  } catch {
    return [];
  }
}
```

---

### H3 — History file TOCTOU race: read-modify-write without mutex
**File:** `scripts/architect-api.js`, action completion handler
**Severity:** HIGH — two simultaneous action completions can produce a corrupted/incomplete history
file (second writer overwrites first writer's append)

**Fix options (pick one):**
1. Use `fs.appendFileSync` with newline-delimited JSON (NDJSON) instead of a parsed array
2. Wrap the read-modify-write in an `async-mutex` lock
3. Write to PostgreSQL `event_log` table instead (already exists in schema)

---

### H4 — `freshnessSla` object defined twice (duplication)
**File:** `scripts/architect-api.js` lines ~1089–1097 AND ~1355–1363
**Severity:** HIGH — when SLA values need updating, only one copy gets changed; leads to silently
inconsistent stale-data thresholds

**Fix:** Extract to a module-level constant:
```javascript
// Near top of file, after requires
const FRESHNESS_SLA = {
  last_lead_at: 48,
  last_credit_at: 24,
  last_qa_run_at: 72,
  last_deploy_at: 168,
  // ... complete list
};
```
Then replace both inline object literals with `FRESHNESS_SLA`.

---

### H5 — `queue.failed` count never surfaces as an audit finding
**File:** `scripts/architect-api.js`, `buildAuditFindings()`
**Severity:** HIGH — failed BullMQ jobs are invisible to the operator dashboard; failures silently
accumulate

**Fix:** Add to `buildAuditFindings()`:
```javascript
if (queueStats.failed > 0) {
  findings.push({
    id: "queue_failed_jobs",
    severity: queueStats.failed > 10 ? "critical" : "warn",
    lane: "infra",
    title: `${queueStats.failed} failed job(s) in queue`,
    detail: `BullMQ has ${queueStats.failed} failed jobs that need attention.`,
    impact: "Tasks not retrying; data may be lost",
    recommendation: "Inspect failed jobs: `npm run queue:failed`",
    action_id: "queue_retry_failed",
  });
}
```

---

## 🟡 MEDIUM ISSUES

### M1 — `renderResearch()` hardcodes fake metric snippets
**File:** `dashboard/index.html` ~lines 862–867
**Severity:** MEDIUM — the Research/Copy tab always displays fabricated numbers regardless of actual data

**Buggy code:**
```javascript
const snippets = [
  "Hero: 42 sends today | 0 blocking E2E | 46 repos passing",
  "Pain: 7 new signals | last scan 2h ago",
  // more fake strings...
];
```

**Fix:** Pull from `data.data` (already fetched by the tab loader):
```javascript
const snippets = [
  `Sends today: ${data.data?.sends_today ?? "—"}`,
  `Pain signals: ${data.data?.pain_signals ?? "—"} | Last scan: ${data.data?.last_scan_ago ?? "—"}`,
  // real fields from API response
];
```

---

### M2 — Tab-load errors routed to Chat tab instead of active tab
**File:** `dashboard/index.html`, `loadActiveTab()` error handler
**Severity:** MEDIUM — when any tab fails to load, the error appears in the Chat tab's message area
(`chatArea`) which the user may not be looking at

**Buggy code:**
```javascript
} catch (err) {
  addMessage("architect", `Error loading tab: ${err.message}`);  // always Chat tab
}
```

**Fix:** Target the active tab's content panel:
```javascript
} catch (err) {
  const panel = document.getElementById(`tab-${currentTab}`);
  if (panel) {
    panel.innerHTML = `<div class="error-banner">⚠ ${escapeHtml(err.message)}</div>`;
  }
}
```

---

### M3 — `renderStatusStrip` reads stale/absent jobs-queue cache
**File:** `dashboard/index.html`, `renderStatusStrip()`
**Severity:** MEDIUM — status strip always shows 0 for queue depth/active if the Jobs tab has never
been loaded in this session

**Root cause:** `state.cache.jobs_queue?.data?.queue` is undefined until the user clicks the Jobs
tab. The strip should either fetch the data directly or the API should include queue summary in the
overview endpoint.

**Fix:** Include `queue_summary` (active count + waiting count) in the `/api/dashboard/overview`
response so the status strip never reads from stale tab cache.

---

### M4 — Agents tab shows all findings, not agent-specific ones
**File:** `scripts/architect-api.js`, `handleDashboardTab("agents")` path
**Severity:** MEDIUM — `topFindings` passed to agents tab renderer is unfiltered global findings list

**Fix:** Filter by lane before passing:
```javascript
const agentFindings = topFindings.filter(f =>
  ["ai", "qa", "research"].includes(f.lane)
);
```

---

### M5 — Duplicate findings from overlapping detection loops
**File:** `scripts/architect-api.js`, `buildAuditFindings()`
**Severity:** MEDIUM — same issue can appear twice: once from the `needs_attention` text-match loop
and once from the brand/provisioning loop

**Fix:** Deduplicate by `finding.id` after both loops:
```javascript
const seen = new Set();
findings = findings.filter(f => {
  if (seen.has(f.id)) return false;
  seen.add(f.id);
  return true;
});
```

---

### M6 — `route.is()` method defined but never called (dead code)
**File:** `scripts/architect-api.js`
**Severity:** MEDIUM — dead code misleads future maintainers into thinking it's part of routing logic

**Fix:** Either wire it into the route matching logic or delete it. If removing:
```bash
# Verify nothing calls it
grep -n "route\.is(" scripts/architect-api.js
# If zero results beyond the definition, delete the method
```

---

## 🔵 LOW / POLISH

### L1 — API key not persisted to `localStorage`
**File:** `dashboard/index.html`
**Severity:** LOW — operator must re-enter the API key on every page refresh

**Fix:**
```javascript
// On load
const savedKey = localStorage.getItem("architect_api_key");
if (savedKey) apiKeyInput.value = savedKey;

// On save/apply
localStorage.setItem("architect_api_key", apiKeyInput.value.trim());
```

---

### L2 — Auto-refresh `setInterval` never cleared on tab switch
**File:** `dashboard/index.html`
**Severity:** LOW — switching tabs doesn't reset the 30s timer, so you always get the OLD tab's
refresh 0–30s into viewing the new one

**Fix:**
```javascript
let refreshTimer = null;

function setAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => loadActiveTab(true), 30000);
}
// Call setAutoRefresh() whenever tab changes
```

---

### L3 — `REPORTS_DIR` points to `scripts/reports/` not project root `reports/`
**File:** `scripts/architect-api.js`
**Severity:** LOW — `latestReportFile()` looks in `scripts/reports/` but reports are likely written
to `./reports/` at project root

**Fix:**
```javascript
const REPORTS_DIR = path.join(__dirname, "..", "reports"); // project root
```
Or make it an env var: `REPORTS_DIR=/Users/tatsheen/claw-architect/reports`

---

### L4 — `buildProgressData()` runs all 8 DB queries + PM2 on every request (no caching)
**File:** `scripts/architect-api.js`
**Severity:** LOW (performance) — with 30s auto-refresh, up to 2 req/min per user × 8 queries =
uncached DB hammering; becomes HIGH with multiple browser windows open

**Fix:** Cache the result for 15s:
```javascript
let _progressCache = null;
let _progressCacheAt = 0;
const PROGRESS_CACHE_TTL = 15_000;

async function buildProgressData() {
  const now = Date.now();
  if (_progressCache && now - _progressCacheAt < PROGRESS_CACHE_TTL) {
    return _progressCache;
  }
  const data = await _buildProgressDataUncached();
  _progressCache = data;
  _progressCacheAt = now;
  return data;
}
```

---

## ⬜ CAPABILITY GAPS

### G1 — `saas_pain_report`, `saas_opportunity`, `affiliate_research` missing from `DASHBOARD_ACTIONS`
Three research action commands exist in the codebase but are not wired to the `DASHBOARD_ACTIONS`
array. The Research/Copy tab's Regenerate button has no valid targets to queue.

**Fix:** Add to `DASHBOARD_ACTIONS`:
```javascript
{
  id: "saas_pain_report",
  label: "SaaS Pain Report",
  command: "npm run saas:pain",
  lane: "research",
  tags: ["research", "ai"],
},
{
  id: "saas_opportunity",
  label: "Opportunity Analysis",
  command: "npm run saas:opportunity",
  lane: "research",
  tags: ["research", "ai"],
},
{
  id: "affiliate_research",
  label: "Affiliate Research",
  command: "npm run research:affiliate",
  lane: "research",
  tags: ["research", "ai"],
},
```

---

### G2 — No WebSocket / SSE push; dashboard polls every 30s
The dashboard uses `setInterval` polling. During a running job, the operator sees up to 30s of stale
data. For long-running AI jobs this is especially painful.

**Recommended:** Add a Server-Sent Events endpoint:
```javascript
app.get("/api/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  // push on job state changes
});
```

---

### G3 — No CORS lock-down; wildcard `Access-Control-Allow-Origin: *` with no auth gate
**File:** `scripts/architect-api.js`
When `ARCHITECT_API_KEY` is not set, any browser on any origin can call all `/api/*` endpoints.
This includes triggering `DASHBOARD_ACTIONS` (arbitrary shell commands).

**Fix:**
```javascript
const allowedOrigins = (process.env.ARCHITECT_ALLOWED_ORIGINS || "http://localhost:4051").split(",");
res.setHeader("Access-Control-Allow-Origin",
  allowedOrigins.includes(req.headers.origin) ? req.headers.origin : allowedOrigins[0]
);
```
And enforce `ARCHITECT_API_KEY` check if not in development.

---

### G4 — No rate limiting on `POST /api/action` (shell command injection surface)
Each `DASHBOARD_ACTIONS` entry runs a shell command via `spawn("bash", ["-lc", def.command])`.
There is no rate limit, no concurrency cap, and no check that the same action isn't already running.

**Fix:**
```javascript
const runningActions = new Set();

if (runningActions.has(actionId)) {
  return jsonResponse(res, 409, { error: "Action already running" });
}
runningActions.add(actionId);
proc.on("exit", () => runningActions.delete(actionId));
```
Add express-rate-limit for the `/api/action` route.

---

### G5 — No `queue_retry_failed` action in `DASHBOARD_ACTIONS`
H5 found that failed queue jobs are never surfaced. Equally, there is no one-click "retry all
failed" runbook action.

**Fix:** Add to `DASHBOARD_ACTIONS`:
```javascript
{
  id: "queue_retry_failed",
  label: "Retry Failed Jobs",
  command: "npm run queue:retry-failed",
  lane: "infra",
  tags: ["infra", "queue"],
},
```

---

### G6 — No pagination or virtual scroll on Jobs/Queue tab
The queue table renders ALL jobs in a single `innerHTML` swap. With hundreds of jobs this causes
layout jank and long render times.

**Fix:** Add server-side pagination (`?page=N&limit=50`) to the queue endpoint and add
prev/next buttons to the tab renderer.

---

### G7 — No export / download for audit findings or history
Operator has no way to pull a snapshot of current findings or action history without raw DB/file
access.

**Fix:** Add `GET /api/export/findings` and `GET /api/export/history` endpoints returning CSV/JSON.

---

### G8 — Research/Copy tab has no live copy-quality scoring feedback
The tab shows copy but gives no signal on whether it passed/failed QA or what the model confidence
score was.

**Fix:** Include `qa_score`, `model`, `confidence` fields in the research-copy API response and
render them as badge chips next to each copy block.

---

## PRIORITIZED FIX ORDER

| Priority | ID | What | File | Risk if not fixed |
|---|---|---|---|---|
| P0 | C1 | `let taskPlan` before `try` | architect-api.js ~425 | `/api/goal` always crashes |
| P0 | C2 | `plan_id` in UPDATE WHERE | architect-api.js ~520 | Token consumed on wrong plan |
| P0 | C3 | Fix regenerate action IDs | architect-api.js ~1784 | Regenerate triggers CI not research |
| P1 | H1 | Close outFd/errFd after spawn | architect-api.js ~344 | fd exhaustion under load |
| P1 | H4 | Deduplicate FRESHNESS_SLA | architect-api.js ~1089+1355 | Silent SLA drift |
| P1 | H5 | Surface queue.failed finding | architect-api.js | Failed jobs invisible |
| P1 | G1 | Add research DASHBOARD_ACTIONS | architect-api.js | Research tab non-functional |
| P2 | M1 | Live data in renderResearch | index.html ~862 | Misleading fake metrics |
| P2 | M2 | Route errors to active tab | index.html | Errors invisible |
| P2 | M3 | Fix status strip queue read | index.html | Queue depth always 0 |
| P3 | H2 | Async PM2 exec | architect-api.js | Event loop blocking |
| P3 | H3 | Mutex on history write | architect-api.js | Rare corruption under load |
| P3 | G3 | CORS lock-down | architect-api.js | Unauth shell command surface |
| P3 | G4 | Rate limit /api/action | architect-api.js | Action spam / double-run |
| P4 | L1 | Persist API key | index.html | UX annoyance |
| P4 | L2 | Clear refresh timer on tab | index.html | Wrong-tab refresh |
| P4 | L3 | Fix REPORTS_DIR path | architect-api.js | Reports not found |
| P4 | L4 | Cache buildProgressData | architect-api.js | DB hammer |

---

*End of audit — 3 CRITICAL, 5 HIGH, 6 MEDIUM, 4 LOW, 8 GAPS. All P0/P1 fixes applied in same PR.*
