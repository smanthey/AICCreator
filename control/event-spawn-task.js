"use strict";

/**
 * Create a single task from an event (no plan). Used by the spawner consumer.
 * Task is CREATED so the dispatcher picks it up; pg_notify wakes dispatcher.
 */

const { v4: uuid } = require("uuid");
const pg = require("../infra/postgres");
const { resolveRouting, isKnownTaskType } = require("../config/task-routing");
const { buildTaskIdempotencyKey } = require("./idempotency");

let _routingColsEnsured = false;
async function ensureRoutingColumns() {
  if (_routingColsEnsured) return;
  await pg.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS required_tags TEXT[] DEFAULT '{}'`);
  await pg.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS idempotency_key TEXT`);
  _routingColsEnsured = true;
}

/**
 * Insert one task from an event. plan_id and parent_task_id are null.
 * @param {string} type - Task type (must be in task-routing)
 * @param {object} payload - Task payload
 * @param {number} priority - Priority 1-5
 * @param {string} idempotencyKey - Idempotency key for this event/task
 * @returns {Promise<{ taskId: string }>}
 */
async function createTaskFromEvent(type, payload, priority = 3, idempotencyKey) {
  if (!isKnownTaskType(type)) {
    throw new Error(`Unknown task type: ${type}`);
  }
  await ensureRoutingColumns();
  const id = uuid();
  const routing = resolveRouting(type);
  const workerQueue = routing.queue || "claw_tasks";
  const requiredTags = routing.required_tags || [];
  const key = idempotencyKey || buildTaskIdempotencyKey(type, payload || {});

  await pg.query(
    `INSERT INTO tasks (
      id, type, payload, status, priority,
      plan_id, parent_task_id, depends_on, depth, sequence, title,
      max_retries, backoff_ms, worker_queue, required_tags, idempotency_key
    ) VALUES (
      $1, $2, $3::jsonb, 'CREATED', $4,
      NULL, NULL, '{}', 0, 0, $5,
      3, 5000, $6, $7, $8
    )`,
    [
      id,
      type,
      JSON.stringify(payload || {}),
      Math.max(1, Math.min(5, priority)),
      type,
      workerQueue,
      requiredTags,
      key,
    ]
  );

  await pg.query(`SELECT pg_notify('task_created', $1)`, [id]).catch(() => {});
  return { taskId: id };
}

module.exports = { createTaskFromEvent };
