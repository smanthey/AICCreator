#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { v4: uuidv4 } = require("uuid");

const pg = require("../infra/postgres");
const { isKnownTaskType, resolveRouting } = require("../config/task-routing");
const { validatePayload } = require("../schemas/payloads");
const { buildTaskIdempotencyKey } = require("../control/idempotency");

const ROOT = path.join(__dirname, "..");
const REPORT_DIR = path.join(__dirname, "reports");

const MAX_LOOPS = Math.max(1, Number.parseInt(String(process.env.NEEDS_ATTENTION_MAX_LOOPS || "3"), 10) || 3);
const TOP_REPOS_PER_LOOP = Math.max(1, Number.parseInt(String(process.env.NEEDS_ATTENTION_TOP_REPOS || "4"), 10) || 4);
const STRICT_E2E = String(process.env.NEEDS_ATTENTION_STRICT_E2E || "true").toLowerCase() === "true";

// Include DEAD_LETTER so already-failed tasks are not re-queued, preventing quarantine spam loops.
const ACTIVE_TASK_STATUSES = ["CREATED", "DISPATCHED", "RUNNING", "RETRY", "PENDING_APPROVAL", "DEAD_LETTER"];
let _routingColsEnsured = false;

function run(cmd, args, extraEnv = {}) {
  const startedAt = new Date().toISOString();
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 30 * 60 * 1000,
    env: { ...process.env, ...extraEnv },
  });
  return {
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    command: [cmd, ...args].join(" "),
    ok: Number(r.status || 0) === 0,
    code: Number(r.status || 0),
    stdout_tail: String(r.stdout || "").slice(-2000),
    stderr_tail: String(r.stderr || "").slice(-2000),
    timed_out: Boolean(r.error && /timed out/i.test(String(r.error.message || ""))),
    error: r.error ? String(r.error.message || r.error) : null,
  };
}

function latestReportFile(suffix) {
  if (!fs.existsSync(REPORT_DIR)) return null;
  const files = fs.readdirSync(REPORT_DIR)
    .filter((f) => f.endsWith(suffix))
    .sort((a, b) => {
      const aTs = parseInt(String(a).split("-")[0], 10);
      const bTs = parseInt(String(b).split("-")[0], 10);
      if (Number.isFinite(aTs) && Number.isFinite(bTs) && aTs !== bTs) return aTs - bTs;
      try {
        return fs.statSync(path.join(REPORT_DIR, a)).mtimeMs - fs.statSync(path.join(REPORT_DIR, b)).mtimeMs;
      } catch {
        return a.localeCompare(b);
      }
    });
  if (!files.length) return null;
  return path.join(REPORT_DIR, files[files.length - 1]);
}

function readJsonSafe(filePath) {
  if (!filePath) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function issueWeight(item) {
  let score = 0;
  if (item.blocking) score += 100;
  if (item.kind === "playwright_fail") score += 80;
  if (item.kind === "playwright_skip") score += 60;
  if (item.kind === "uptime_fail") score += 70;
  if (/repo_missing|no_playwright_script/i.test(item.reason || "")) score += 30;
  if (/test_failure/i.test(item.reason || "")) score += 25;
  if (/next_|vite_|database_|playwright_/i.test(item.reason || "")) score += 20;
  return score;
}

function extractLaunchIssues(launch) {
  const issues = [];
  for (const r of launch.results || []) {
    if (r.uptime && !r.uptime.ok) {
      issues.push({
        repo: r.repo || null,
        name: r.name,
        blocking: !!r.blocking,
        kind: "uptime_fail",
        reason: r.uptime.error || `status_${r.uptime.status || 0}`,
      });
    }

    const p = r.playwright || {};
    if (p.ok === false && !p.skipped) {
      issues.push({
        repo: r.repo || null,
        name: r.name,
        blocking: !!r.blocking,
        kind: "playwright_fail",
        reason: p.fail_reason || p.skip_reason || "test_failure",
      });
    }

    if (p.skipped) {
      issues.push({
        repo: r.repo || null,
        name: r.name,
        blocking: !!r.blocking,
        kind: "playwright_skip",
        reason: p.skip_reason || p.reason || "skipped",
      });
    }
  }

  return issues
    .map((i) => ({ ...i, score: issueWeight(i) }))
    .sort((a, b) => b.score - a.score || Number(b.blocking) - Number(a.blocking) || a.name.localeCompare(b.name));
}

async function ensureRoutingColumns() {
  if (_routingColsEnsured) return;
  await pg.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS required_tags TEXT[] DEFAULT '{}'`);
  await pg.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS idempotency_key TEXT`);
  _routingColsEnsured = true;
}

async function taskExists(idempotencyKey) {
  const { rows } = await pg.query(
    `SELECT 1 FROM tasks WHERE idempotency_key = $1 AND status = ANY($2::text[]) LIMIT 1`,
    [idempotencyKey, ACTIVE_TASK_STATUSES]
  );
  return rows.length > 0;
}

async function queueRepoAutofix(payload) {
  const type = "repo_autofix";
  if (!isKnownTaskType(type)) throw new Error(`Unknown task type: ${type}`);
  validatePayload(type, payload);
  await ensureRoutingColumns();

  const idempotencyKey = buildTaskIdempotencyKey(type, payload || {});
  if (await taskExists(idempotencyKey)) {
    return { created: false, reason: "duplicate_active", idempotencyKey };
  }

  const routing = resolveRouting(type);
  const id = uuidv4();
  await pg.query(
    `INSERT INTO tasks (id, type, payload, status, worker_queue, required_tags, idempotency_key)
     VALUES ($1,$2,$3,'CREATED',$4,$5,$6)`,
    [id, type, payload || {}, routing.queue, routing.required_tags, idempotencyKey]
  );
  return { created: true, id, idempotencyKey };
}

