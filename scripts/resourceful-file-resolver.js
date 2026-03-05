#!/usr/bin/env node
"use strict";

require("dotenv").config();

const { v4: uuidv4 } = require("uuid");
const pg = require("../infra/postgres");
const { validatePayload } = require("../schemas/payloads");
const { resolveRouting } = require("../config/task-routing");
const { buildTaskIdempotencyKey } = require("../control/idempotency");

const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const getArg = (flag, fallback = null) => {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
};

function parsePayload() {
  const payload = {
    limit: Math.max(1, Math.min(5000, Number(getArg("--limit", "600")) || 600)),
    force: hasFlag("--force"),
    dry_run: hasFlag("--dry-run"),
  };
  const hostname = getArg("--hostname", null);
  const pathPrefix = getArg("--path-prefix", null);
  if (hostname) payload.hostname = hostname;
  if (pathPrefix) payload.path_prefix = pathPrefix;
  return payload;
}

async function main() {
  const payload = parsePayload();
  validatePayload("resourceful_file_resolve", payload);

  const routing = resolveRouting("resourceful_file_resolve");
  const idempotencyKey = buildTaskIdempotencyKey("resourceful_file_resolve", payload);
  const taskId = uuidv4();

  await pg.query(
    `INSERT INTO tasks (id, type, payload, status, priority, title, worker_queue, required_tags, idempotency_key)
     VALUES ($1, 'resourceful_file_resolve', $2::jsonb, 'CREATED', 5, 'resourceful file resolver', $3, $4, $5)`,
    [taskId, JSON.stringify(payload), routing.queue, routing.required_tags, idempotencyKey]
  );

  await pg.query(`SELECT pg_notify('task_created', 'single_task')`).catch(() => {});

  console.log("\n✅ resourceful_file_resolve task queued");
  console.log(`task_id: ${taskId}`);
  console.log(`queue: ${routing.queue}`);
  console.log(`required_tags: [${(routing.required_tags || []).join(", ")}]`);
  console.log(`idempotency_key: ${idempotencyKey}`);
  console.log(`payload: ${JSON.stringify(payload)}`);
}

main()
  .then(async () => {
    await pg.end();
  })
  .catch(async (err) => {
    console.error(`[resourceful-file-resolver] fatal: ${err.message}`);
    try { await pg.end(); } catch {}
    process.exit(1);
  });

