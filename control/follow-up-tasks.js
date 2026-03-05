"use strict";

const { v4: uuid } = require("uuid");
const pg = require("../infra/postgres");
const { validatePayload } = require("../schemas/payloads");
const { resolveRouting, isKnownTaskType } = require("../config/task-routing");
const { buildTaskIdempotencyKey } = require("./idempotency");

// Task types that may not be spawned as follow-ups (safety).
const FOLLOW_UP_DISALLOWED_TYPES = new Set(["orchestrate", "migrate"]);
const MAX_FOLLOW_UP_TASKS = 50;

/**
 * Insert follow-up tasks spawned by a completed handler (subagent / minor upgrades).
 * Each task depends on parentTaskId and is CREATED so the dispatcher picks it up.
 *
 * @param {string} planId - Plan to attach tasks to
 * @param {string} parentTaskId - Parent task UUID (each follow-up depends_on this)
 * @param {Array<{ type: string, payload: object, title?: string }>} tasks - Follow-up task specs
 * @returns {Promise<{ inserted: number, taskIds: string[], skipped: number }>}
 */
async function insertFollowUpTasks(planId, parentTaskId, tasks) {
  if (!planId || typeof planId !== "string" || !parentTaskId || typeof parentTaskId !== "string") {
    return { inserted: 0, taskIds: [], skipped: 0 };
  }
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return { inserted: 0, taskIds: [], skipped: 0 };
  }

  const toInsert = tasks.slice(0, MAX_FOLLOW_UP_TASKS);
  if (tasks.length > MAX_FOLLOW_UP_TASKS) {
    console.warn(`[follow-up] Capped at ${MAX_FOLLOW_UP_TASKS} (got ${tasks.length})`);
  }

  const { rows: parentRows } = await pg.query(
    `SELECT depth FROM tasks WHERE id = $1`,
    [parentTaskId]
  );
  const parentDepth = parentRows[0]?.depth ?? 0;
  const nextDepth = parentDepth + 1;

  const { rows: seqRows } = await pg.query(
    `SELECT COALESCE(MAX(sequence), 0)::int AS max_seq FROM tasks WHERE plan_id = $1`,
    [planId]
  );
  let nextSequence = (seqRows[0]?.max_seq ?? 0) + 1;

  const insertedIds = [];
  let skipped = 0;

  for (const t of toInsert) {
    if (!t || typeof t !== "object" || Array.isArray(t)) {
      skipped++;
      continue;
    }
    const type = String(t.type != null ? t.type : "").trim();
    if (!type || !isKnownTaskType(type)) {
      console.warn(`[follow-up] Skipping unknown task type "${type}"`);
      skipped++;
      continue;
    }
    if (FOLLOW_UP_DISALLOWED_TYPES.has(type)) {
      console.warn(`[follow-up] Skipping disallowed type "${type}"`);
      skipped++;
      continue;
    }

    const payload = t.payload != null && typeof t.payload === "object" && !Array.isArray(t.payload) ? t.payload : {};
    try {
      validatePayload(type, payload);
    } catch (err) {
      console.warn(`[follow-up] Payload validation failed for ${type}: ${err.message}`);
      skipped++;
      continue;
    }

    const id = uuid();
    const routing = resolveRouting(type);
    const workerQueue = routing.queue || "claw_tasks";
    const requiredTags = routing.required_tags || [];
    const idempotencyKey = buildTaskIdempotencyKey(type, { ...payload, _parent: parentTaskId });

    await pg.query(
      `INSERT INTO tasks (
        id, type, payload, status, priority,
        plan_id, parent_task_id, depends_on, depth, sequence, title,
        max_retries, backoff_ms, worker_queue, required_tags, idempotency_key
      ) VALUES (
        $1, $2, $3, 'CREATED', $4,
        $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15
      )`,
      [
        id,
        type,
        JSON.stringify(payload),
        3,
        planId,
        parentTaskId,
        [parentTaskId],
        nextDepth,
        nextSequence,
        t.title || type,
        3,
        5000,
        workerQueue,
        requiredTags,
        idempotencyKey,
      ]
    );

    insertedIds.push(id);
    nextSequence += 1;
    console.log(`[follow-up] ◉ ${type}:${id.slice(0, 8)} "${t.title || type}" (plan ${planId.slice(0, 8)})`);
  }

  if (insertedIds.length > 0) {
    await pg.query(`SELECT pg_notify('task_created', $1)`, [planId]).catch(() => {});
  }

  return { inserted: insertedIds.length, taskIds: insertedIds, skipped };
}

module.exports = { insertFollowUpTasks };
