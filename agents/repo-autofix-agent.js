// agents/repo-autofix-agent.js
"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { v4: uuidv4 } = require("uuid");
const pg = require("../infra/postgres");
const { register } = require("./registry");
const { resolveRouting, isKnownTaskType } = require("../config/task-routing");
const { validatePayload } = require("../schemas/payloads");
const { buildTaskIdempotencyKey } = require("../control/idempotency");

const REPO_ROOT = process.env.CLAW_REPOS_ROOT || "$HOME/claw-repos";
const ACTIVE_TASK_STATUSES = ["CREATED", "DISPATCHED", "RUNNING", "RETRY", "PENDING_APPROVAL"];

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
        AND status = ANY($2::text[])
      LIMIT 1`,
    [idempotencyKey, ACTIVE_TASK_STATUSES]
  );
  return rows.length > 0;
}

async function createTaskIfNeeded(type, payload) {
  if (!isKnownTaskType(type)) throw new Error(`Unknown task type: ${type}`);
  validatePayload(type, payload);
  await ensureRoutingColumns();

  const idempotencyKey = buildTaskIdempotencyKey(type, payload || {});
  if (await taskExists(idempotencyKey)) return { created: false, reason: "duplicate_active" };

  const routing = resolveRouting(type);
  const id = uuidv4();
  await pg.query(
    `INSERT INTO tasks (id, type, payload, status, worker_queue, required_tags, idempotency_key)
     VALUES ($1,$2,$3,'CREATED',$4,$5,$6)`,
    [id, type, payload || {}, routing.queue, routing.required_tags, idempotencyKey]
  );
  return { created: true, id };
}

function resolveRepoPath(repo) {
  const raw = String(repo || "").trim();
  if (!raw) return "";
  if (path.isAbsolute(raw)) return raw;
  const normalized = raw.startsWith("local/") ? raw.slice("local/".length) : raw;
  return path.join(REPO_ROOT, normalized);
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

function loadPackageJson(repoPath) {
  const pkgPath = path.join(repoPath, "package.json");
  if (!fs.existsSync(pkgPath)) return null;
  try {
    return { path: pkgPath, data: JSON.parse(fs.readFileSync(pkgPath, "utf8")) };
  } catch {
    return null;
  }
}

/** Professional QA order: typecheck/build → lint → test → e2e. Used so builds are tested and QA'd before considered complete. */
function plannedChecks(scripts) {
  const checks = [];
  if (scripts.check) checks.push({ name: "check", cmd: "npm", args: ["run", "-s", "check"], timeoutMs: 300000 });
  if (scripts.build) checks.push({ name: "build", cmd: "npm", args: ["run", "-s", "build"], timeoutMs: 420000 });
  if (!scripts.check && scripts.lint) checks.push({ name: "lint", cmd: "npm", args: ["run", "-s", "lint"], timeoutMs: 300000 });
  if (scripts["test:ci"]) checks.push({ name: "test:ci", cmd: "npm", args: ["run", "-s", "test:ci"], timeoutMs: 420000 });
  else if (scripts.test) checks.push({ name: "test", cmd: "npm", args: ["run", "-s", "test"], timeoutMs: 420000 });
  if (scripts["test:e2e"] || scripts["test:e2e:smoke"]) {
    const e2eScript = scripts["test:e2e"] ? "test:e2e" : "test:e2e:smoke";
    checks.push({ name: e2eScript, cmd: "npm", args: ["run", "-s", e2eScript], timeoutMs: 300000 });
  }
  return checks;
}

function maybeApplyDeterministicPatch(pkgWrap) {
  if (!pkgWrap || !pkgWrap.data || typeof pkgWrap.data !== "object") return [];
  const pkg = pkgWrap.data;
  pkg.scripts = pkg.scripts || {};
  const changes = [];
  if (!pkg.scripts.check && pkg.scripts.build) {
    pkg.scripts.check = "npm run -s build";
    changes.push("added package.json scripts.check -> npm run -s build");
  } else if (!pkg.scripts.check && pkg.scripts.lint) {
    pkg.scripts.check = "npm run -s lint";
    changes.push("added package.json scripts.check -> npm run -s lint");
  }
  if (changes.length > 0) {
    fs.writeFileSync(pkgWrap.path, `${JSON.stringify(pkg, null, 2)}\n`);
  }
  return changes;
}

async function queueFixPlan(repo, reason, checksFailed, source, pulseHour) {
  const base = {
    repo,
    reason: reason || "repo_autofix_failed",
    source: source || "repo_autofix",
    pulse_hour: pulseHour || new Date().toISOString().slice(0, 13),
    checks_failed: checksFailed || [],
  };
  const out = [];
  for (const type of ["site_audit", "site_fix_plan"]) {
    const payload =
      type === "site_fix_plan"
        ? { repo, reason: base.reason, source: base.source, pulse_hour: base.pulse_hour }
        : { repo, source: base.source, pulse_hour: base.pulse_hour };
    const res = await createTaskIfNeeded(type, payload).catch((e) => ({ created: false, reason: e.message }));
    out.push({ type, ...res });
  }
  return out;
}

register("repo_autofix", async (payload) => {
  const repo = String(payload.repo || "").trim();
  if (!repo) throw new Error("repo_autofix requires payload.repo");

  const repoPath = resolveRepoPath(repo);
  if (!fs.existsSync(repoPath)) {
    throw new Error(`repo_autofix repo missing: ${repoPath}`);
  }

  const pkgWrap = loadPackageJson(repoPath);
  if (!pkgWrap) {
    throw new Error(`repo_autofix missing/invalid package.json in ${repo}`);
  }

  const patchesApplied = maybeApplyDeterministicPatch(pkgWrap);

  const installResult = await runCmd(repoPath, "npm", ["install", "--no-audit", "--no-fund"], 480000);
  const scripts = pkgWrap.data.scripts || {};
  const checks = plannedChecks(scripts);
  const checkResults = [];
  for (const c of checks) {
    checkResults.push({ check: c.name, ...(await runCmd(repoPath, c.cmd, c.args, c.timeoutMs)) });
  }
  const failedChecks = checkResults.filter((x) => !x.ok).map((x) => x.check);
  const verifiedPass = installResult.ok && failedChecks.length === 0;

  if (!verifiedPass) {
    const followups = await queueFixPlan(
      repo,
      payload.reason || "verification_failed",
      failedChecks,
      payload.source || "repo_autofix",
      payload.pulse_hour || null
    );
    return {
      repo,
      source: payload.source || null,
      reason: payload.reason || null,
      patches_applied: patchesApplied,
      install: installResult,
      checks: checkResults,
      verified_pass: false,
      followups_queued: followups,
      escalation: "site_fix_plan",
      cost_usd: 0,
      model_used: "deterministic-repo-autofix",
    };
  }

  return {
    repo,
    source: payload.source || null,
    reason: payload.reason || null,
    patches_applied: patchesApplied,
    install: installResult,
    checks: checkResults,
    verified_pass: true,
    cost_usd: 0,
    model_used: "deterministic-repo-autofix",
  };
});
