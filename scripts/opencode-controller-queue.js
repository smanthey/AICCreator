#!/usr/bin/env node
"use strict";

require("dotenv").config();

const { v4: uuidv4 } = require("uuid");
const pg = require("../infra/postgres");
const { resolveRouting, isKnownTaskType } = require("../config/task-routing");
const { validatePayload } = require("../schemas/payloads");
const { buildTaskIdempotencyKey } = require("../control/idempotency");

const ACTIVE_STATUSES = ["CREATED", "DISPATCHED", "RUNNING", "RETRY", "PENDING_APPROVAL"];

function arg(flag, fallback = null) {
  const args = process.argv.slice(2);
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
}

async function ensureRoutingColumns() {
  await pg.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS required_tags TEXT[] DEFAULT '{}'`);
  await pg.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS idempotency_key TEXT`);
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

async function main() {
  const type = "opencode_controller";
  const repo = String(arg("--repo", "")).trim();
  const objective = String(arg("--objective", "Implement requested coding task")).trim();
  const source = String(arg("--source", "manual_opencode_controller")).trim();
  const maxIterations = Math.max(1, Number(arg("--max-iterations", "2")) || 2);
  const qualityTarget = Math.max(1, Number(arg("--quality-target", "90")) || 90);
  const autoIterate = String(arg("--auto-iterate", "true")).toLowerCase() !== "false";

  if (!repo) throw new Error("--repo is required");
  if (!isKnownTaskType(type)) throw new Error(`Unknown task type: ${type}`);

  const payload = {
    repo,
    objective,
    source,
    max_iterations: maxIterations,
    quality_target: qualityTarget,
    auto_iterate: autoIterate,
  };
  validatePayload(type, payload);
  await ensureRoutingColumns();

  const idempotencyKey = buildTaskIdempotencyKey(type, payload);
  if (await taskExists(idempotencyKey)) {
    console.log("=== OpenCode Controller Queue ===");
    console.log(`status: duplicate_active`);
    console.log(`repo: ${repo}`);
    console.log(`idempotency_key: ${idempotencyKey}`);
    return;
  }

  const routing = resolveRouting(type);
  const id = uuidv4();
  await pg.query(
    `INSERT INTO tasks (id, type, payload, status, worker_queue, required_tags, idempotency_key)
     VALUES ($1, $2, $3::jsonb, 'CREATED', $4, $5, $6)`,
    [id, type, JSON.stringify(payload), routing.queue, routing.required_tags, idempotencyKey]
  );
  await pg.query(`SELECT pg_notify('task_created', $1)`, [id]).catch(() => {});

  console.log("=== OpenCode Controller Queue ===");
  console.log(`status: queued`);
  console.log(`task_id: ${id}`);
  console.log(`repo: ${repo}`);
  console.log(`objective: ${objective}`);
  console.log(`max_iterations: ${maxIterations}`);
  console.log(`quality_target: ${qualityTarget}`);
}

main()
  .then(async () => {
    await pg.end();
  })
  .catch(async (err) => {
    console.error("Fatal:", err.message);
    try { await pg.end(); } catch {}
    process.exit(1);
  });
