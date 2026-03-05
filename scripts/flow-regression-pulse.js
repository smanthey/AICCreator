#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { v4: uuidv4 } = require("uuid");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const pg = require("../infra/postgres");
const { isKnownTaskType, resolveRouting } = require("../config/task-routing");
const { validatePayload } = require("../schemas/payloads");
const { buildTaskIdempotencyKey } = require("../control/idempotency");

const REPO_ROOT = process.env.CLAW_REPOS_ROOT || "$HOME/claw-repos";
const ENV_REPOS = (process.env.FLOW_REGRESSION_REPOS || "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);
const REPO_LIMIT = Math.max(1, Number.parseInt(String(process.env.FLOW_REGRESSION_REPO_LIMIT || "20"), 10) || 20);
const CONCURRENCY = Math.max(1, Number.parseInt(String(process.env.FLOW_REGRESSION_CONCURRENCY || "3"), 10) || 3);
const REPORT_DIR = path.join(__dirname, "reports");

let _routingColsEnsured = false;
async function ensureRoutingColumns() {
  if (_routingColsEnsured) return;
  await pg.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS required_tags TEXT[] DEFAULT '{}'`);
  await pg.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS idempotency_key TEXT`);
  _routingColsEnsured = true;
}

async function taskExists(idempotencyKey) {
  const { rows } = await pg.query(
    `SELECT 1
       FROM tasks
      WHERE idempotency_key = $1
        AND status IN ('CREATED','DISPATCHED','RUNNING','RETRY','PENDING_APPROVAL')
      LIMIT 1`,
    [idempotencyKey]
  );
  return rows.length > 0;
}

async function createTaskIfNeeded(type, payload) {
  if (!isKnownTaskType(type)) throw new Error(`Unknown task type: ${type}`);
  validatePayload(type, payload);
  await ensureRoutingColumns();

  const idempotencyKey = buildTaskIdempotencyKey(type, payload);
  if (await taskExists(idempotencyKey)) return { created: false, reason: "duplicate_active" };

  const id = uuidv4();
  const routing = resolveRouting(type);
  await pg.query(
    `INSERT INTO tasks (id, type, payload, status, worker_queue, required_tags, idempotency_key)
     VALUES ($1,$2,$3,'CREATED',$4,$5,$6)`,
    [id, type, payload || {}, routing.queue, routing.required_tags, idempotencyKey]
  );
  return { created: true, id };
}

function loadPackageScripts(repoPath) {
  const pkgPath = path.join(repoPath, "package.json");
  if (!fs.existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    return pkg.scripts || {};
  } catch {
    return null;
  }
}

function runCmd(repoPath, cmd, args, timeoutMs = 240000) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const proc = spawn(cmd, args, {
      cwd: repoPath,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
      setTimeout(() => proc.kill("SIGKILL"), 2000);
    }, timeoutMs);

    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));

    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        ok: Number(code || 0) === 0 && !timedOut,
        code: Number(code || 0),
        timedOut,
        duration_ms: Date.now() - startedAt,
        stdout_tail: stdout.slice(-3000),
        stderr_tail: stderr.slice(-3000),
      });
    });
  });
}

function plannedChecks(scripts) {
  const checks = [];
  if (scripts.check) checks.push({ name: "check", cmd: "npm", args: ["run", "-s", "check"] });
  if (scripts.build) checks.push({ name: "build", cmd: "npm", args: ["run", "-s", "build"] });
  if (!scripts.check && scripts.lint) checks.push({ name: "lint", cmd: "npm", args: ["run", "-s", "lint"] });
  if (scripts["test:ci"]) checks.push({ name: "test:ci", cmd: "npm", args: ["run", "-s", "test:ci"] });
  if (scripts["test:e2e:smoke"]) checks.push({ name: "test:e2e:smoke", cmd: "npm", args: ["run", "-s", "test:e2e:smoke"] });
  else if (scripts["test:e2e"]) checks.push({ name: "test:e2e", cmd: "npm", args: ["run", "-s", "test:e2e"] });
  else if (scripts["playwright:test"]) checks.push({ name: "playwright:test", cmd: "npm", args: ["run", "-s", "playwright:test"] });
  return checks;
}

async function auditRepo(repoName) {
  const repoPath = path.join(REPO_ROOT, repoName);
  const result = {
    repo: repoName,
    path: repoPath,
    status: "pass",
    checks: [],
    failure_count: 0,
  };

  if (!fs.existsSync(repoPath)) {
    result.status = "fail";
    result.error = "missing_repo";
    result.failure_count = 1;
    return result;
  }

  const scripts = loadPackageScripts(repoPath);
  if (!scripts) {
    result.status = "fail";
    result.error = "missing_or_invalid_package_json";
    result.failure_count = 1;
    return result;
  }

  const checks = plannedChecks(scripts);
  if (checks.length === 0) {
    result.status = "warn";
    result.error = "no_checkable_scripts";
    return result;
  }

  for (const check of checks) {
    const run = await runCmd(repoPath, check.cmd, check.args);
    result.checks.push({ check: check.name, ...run });
    if (!run.ok) result.failure_count += 1;
  }

  result.status = result.failure_count > 0 ? "fail" : "pass";
  return result;
}

async function runWithConcurrency(items, limit, workerFn) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await workerFn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

async function queueFollowups(failures) {
  const queued = [];
  for (const r of failures) {
    const reason = (r.error || r.checks.find((c) => !c.ok)?.check || "unknown").slice(0, 80);
    const payloadBase = {
      repo: r.repo,
      reason,
      source: "flow_regression_pulse",
      pulse_hour: new Date().toISOString().slice(0, 13),
    };

    // site_audit and site_fix_plan are idempotent due to pulse_hour bucketing.
    for (const type of ["site_audit", "site_fix_plan"]) {
      const res = await createTaskIfNeeded(type, payloadBase).catch((e) => ({
        created: false,
        reason: `error:${e.message}`,
      }));
      queued.push({ repo: r.repo, type, ...res });
    }
  }
  return queued;
}

async function resolveRepos() {
  if (ENV_REPOS.length > 0) return ENV_REPOS;
  const { rows } = await pg.query(
    `SELECT client_name
       FROM managed_repos
      WHERE status = 'active'
      ORDER BY client_name ASC
      LIMIT $1`,
    [REPO_LIMIT]
  );
  return rows.map((r) => r.client_name).filter(Boolean);
}

async function main() {
  const repos = await resolveRepos();
  console.log(`[flow-regression-pulse] start repos=${repos.length} concurrency=${CONCURRENCY}`);
  if (repos.length === 0) {
    console.log("[flow-regression-pulse] no repos resolved; skipping");
    return;
  }
  const audits = await runWithConcurrency(repos, CONCURRENCY, auditRepo);
  const failures = audits.filter((r) => r.status === "fail");
  const queued = await queueFollowups(failures);

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const reportPath = path.join(REPORT_DIR, `${Date.now()}-flow-regression-pulse.json`);
  const report = {
    generated_at: new Date().toISOString(),
    repos_checked: repos.length,
    failures: failures.length,
    results: audits,
    queued_followups: queued,
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log(
    `[flow-regression-pulse] done repos=${repos.length} failed=${failures.length} queued_followups=${queued.filter((q) => q.created).length}`
  );
  console.log(`[flow-regression-pulse] report=${reportPath}`);
}

main()
  .catch((err) => {
    console.error("[flow-regression-pulse] fatal:", err.message);
    process.exit(1);
  })
  .finally(async () => {
    await pg.end().catch(() => {});
  });
