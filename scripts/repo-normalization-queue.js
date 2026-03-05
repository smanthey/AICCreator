#!/usr/bin/env node
"use strict";

require("dotenv").config();

const { v4: uuidv4 } = require("uuid");
const pg = require("../infra/postgres");
const { resolveRouting } = require("../config/task-routing");
const { validatePayload } = require("../schemas/payloads");
const { buildTaskIdempotencyKey } = require("../control/idempotency");

const args = process.argv.slice(2);
const getArg = (flag, fallback = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};
const LIMIT = Math.max(1, Number(getArg("--limit", "10")) || 10);

async function taskExists(idempotencyKey) {
  const { rows } = await pg.query(
    `SELECT 1
       FROM tasks
      WHERE idempotency_key = $1
        AND status IN ('CREATED','DISPATCHED','RUNNING','RETRY','PENDING_APPROVAL','DEAD_LETTER')
      LIMIT 1`,
    [idempotencyKey]
  );
  return rows.length > 0;
}

async function queueRepoAutofix(repo, reason, checksFailed) {
  const payload = {
    repo,
    source: "repo_normalization_queue",
    reason,
    checks_failed: checksFailed,
    pulse_hour: new Date().toISOString().slice(0, 13),
  };
  validatePayload("repo_autofix", payload);
  const idempotencyKey = buildTaskIdempotencyKey("repo_autofix", payload);
  if (await taskExists(idempotencyKey)) return { created: false, reason: "duplicate_active" };
  const routing = resolveRouting("repo_autofix");
  const id = uuidv4();
  await pg.query(
    `INSERT INTO tasks (id, type, payload, status, worker_queue, required_tags, idempotency_key)
     VALUES ($1,$2,$3::jsonb,'CREATED',$4,$5,$6)`,
    [id, "repo_autofix", JSON.stringify(payload), routing.queue, routing.required_tags, idempotencyKey]
  );
  return { created: true, id };
}

async function main() {
  const { rows: runRows } = await pg.query(
    `SELECT id
     FROM github_repo_scan_runs
     WHERE status='completed'
     ORDER BY finished_at DESC NULLS LAST
     LIMIT 1`
  );
  if (!runRows[0]) throw new Error("no_completed_scan_run");
  const runId = runRows[0].id;

  const { rows } = await pg.query(
    `SELECT repo_name,
            ARRAY_AGG(DISTINCT code) AS codes
     FROM github_repo_violations
     WHERE run_id = $1
       AND code IN ('AUTH_NOT_STANDARDIZED','MULTI_TENANT_BASELINE_MISSING')
     GROUP BY repo_name
     ORDER BY repo_name ASC
     LIMIT $2`,
    [runId, LIMIT]
  );

  let created = 0;
  let skipped = 0;
  for (const row of rows) {
    const codes = Array.isArray(row.codes) ? row.codes : [];
    const res = await queueRepoAutofix(
      row.repo_name,
      `normalize baseline: ${codes.join(", ")}`,
      ["auth", "betterauth", "multi_tenant"]
    );
    if (res.created) created += 1;
    else skipped += 1;
  }

  console.log("\n=== Repo Normalization Queue ===\n");
  console.log(`run_id:   ${runId}`);
  console.log(`repos:    ${rows.length}`);
  console.log(`created:  ${created}`);
  console.log(`skipped:  ${skipped}`);
}

main()
  .then(async () => { await pg.end(); })
  .catch(async (err) => {
    console.error("Fatal:", err.message);
    try { await pg.end(); } catch {}
    process.exit(1);
  });

