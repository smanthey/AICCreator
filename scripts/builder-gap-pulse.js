#!/usr/bin/env node
"use strict";

/**
 * builder-gap-pulse.js
 * Run repo-completion gap analysis for selected repos (e.g. InayanBuilderBot), then queue
 * repo_autofix and opencode_controller for repos with incomplete sections, next_actions, or issues.
 * Used by the builder in the workforce to complete indexed repos and feed learnings to Inayan.
 *
 * Builder completion policy: job is to find every piece until completion (and possibly improvement).
 * The builder cannot stop if the app has gaps remaining or issues remaining; repos are only "done"
 * when incomplete_sections=0 and issues=0. hasGaps() therefore treats issues as gaps.
 *
 * Usage:
 *   node scripts/builder-gap-pulse.js --repos-from-context   (pulse all targets from master list .local)
 *   node scripts/builder-gap-pulse.js --repos <name>[,name2]
 *   node scripts/builder-gap-pulse.js --next
 *   node scripts/builder-gap-pulse.js --repos <name> --dry-run
 *   node scripts/builder-gap-pulse.js --repos <name> --force   (queue even if active task exists; unique idempotency key)
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { v4: uuidv4 } = require("uuid");

const pg = require("../infra/postgres");
const { isKnownTaskType, resolveRouting } = require("../config/task-routing");
const { validatePayload } = require("../schemas/payloads");
const { buildTaskIdempotencyKey } = require("../control/idempotency");

const ROOT = path.join(__dirname, "..");
const REPORTS_DIR = path.join(ROOT, "reports");
const ROLLING_PATH = path.join(REPORTS_DIR, "repo-completion-gap-rolling.json");
const { loadMasterList } = require("../config/repo-completion-master-list-loader");

/** Skip re-running gap analysis for repos that already have a recent "no gaps" result (avoid rebuild). */
const SKIP_IF_COMPLETE_MS = Number(process.env.BUILDER_SKIP_COMPLETE_MS) || 24 * 60 * 60 * 1000; // 24h

const ACTIVE_TASK_STATUSES = ["CREATED", "DISPATCHED", "RUNNING", "RETRY", "PENDING_APPROVAL", "DEAD_LETTER"];
let _routingColsEnsured = false;

function getArg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  if (i < 0 || i + 1 >= process.argv.length) return fallback;
  const v = String(process.argv[i + 1] || "").trim();
  return v || fallback;
}

function hasArg(flag) {
  return process.argv.includes(flag);
}

// loadMasterList from repo-completion-master-list-loader (uses .local or env path; no repo names in git)

function existingRepos() {
  const CLAW_REPOS = process.env.CLAW_REPOS_ROOT || process.env.CLAW_REPOS || path.join(process.env.HOME || require("os").homedir(), "claw-repos");
  const master = loadMasterList();
  const names = [...(master.priority_repos || []), ...(master.additional_repos || [])];
  return names.filter((name) => {
    const p = path.join(CLAW_REPOS, name);
    return fs.existsSync(p) && fs.statSync(p).isDirectory();
  });
}

function pickNextRepo() {
  const list = existingRepos();
  if (!list.length) return null;
  let rolling = [];
  try {
    rolling = JSON.parse(fs.readFileSync(ROLLING_PATH, "utf8"));
  } catch {}
  const recent = new Set((rolling.slice(-list.length * 2) || []).map((r) => r.repo));
  return list.find((r) => !recent.has(r)) || list[0];
}

function runGapAnalysis(repoName, dryRun) {
  const res = spawnSync(
    "node",
    [path.join(ROOT, "scripts", "repo-completion-gap-one.js"), "--repo", repoName, ...(dryRun ? ["--dry-run"] : [])],
    { cwd: ROOT, env: process.env, stdio: "pipe", encoding: "utf8", timeout: 600000 }
  );
  return { ok: res.status === 0, repo: repoName, stderr: (res.stderr || "").slice(0, 500) };
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
    [id, type, payload || {}, routing.queue, routing.required_tags || [], idempotencyKey]
  );
  return { created: true, id, idempotencyKey };
}

