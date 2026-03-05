#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const pg = require("../infra/postgres");
const { resolveRouting, isKnownTaskType } = require("../config/task-routing");
const { validatePayload } = require("../schemas/payloads");
const { buildTaskIdempotencyKey } = require("../control/idempotency");

const ACTIVE_STATUSES = ["CREATED", "DISPATCHED", "RUNNING", "RETRY", "PENDING_APPROVAL"];
const TARGET_REPOS = (process.env.ROBLOX_GROWTH_REPOS || "RobloxGitSync")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);
const TOP_PRIORITY = 9; // Top-priority areas (lead gen, payclaw, clawpay, roblox) use 9; spreads across all devices
const REPORT_DIR = path.join(__dirname, "reports");
const DOWNSTREAM_WINDOW_HOURS = Math.max(1, Number(process.env.ROBLOX_OUTCOME_WINDOW_HOURS || "12") || 12);

function hasFlag(flag) {
  return process.argv.slice(2).includes(flag);
}

async function ensureRoutingColumns() {
  await pg.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS required_tags TEXT[] DEFAULT '{}'`);
  await pg.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS idempotency_key TEXT`);
}

async function taskExists(idempotencyKey) {
  const { rows } = await pg.query(
    `SELECT 1 FROM tasks WHERE idempotency_key=$1 AND status = ANY($2::text[]) LIMIT 1`,
    [idempotencyKey, ACTIVE_STATUSES]
  );
  return rows.length > 0;
}

async function createTaskIfNeeded(type, payload, priority = 5, dryRun = false) {
  if (!isKnownTaskType(type)) throw new Error(`Unknown task type: ${type}`);
  validatePayload(type, payload || {});
  const idempotencyKey = buildTaskIdempotencyKey(type, payload || {});
  if (await taskExists(idempotencyKey)) {
    return { created: false, reason: "duplicate_active", type, idempotencyKey };
  }

  if (dryRun) {
    return { created: true, dry_run: true, type, payload, priority, idempotencyKey };
  }

  const id = uuidv4();
  const routing = resolveRouting(type);
  await pg.query(
    `INSERT INTO tasks (id, type, payload, status, priority, worker_queue, required_tags, idempotency_key)
     VALUES ($1,$2,$3::jsonb,'CREATED',$4,$5,$6,$7)`,
    [id, type, JSON.stringify(payload || {}), priority, routing.queue, routing.required_tags, idempotencyKey]
  );
  await pg.query(`SELECT pg_notify('task_created', $1)`, [id]).catch(() => {});
  return { created: true, id, type, priority };
}

async function findRobloxRepos() {
  const { rows } = await pg.query(
    `SELECT id, client_name, repo_url, local_path, branch, status
       FROM managed_repos
      WHERE status='active'
        AND client_name = ANY($1::text[])
      ORDER BY client_name ASC`,
    [TARGET_REPOS]
  );
  return rows;
}

async function queueForRepo(repo, dryRun) {
  const queued = [];

  queued.push(await createTaskIfNeeded("github_sync", {
    all: false,
    repo_ids: [repo.id],
    source: "roblox_game_growth_pulse",
  }, TOP_PRIORITY, dryRun));

  queued.push(await createTaskIfNeeded("github_repo_audit", {
    all: false,
    repo_ids: [repo.id],
    source: "roblox_game_growth_pulse",
  }, TOP_PRIORITY, dryRun));

  queued.push(await createTaskIfNeeded("github_observability_scan", {
    repos: [repo.client_name],
    save: true,
    source: "roblox_game_growth_pulse",
  }, TOP_PRIORITY, dryRun));

  queued.push(await createTaskIfNeeded("site_audit", {
    repo: repo.client_name,
    source: "roblox_game_growth_pulse",
    objective: "Audit Roblox puzzle-fighter for load and visibility blockers first: what prevents the place from loading or displaying in Studio, missing refs, script errors, Rojo/sync issues. Then retention and monetization.",
  }, TOP_PRIORITY, dryRun));

  queued.push(await createTaskIfNeeded("opencode_controller", {
    repo: repo.client_name,
    source: "roblox_game_growth_pulse",
    objective: "Cleanup first: fix Roblox project so it loads and displays in Studio. Fix missing refs, script load errors, Rojo tree and sync, camera/visibility so the game is viewable and playable. No new features until load is stable. Then core gameplay per docs/ROBLOX-PUZZLE-FIGHTER-RESEARCH.md: controls, combo chain, power gems, counter gems, drop alley, matchmaking.",
    max_iterations: 4,
    quality_target: 95,
    auto_iterate: true,
  }, TOP_PRIORITY, dryRun));

  queued.push(await createTaskIfNeeded("opencode_controller", {
    repo: repo.client_name,
    source: "roblox_game_growth_pulse_growth",
    objective: "Cleanup and stability: remove dead code, fix script errors and load order, ensure Rojo tree matches Studio so the place loads. Run Lua tests and repo_autofix. After cleanup is stable, incremental live-ops (onboarding, quests, rewards). Do not add features before load works.",
    max_iterations: 4,
    quality_target: 95,
    auto_iterate: true,
    force_implement: true,
  }, TOP_PRIORITY, dryRun));

  return queued;
}

function resultExcerpt(result) {
  if (!result || typeof result !== "object") return null;
  const keys = [
    "ok",
    "status",
    "summary",
    "created_count",
    "skipped_duplicates",
    "repos_scanned",
    "pass_count",
    "fail_count",
    "high_findings",
    "blocking_failures",
    "failures",
  ];
  const out = {};
  for (const k of keys) {
    if (result[k] != null) out[k] = result[k];
  }
  return Object.keys(out).length ? out : null;
}