function runStrictLaunchMatrix() {
  return run("node", ["scripts/launch-e2e-matrix.js"], {
    LAUNCH_E2E_FAIL_ON_SKIP: STRICT_E2E ? "true" : String(process.env.LAUNCH_E2E_FAIL_ON_SKIP || "false"),
    LAUNCH_E2E_FAIL_ON_SKIP_ALL: STRICT_E2E ? "true" : String(process.env.LAUNCH_E2E_FAIL_ON_SKIP_ALL || "false"),
    LAUNCH_E2E_FAIL_ON_ANY: STRICT_E2E ? "true" : String(process.env.LAUNCH_E2E_FAIL_ON_ANY || "false"),
  });
}

async function main() {
  const startedAt = new Date().toISOString();
  const loops = [];
  const queued = [];
  const queuedRepos = new Set();

  for (let i = 1; i <= MAX_LOOPS; i += 1) {
    const pass = { loop: i, actions: [] };

    const e2eRun = runStrictLaunchMatrix();
    pass.actions.push(e2eRun);

    const launchPath = latestReportFile("-launch-e2e-matrix.json");
    const launch = readJsonSafe(launchPath) || { failures: 999, blocking_failures: 999, skipped_checks: 999, results: [] };
    const ranked = extractLaunchIssues(launch);

    pass.launch_report = launchPath;
    pass.failures = Number(launch.failures || 0);
    pass.blocking_failures = Number(launch.blocking_failures || 0);
    pass.skipped_checks = Number(launch.skipped_checks || 0);
    pass.ranked_top = ranked.slice(0, 10);

    if (pass.failures === 0 && pass.blocking_failures === 0 && pass.skipped_checks === 0) {
      loops.push(pass);
      break;
    }

    const topRepoIssues = ranked
      .filter((r) => !!r.repo)
      .reduce((acc, item) => {
        if (!acc.some((x) => x.repo === item.repo)) acc.push(item);
        return acc;
      }, [])
      .slice(0, TOP_REPOS_PER_LOOP);

    for (const issue of topRepoIssues) {
      if (queuedRepos.has(issue.repo)) continue;
      const payload = {
        repo: path.basename(issue.repo),
        source: "weighted_autofix",
        reason: `${issue.kind}:${issue.reason}`,
        checks_failed: [issue.kind, issue.reason],
        weighted_score: issue.score,
        pulse_hour: new Date().toISOString().slice(0, 13),
      };
      try {
        const q = await queueRepoAutofix(payload);
        queued.push({ ...issue, ...q, payload });
        if (q.created) queuedRepos.add(issue.repo);
      } catch (err) {
        queued.push({ ...issue, created: false, reason: `queue_error:${err.message}`, payload });
      }
    }

    // Execute deterministic follow-ups before next loop.
    pass.actions.push(run("node", ["scripts/regression-autofix-pulse.js"]));
    pass.actions.push(run("node", ["scripts/git-sites-subagent-pulse.js"]));
    pass.actions.push(run("node", ["scripts/qa-human-grade.js", "--blocking-only"]));

    loops.push(pass);
  }

  // Final strict verification pass.
  const finalE2E = runStrictLaunchMatrix();
  const finalLaunchPath = latestReportFile("-launch-e2e-matrix.json");
  const finalLaunch = readJsonSafe(finalLaunchPath) || {};
  const finalRanked = extractLaunchIssues(finalLaunch).slice(0, 10);
  const finalStatus = run("node", ["scripts/global-redgreen-status.js"]);

  const report = {
    generated_at: new Date().toISOString(),
    started_at: startedAt,
    strict_mode: STRICT_E2E,
    max_loops: MAX_LOOPS,
    top_repos_per_loop: TOP_REPOS_PER_LOOP,
    loops,
    queued,
    summary: {
      top_remaining: finalRanked,
    },
    final: {
      e2e_run: finalE2E,
      launch_report: finalLaunchPath,
      launch: {
        failures: Number(finalLaunch.failures || 0),
        blocking_failures: Number(finalLaunch.blocking_failures || 0),
        skipped_checks: Number(finalLaunch.skipped_checks || 0),
      },
      status_run: finalStatus,
    },
  };

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const outPath = path.join(REPORT_DIR, `${Date.now()}-needs-attention-autofix-pulse.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log("\n=== Needs Attention Weighted Closure ===\n");
  console.log(`report: ${outPath}`);
  console.log(`loops_run: ${loops.length}`);
  console.log(`queued_repo_autofix: ${queued.filter((q) => q.created).length}`);
  console.log(`final failures=${report.final.launch.failures} blocking=${report.final.launch.blocking_failures} skipped=${report.final.launch.skipped_checks}`);
  if (report.summary.top_remaining.length) {
    console.log("top_remaining:");
    for (const item of report.summary.top_remaining.slice(0, 5)) {
      console.log(`- ${item.name} score=${item.score} kind=${item.kind} reason=${item.reason}`);
    }
  }

  if (report.final.launch.failures > 0 || report.final.launch.blocking_failures > 0 || report.final.launch.skipped_checks > 0) {
    process.exit(1);
  }
}

main()
  .catch((err) => {
    console.error("[needs-attention-autofix-pulse] fatal:", err.message);
    process.exit(1);
  })
  .finally(async () => {
    await pg.end().catch(() => {});
  });
