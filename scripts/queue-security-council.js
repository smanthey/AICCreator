#!/usr/bin/env node
"use strict";

/**
 * queue-security-council.js
 *
 * Run by PM2 cron at 3:30 AM nightly (cron_restart: "30 3 * * *").
 * Inserts a security_council task into PostgreSQL so the dispatcher
 * picks it up and runs it through the full agent pipeline.
 *
 * Model routing: ollama → deepseek → gemini → openai → anthropic
 * (configured in config/model-routing-policy.json)
 *
 * This script exits immediately after inserting the task — the actual
 * work is done by the worker that picks it up from the queue.
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const crypto = require("crypto");
const pg = require("../infra/postgres");
const { isKnownTaskType, resolveRouting } = require("../config/task-routing");
const { buildTaskIdempotencyKey } = require("../control/idempotency");

const TASK_TYPE = "security_council";

async function main() {
  if (!isKnownTaskType(TASK_TYPE)) {
    console.error(`[queue-security-council] FATAL: "${TASK_TYPE}" not in task-routing. Add it first.`);
    process.exit(1);
  }

  const routing = resolveRouting(TASK_TYPE);

  // Idempotency key: one per calendar day (UTC) so re-runs are safe.
  const dayBucket = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
  const idempotencyKey = buildTaskIdempotencyKey(TASK_TYPE, { day: dayBucket });

  // Skip if a task for today already exists in an active state.
  const { rows: existing } = await pg.query(
    `SELECT id, status, created_at
       FROM tasks
      WHERE idempotency_key = $1
        AND status IN ('CREATED', 'PENDING', 'DISPATCHED', 'RUNNING', 'RETRY', 'PENDING_APPROVAL')
      LIMIT 1`,
    [idempotencyKey]
  );

  if (existing.length > 0) {
    const row = existing[0];
    console.log(
      `[queue-security-council] already queued — id=${row.id} status=${row.status} created=${row.created_at.toISOString()}`
    );
    await pg.end();
    return;
  }

  const taskId = crypto.randomUUID();
  const payload = {
    triggered_by: "nightly-cron",
    day: dayBucket,
    max_files: Number(process.env.SECURITY_COUNCIL_MAX_FILES || "80") || 80,
    dry_run: String(process.env.SECURITY_COUNCIL_DRY_RUN || "false").toLowerCase() === "true",
  };

  await pg.query(
    `INSERT INTO tasks (id, type, payload, status, priority, worker_queue, required_tags, idempotency_key, title)
     VALUES ($1, $2, $3::jsonb, 'CREATED', $4, $5, $6::text[], $7, $8)`,
    [
      taskId,
      TASK_TYPE,
      JSON.stringify(payload),
      5, // priority 5 — nightly, non-urgent; bumped to 8 if triggered manually
      routing.queue,
      routing.required_tags,
      idempotencyKey,
      `Security Council — ${dayBucket}`,
    ]
  );

  console.log(`[queue-security-council] queued — id=${taskId} queue=${routing.queue} day=${dayBucket}`);
  await pg.end();
}

main().catch((err) => {
  console.error("[queue-security-council] fatal:", err.message);
  process.exit(1);
});
