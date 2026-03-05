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
  const limit = Math.max(1, Math.min(5000, Number(getArg("--limit", "300")) || 300));
  const hostname = getArg("--hostname", null);
  const payload = {
    limit,
    force: hasFlag("--force"),
    dry_run: hasFlag("--dry-run"),
  };
  if (hostname) payload.hostname = hostname;
  if (hasFlag("--use-openai-vision")) payload.use_openai_vision = true;
  return payload;
}

async function main() {
  const payload = parsePayload();
  validatePayload("media_visual_catalog", payload);

  const routing = resolveRouting("media_visual_catalog");
  const idempotencyKey = buildTaskIdempotencyKey("media_visual_catalog", payload);
  const taskId = uuidv4();

  await pg.query(
    `INSERT INTO tasks (id, type, payload, status, priority, title, worker_queue, required_tags, idempotency_key)
     VALUES ($1, 'media_visual_catalog', $2::jsonb, 'CREATED', 4, 'media visual catalog', $3, $4, $5)`,
    [taskId, JSON.stringify(payload), routing.queue, routing.required_tags, idempotencyKey]
  );

  await pg.query(`SELECT pg_notify('task_created', 'single_task')`).catch(() => {});

  console.log("\n✅ media_visual_catalog task queued");
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
    console.error(`[media-visual-catalog] fatal: ${err.message}`);
    try { await pg.end(); } catch {}
    process.exit(1);
  });
