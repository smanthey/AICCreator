#!/usr/bin/env node
"use strict";

const path = require("path");
const { v4: uuidv4 } = require("uuid");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const pg = require("../infra/postgres");
const { resolveRouting, isKnownTaskType } = require("../config/task-routing");
const { validatePayload } = require("../schemas/payloads");
const { buildTaskIdempotencyKey } = require("../control/idempotency");

function intEnv(name, fallback) {
  const n = Number.parseInt(String(process.env[name] || ""), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const LOW_HEALTH_THRESHOLD = Number(process.env.GIT_SUBAGENT_LOW_HEALTH_THRESHOLD || 80);
const LOW_HEALTH_LIMIT = intEnv("GIT_SUBAGENT_LOW_HEALTH_LIMIT", 6);
const ALWAYS_SAMPLE = String(process.env.GIT_SUBAGENT_ALWAYS_SAMPLE || "true").toLowerCase() === "true";
const SAMPLE_LIMIT = intEnv("GIT_SUBAGENT_SAMPLE_LIMIT", LOW_HEALTH_LIMIT);
const PINNED_REPOS = (process.env.GIT_SUBAGENT_REPOS || "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);
const INCLUDE_PATTERNS = (process.env.GIT_SUBAGENT_PATTERNS || "auth,betterauth,multi_tenant,stripe,telnyx,maileroo,mailersend,email_flows,billing")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);

const ACTIVE_STATUSES = ["CREATED", "DISPATCHED", "RUNNING", "RETRY", "PENDING_APPROVAL"];

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
    [idempotencyKey, ACTIVE_STATUSES]
  );
  return rows.length > 0;
}

async function createTaskIfNeeded(type, payload) {
  if (!isKnownTaskType(type)) {
    throw new Error(`Unknown task type: ${type}`);
  }
  validatePayload(type, payload);
  await ensureRoutingColumns();

  const idempotencyKey = buildTaskIdempotencyKey(type, payload);
  if (await taskExists(idempotencyKey)) {
    return { created: false, reason: "duplicate_active", idempotencyKey };
  }

  const id = uuidv4();
  const routing = resolveRouting(type);
  await pg.query(
    `INSERT INTO tasks (id, type, payload, status, worker_queue, required_tags, idempotency_key)
     VALUES ($1, $2, $3, 'CREATED', $4, $5, $6)`,
    [id, type, payload || {}, routing.queue, routing.required_tags, idempotencyKey]
  );
  return { created: true, id, idempotencyKey };
}

async function getLatestCompletedRunId() {
  const { rows } = await pg.query(
    `SELECT id
       FROM github_repo_scan_runs
      WHERE status = 'completed'
      ORDER BY finished_at DESC NULLS LAST, started_at DESC
      LIMIT 1`
  );
  return rows[0]?.id || null;
}

async function getLowHealthRepos(runId, limit, threshold) {
  const { rows } = await pg.query(
    `SELECT repo_name, COALESCE(stack_health_score, 0) AS stack_health_score
       FROM github_repo_stack_facts
      WHERE run_id = $1
        AND COALESCE(stack_health_score, 0) < $2
      ORDER BY COALESCE(stack_health_score, 0) ASC, repo_name ASC
      LIMIT $3`,
    [runId, threshold, limit]
  );
  return rows;
}

async function getSampleRepos(runId, limit) {
  const { rows } = await pg.query(
    `SELECT repo_name, COALESCE(stack_health_score, 0) AS stack_health_score
       FROM github_repo_stack_facts
      WHERE run_id = $1
      ORDER BY COALESCE(stack_health_score, 0) ASC, repo_name ASC
      LIMIT $2`,
    [runId, limit]
  );
  return rows;
}

async function main() {
  console.log("[git-sites-subagent-pulse] start");
  const summary = {
    queued: 0,
    skipped_duplicates: 0,
    repos_considered: 0,
    run_id: null,
  };

  const runId = await getLatestCompletedRunId();
  summary.run_id = runId;
  if (!runId) {
    console.log("[git-sites-subagent-pulse] no completed github scan run found; skipping");
    return;
  }

  const lowHealthRepos = await getLowHealthRepos(runId, LOW_HEALTH_LIMIT, LOW_HEALTH_THRESHOLD);
  const selected = new Map();

  for (const repo of lowHealthRepos) {
    if (repo && repo.repo_name) selected.set(repo.repo_name, repo);
  }
  if (ALWAYS_SAMPLE) {
    const sampled = await getSampleRepos(runId, SAMPLE_LIMIT);
    for (const repo of sampled) {
      if (repo && repo.repo_name) selected.set(repo.repo_name, repo);
    }
  }
  for (const repoName of PINNED_REPOS) {
    if (!selected.has(repoName)) selected.set(repoName, { repo_name: repoName, stack_health_score: null });
  }

  const reposToWork = Array.from(selected.values());
  summary.repos_considered = reposToWork.length;
  console.log(
    `[git-sites-subagent-pulse] run_id=${runId} low_health_count=${lowHealthRepos.length} repos_to_work=${reposToWork.length} threshold=${LOW_HEALTH_THRESHOLD}`
  );

  const jobs = [];
  for (const repo of reposToWork) {
    jobs.push({
      type: "opencode_controller",
      payload: {
        repo: repo.repo_name,
        objective: "Implement and harden coding fixes using OpenCode executor loop",
        source: "git_sites_subagent_pulse",
        max_iterations: 2,
        quality_target: 90,
        auto_iterate: true,
      },
    });
    jobs.push({ type: "site_audit", payload: { repo: repo.repo_name } });
    jobs.push({ type: "site_fix_plan", payload: { repo: repo.repo_name } });
  }
  for (const pattern of INCLUDE_PATTERNS) {
    jobs.push({ type: "site_compare", payload: { pattern } });
  }

  for (const job of jobs) {
    try {
      const res = await createTaskIfNeeded(job.type, job.payload);
      if (res.created) {
        summary.queued += 1;
        console.log(`[git-sites-subagent-pulse] queued ${job.type} ${JSON.stringify(job.payload)}`);
      } else {
        summary.skipped_duplicates += 1;
      }
    } catch (err) {
      console.error(
        `[git-sites-subagent-pulse] failed ${job.type} payload=${JSON.stringify(job.payload)} err=${err.message}`
      );
    }
  }

  console.log(
    `[git-sites-subagent-pulse] done queued=${summary.queued} skipped_duplicates=${summary.skipped_duplicates} repos_considered=${summary.repos_considered}`
  );
}

main()
  .catch((err) => {
    console.error("[git-sites-subagent-pulse] fatal:", err.message);
    process.exit(1);
  })
  .finally(async () => {
    await pg.end().catch(() => {});
  });