async function queueOpencodeController(payload) {
  const type = "opencode_controller";
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
    [id, type, payload || {}, routing.queue, routing.required_tags || [], idempotencyKey]
  );
  return { created: true, id, idempotencyKey };
}

/** Builder policy: job is to find every piece until completion (and possibly improvement); cannot stop while gaps or issues remain. */
const BUILDER_COMPLETION_POLICY =
  "Context: People only describe a small portion of what is needed to actually build anything. Your job is to fill in ALL the gaps—not just complete the obvious. Infer and implement everything a professional build requires (env, error handling, tests, security, observability, etc.). Job: find every piece until completion and possibly improvement. You cannot stop if the app has gaps remaining or issues remaining. Only consider the repo done when incomplete_sections=0 and issues=0.";

function hasGaps(record) {
  if (!record || !record.sections) return true; // no record => assume has gaps (run analysis)
  const incomplete = Object.values(record.sections).filter((v) => v && v.status !== "complete");
  if (incomplete.length > 0) return true;
  if (Array.isArray(record.next_actions) && record.next_actions.length > 0) return true;
  if (Array.isArray(record.issues) && record.issues.length > 0) return true;
  return false;
}

function isRecent(record, maxAgeMs) {
  const t = record && (record.completed_at || record.started_at);
  if (!t) return false;
  const ts = new Date(t).getTime();
  return Date.now() - ts <= maxAgeMs;
}

/** Latest rolling entry per repo (by completed_at). Used to skip gap analysis when already complete. */
function latestEntryByRepo(rolling, repoNames) {
  const byRepo = new Map();
  const list = Array.isArray(rolling) ? rolling : [];
  for (const r of list) {
    const repo = r && r.repo;
    if (!repo || !repoNames.includes(repo)) continue;
    const existing = byRepo.get(repo);
    const rTime = r.completed_at || r.started_at || "";
    const exTime = existing ? (existing.completed_at || existing.started_at || "") : "";
    if (!existing || rTime > exTime) byRepo.set(repo, r);
  }
  return byRepo;
}

function latestGapsByRepo(rolling, repoNames) {
  const byRepo = new Map();
  const list = Array.isArray(rolling) ? rolling : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const r = list[i];
    const repo = r && r.repo;
    if (!repo || !repoNames.includes(repo)) continue;
    if (!byRepo.has(repo) && hasGaps(r)) byRepo.set(repo, r);
  }
  return byRepo;
}