async function collectDownstreamOutcomes(repoNames) {
  const names = Array.isArray(repoNames) ? repoNames.filter(Boolean) : [];
  if (!names.length) {
    return { window_hours: DOWNSTREAM_WINDOW_HOURS, rows: [], summary: {}, latest_failures: [] };
  }
  const sources = ["roblox_game_growth_pulse", "roblox_game_growth_pulse_growth"];
  const taskTypes = ["opencode_controller", "site_audit", "github_repo_audit", "github_sync", "github_observability_scan"];
  const { rows } = await pg.query(
    `SELECT
       id, type, status, created_at, started_at, completed_at, last_error,
       COALESCE(payload->>'repo', '') AS repo,
       payload, result
     FROM tasks
     WHERE type = ANY($1::text[])
       AND COALESCE(payload->>'source','') = ANY($2::text[])
       AND created_at >= NOW() - ($3::text || ' hours')::interval
       AND (
         COALESCE(payload->>'repo','') = ANY($4::text[])
         OR EXISTS (
           SELECT 1
           FROM jsonb_array_elements_text(COALESCE(payload->'repos','[]'::jsonb)) AS rr(v)
           WHERE rr.v = ANY($4::text[])
         )
       )
     ORDER BY created_at DESC
     LIMIT 500`,
    [taskTypes, sources, String(DOWNSTREAM_WINDOW_HOURS), names]
  );

  const summary = {};
  for (const row of rows) {
    const type = String(row.type || "unknown");
    if (!summary[type]) summary[type] = { total: 0 };
    const bucket = summary[type];
    bucket.total += 1;
    const s = String(row.status || "unknown").toLowerCase();
    bucket[s] = (bucket[s] || 0) + 1;
  }

  const latestFailures = rows
    .filter((r) => ["failed", "dead_letter"].includes(String(r.status || "").toLowerCase()))
    .slice(0, 10)
    .map((r) => ({
      id: r.id,
      type: r.type,
      status: r.status,
      repo: r.repo || null,
      created_at: r.created_at,
      completed_at: r.completed_at,
      last_error: r.last_error ? String(r.last_error).slice(0, 300) : null,
      result_excerpt: resultExcerpt(r.result),
    }));

  return {
    window_hours: DOWNSTREAM_WINDOW_HOURS,
    rows: rows.map((r) => ({
      id: r.id,
      type: r.type,
      status: r.status,
      repo: r.repo || null,
      created_at: r.created_at,
      completed_at: r.completed_at,
      result_excerpt: resultExcerpt(r.result),
      last_error: r.last_error ? String(r.last_error).slice(0, 300) : null,
    })),
    summary,
    latest_failures: latestFailures,
  };
}

function writeReport(report) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[.:]/g, "-");
  const jsonPath = path.join(REPORT_DIR, `${stamp}-roblox-game-growth-pulse.json`);
  const latestPath = path.join(REPORT_DIR, "roblox-game-growth-pulse-latest.json");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(latestPath, JSON.stringify(report, null, 2));
  return { jsonPath, latestPath };
}

async function main() {
  const dryRun = hasFlag("--dry-run");
  await ensureRoutingColumns();

  const repos = await findRobloxRepos();
  const report = {
    generated_at: new Date().toISOString(),
    dry_run: dryRun,
    target_repos: TARGET_REPOS,
    repos_found: repos.map((r) => ({
      id: r.id,
      client_name: r.client_name,
      repo_url: r.repo_url,
      local_path: r.local_path,
      branch: r.branch,
    })),
    queued: [],
    created_count: 0,
    skipped_duplicates: 0,
    downstream_outcomes: null,
  };

  if (!repos.length) {
    report.warning = "No Roblox target repos found in managed_repos";
    const paths = writeReport(report);
    console.log(JSON.stringify({ ...report, ...paths }, null, 2));
    return;
  }

  for (const repo of repos) {
    const tasks = await queueForRepo(repo, dryRun);
    report.queued.push({ repo: repo.client_name, tasks });
    for (const t of tasks) {
      if (t.created) report.created_count += 1;
      else report.skipped_duplicates += 1;
    }
  }

  const downstream = await collectDownstreamOutcomes(repos.map((r) => r.client_name));
  report.downstream_outcomes = downstream;
  const oc = downstream.summary.opencode_controller || {};
  const sa = downstream.summary.site_audit || {};
  report.opencode_total = oc.total || 0;
  report.opencode_completed = (oc.completed || 0) + (oc.success || 0);
  report.opencode_failed = (oc.failed || 0) + (oc.dead_letter || 0);
  report.site_audit_total = sa.total || 0;
  report.site_audit_completed = (sa.completed || 0) + (sa.success || 0);
  report.site_audit_failed = (sa.failed || 0) + (sa.dead_letter || 0);
  report.downstream_latest_failures = downstream.latest_failures.length;

  const paths = writeReport(report);
  console.log(JSON.stringify({
    ok: true,
    dry_run: dryRun,
    repos: repos.map((r) => r.client_name),
    created_count: report.created_count,
    skipped_duplicates: report.skipped_duplicates,
    opencode_completed: report.opencode_completed,
    opencode_failed: report.opencode_failed,
    site_audit_completed: report.site_audit_completed,
    site_audit_failed: report.site_audit_failed,
    downstream_latest_failures: report.downstream_latest_failures,
    report: paths,
  }, null, 2));
}

main()
  .catch((err) => {
    console.error("[roblox-game-growth-pulse] fatal:", err.message);
    process.exit(1);
  })
  .finally(async () => {
    await pg.end().catch(() => {});
  });
