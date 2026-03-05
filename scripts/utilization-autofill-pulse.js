#!/usr/bin/env node
"use strict";

const path = require("path");
const { v4: uuidv4 } = require("uuid");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const pg = require("../infra/postgres");
const { isKnownTaskType, resolveRouting } = require("../config/task-routing");
const { validatePayload } = require("../schemas/payloads");
const { buildTaskIdempotencyKey } = require("../control/idempotency");

const MIN_PENDING_TARGET = Math.max(
  4,
  Number.parseInt(String(process.env.UTIL_AUTOFILL_MIN_PENDING || "12"), 10) || 12
);
const MAX_ENQUEUE_PER_RUN = Math.max(
  2,
  Number.parseInt(String(process.env.UTIL_AUTOFILL_MAX_ENQUEUE_PER_RUN || "20"), 10) || 20
);
const REPO_LIMIT = Math.max(
  4,
  Number.parseInt(String(process.env.UTIL_AUTOFILL_REPO_LIMIT || "8"), 10) || 8
);

const SITE_COMPARE_PATTERNS = (process.env.UTIL_AUTOFILL_PATTERNS || "auth,betterauth,multi_tenant,stripe,telnyx,maileroo,mailersend,email_flows,billing")
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
  if (!isKnownTaskType(type)) throw new Error(`Unknown task type: ${type}`);
  validatePayload(type, payload || {});
  await ensureRoutingColumns();

  const idempotencyKey = buildTaskIdempotencyKey(type, payload || {});
  if (await taskExists(idempotencyKey)) {
    return { created: false, reason: "duplicate_active", idempotencyKey };
  }

  const id = uuidv4();
  const routing = resolveRouting(type);
  await pg.query(
    `INSERT INTO tasks (id, type, payload, status, worker_queue, required_tags, idempotency_key)
     VALUES ($1,$2,$3,'CREATED',$4,$5,$6)`,
    [id, type, payload || {}, routing.queue, routing.required_tags, idempotencyKey]
  );
  return { created: true, id, idempotencyKey };
}

async function getQueueStats() {
  const { rows } = await pg.query(
    `SELECT
       COUNT(*) FILTER (WHERE status='CREATED')::int AS created,
       COUNT(*) FILTER (WHERE status='DISPATCHED')::int AS dispatched,
       COUNT(*) FILTER (WHERE status='RUNNING')::int AS running,
       COUNT(*) FILTER (WHERE status='RETRY')::int AS retrying,
       COUNT(*) FILTER (WHERE status='PENDING_APPROVAL')::int AS pending_approval
     FROM tasks`
  );
  const r = rows[0] || {};
  return {
    created: Number(r.created || 0),
    dispatched: Number(r.dispatched || 0),
    running: Number(r.running || 0),
    retrying: Number(r.retrying || 0),
    pending_approval: Number(r.pending_approval || 0),
  };
}

async function getActiveWorkers() {
  const { rows } = await pg.query(
    `SELECT
       COUNT(*) FILTER (WHERE status IN ('ready','busy') AND NOW()-last_heartbeat <= INTERVAL '90 seconds')::int AS active_workers,
       COUNT(*) FILTER (WHERE status IN ('ready','busy') AND NOW()-last_heartbeat <= INTERVAL '90 seconds'
          AND COALESCE(capabilities->>'node_role','')='ai_worker')::int AS active_ai,
       COUNT(*) FILTER (WHERE status IN ('ready','busy') AND NOW()-last_heartbeat <= INTERVAL '90 seconds'
          AND COALESCE(capabilities->>'node_role','')='nas_worker')::int AS active_nas
     FROM device_registry`
  );
  const r = rows[0] || {};
  return {
    active_workers: Number(r.active_workers || 0),
    active_ai: Number(r.active_ai || 0),
    active_nas: Number(r.active_nas || 0),
  };
}

async function getTargetRepos(limit) {
  const runRes = await pg.query(
    `SELECT id
       FROM github_repo_scan_runs
      WHERE status='completed'
      ORDER BY finished_at DESC NULLS LAST, started_at DESC
      LIMIT 1`
  );
  const runId = runRes.rows[0]?.id;
  if (!runId) return [];

  const { rows } = await pg.query(
    `SELECT repo_name
       FROM github_repo_stack_facts
      WHERE run_id=$1
      ORDER BY COALESCE(stack_health_score, 0) ASC, repo_name ASC
      LIMIT $2`,
    [runId, limit]
  );
  return rows.map((r) => r.repo_name).filter(Boolean);
}

async function buildCatalog() {
  const windowKey = new Date().toISOString().slice(0, 16); // minute bucket
  const repos = await getTargetRepos(REPO_LIMIT);
  const jobs = [];

  jobs.push({ type: "github_observability_scan", payload: { autofill_window: windowKey } });
  jobs.push({ type: "security_sweep", payload: { autofill_window: windowKey } });
  jobs.push({ type: "research_sync", payload: { autofill_window: windowKey } });
  jobs.push({ type: "research_signals", payload: { autofill_window: windowKey } });
  jobs.push({ type: "loyalty_process_webhooks", payload: { autofill_window: windowKey } });
  jobs.push({ type: "loyalty_send_outreach", payload: { autofill_window: windowKey } });

  for (const p of SITE_COMPARE_PATTERNS) {
    jobs.push({ type: "site_compare", payload: { pattern: p, autofill_window: windowKey } });
  }
  for (const repo of repos) {
    jobs.push({ type: "site_audit", payload: { repo, autofill_window: windowKey } });
    jobs.push({ type: "site_fix_plan", payload: { repo, autofill_window: windowKey } });
  }

  return jobs;
}

async function main() {
  const queue = await getQueueStats();
  const workers = await getActiveWorkers();
  const activeBacklog = queue.created + queue.dispatched + queue.running + queue.retrying;

  const dynamicTarget = Math.max(
    MIN_PENDING_TARGET,
    workers.active_workers * 3
  );
  const deficit = Math.max(0, dynamicTarget - activeBacklog);
  const enqueueBudget = Math.min(MAX_ENQUEUE_PER_RUN, deficit);

  console.log(
    `[utilization-autofill] queue created=${queue.created} dispatched=${queue.dispatched} running=${queue.running} retrying=${queue.retrying} target=${dynamicTarget} deficit=${deficit}`
  );

  if (enqueueBudget <= 0) {
    console.log("[utilization-autofill] queue healthy; no autofill needed");
    return;
  }

  const catalog = await buildCatalog();
  let queued = 0;
  let dupes = 0;
  let errors = 0;

  for (const job of catalog) {
    if (queued >= enqueueBudget) break;
    try {
      const res = await createTaskIfNeeded(job.type, job.payload);
      if (res.created) {
        queued += 1;
        console.log(`[utilization-autofill] queued ${job.type} ${JSON.stringify(job.payload)}`);
      } else {
        dupes += 1;
      }
    } catch (err) {
      errors += 1;
      console.error(`[utilization-autofill] failed ${job.type}: ${err.message}`);
    }
  }

  console.log(
    `[utilization-autofill] done queued=${queued} dupes=${dupes} errors=${errors} budget=${enqueueBudget}`
  );
}

main()
  .catch((err) => {
    console.error("[utilization-autofill] fatal:", err.message);
    process.exit(1);
  })
  .finally(async () => {
    await pg.end().catch(() => {});
  });