async function main() {
  const dryRun = hasArg("--dry-run");
  const useNext = hasArg("--next");
  const reposFromContext = hasArg("--repos-from-context");
  const reposArg = getArg("--repos", null);

  let repoNames = [];
  if (reposFromContext) {
    const { inayanBuildTargets } = require("../config/inayan-builder-context");
    const existing = existingRepos();
    repoNames = inayanBuildTargets.filter((r) => existing.includes(r));
    if (!repoNames.length) {
      console.error("[builder-gap-pulse] --repos-from-context: no inayanBuildTargets found under CLAW_REPOS.");
      process.exit(2);
    }
  } else if (reposArg) {
    repoNames = reposArg.split(",").map((s) => s.trim()).filter(Boolean);
  } else if (useNext) {
    const next = pickNextRepo();
    if (!next) {
      console.error("[builder-gap-pulse] No repo found for --next (no dirs in master list under CLAW_REPOS?)");
      process.exit(2);
    }
    repoNames = [next];
  }

  if (!repoNames.length) {
    console.error("[builder-gap-pulse] Usage: --repos-from-context | --repos <name>[,name2] | --next [--dry-run]");
    process.exit(2);
  }

  console.log("[builder-gap-pulse] Repos:", repoNames.join(", "), dryRun ? "(dry-run)" : "");

  let rolling = [];
  try {
    rolling = JSON.parse(fs.readFileSync(ROLLING_PATH, "utf8"));
  } catch {}

  const force = hasArg("--force");
  const latestEntry = latestEntryByRepo(rolling, repoNames);
  const repoNamesToRun = repoNames.filter((repo) => {
    if (force) return true;
    const r = latestEntry.get(repo);
    if (!r) return true;
    if (hasGaps(r)) return true;
    if (!isRecent(r, SKIP_IF_COMPLETE_MS)) return true;
    return false;
  });
  const skipped = repoNames.filter((r) => !repoNamesToRun.includes(r));
  if (skipped.length) {
    console.log("[builder-gap-pulse] Skipping gap analysis (already complete, no rebuild):", skipped.join(", "));
  }

  for (const repo of repoNamesToRun) {
    console.log(`[builder-gap-pulse] Running gap analysis for ${repo}...`);
    const run = runGapAnalysis(repo, dryRun);
    if (!run.ok) console.warn(`[builder-gap-pulse] Gap analysis failed for ${repo}:`, run.stderr);
  }

  try {
    rolling = JSON.parse(fs.readFileSync(ROLLING_PATH, "utf8"));
  } catch {}

  const gapsByRepo = latestGapsByRepo(rolling, repoNames);
  const queued = [];
  const pulseHour = new Date().toISOString().slice(0, 13);
  const forceQueue = hasArg("--force");

  for (const [repo, record] of gapsByRepo) {
    const reason = (record.next_actions && record.next_actions.length)
      ? `builder_gap: ${record.next_actions.slice(0, 2).join("; ")}`
      : "builder_gap: incomplete_sections";

    if (!dryRun) {
      try {
        const incompleteSections = record.sections
          ? Object.entries(record.sections).filter(([, v]) => v && v.status !== "complete").map(([id, v]) => ({ id, status: v.status, detail: v.detail }))
          : [];
        const gapContext = {
          incomplete_sections: incompleteSections,
          benchmark_lookup: record.benchmark_lookup || {},
          issues: record.issues || [],
          next_actions: record.next_actions || [],
          quality_gate_scripts: ["check", "build", "lint", "test", "test:ci", "test:e2e", "test:e2e:smoke"],
        };

        const ts = forceQueue ? Date.now() : 0;
        const autofixPayload = {
          repo,
          source: "builder_gap_pulse",
          reason,
          checks_failed: record.next_actions || ["completion_gap"],
          pulse_hour: pulseHour,
          gap_context: gapContext,
          builder_policy: BUILDER_COMPLETION_POLICY,
          ...(forceQueue ? { idempotency_key: `builder_gap_force_${repo}_${ts}_autofix` } : {}),
        };
        const ar = await queueRepoAutofix(autofixPayload);
        queued.push({ repo, type: "repo_autofix", ...ar });

        const objective = `Address completion gaps: ${(record.next_actions || []).slice(0, 3).join("; ") || "incomplete sections"}.`;
        const opencodeForceKey = forceQueue ? `builder_gap_force_${repo}_${ts}_opencode` : undefined;
        const opencodePayload = {
          repo,
          objective,
          source: "builder_gap_pulse",
          iteration: 1,
          max_iterations: 2,
          gap_context: gapContext,
          builder_policy: BUILDER_COMPLETION_POLICY,
          ...(forceQueue ? { idempotency_key: opencodeForceKey } : {}),
        };
        const oc = await queueOpencodeController(opencodePayload);
        queued.push({ repo, type: "opencode_controller", ...oc });
      } catch (err) {
        console.error(`[builder-gap-pulse] Queue failed for ${repo}:`, err.message);
        queued.push({ repo, error: err.message });
      }
    } else {
      queued.push({ repo, would_queue: true, reason });
    }
  }

  console.log("[builder-gap-pulse] Done. Repos with gaps:", gapsByRepo.size, "queued:", queued.filter((q) => q.created).length);
  if (queued.length) {
    for (const q of queued) {
      console.log(`  ${q.repo}: ${q.type || "error"} created=${q.created} ${q.reason || q.error || ""}`);
    }
  }
  await pg.end();
}

main().catch((err) => {
  console.error("[builder-gap-pulse] Fatal:", err);
  process.exit(1);
});
