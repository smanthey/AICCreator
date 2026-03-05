// control/retry.js
// Retry + Dead Letter + Cascade Skip logic
//
// Usage:
//   const retry = require("./retry");
//   const outcome = await retry.handleFailure(taskId, error);
//   // outcome is "RETRY" or "DEAD_LETTER"

const pg       = require("../infra/postgres");
const notifier = require("./notifier");
const { DLQ_REASON, deadLetterTask } = require("./dlq");

// ─── Config ──────────────────────────────────────────────────────
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BACKOFF_MS = 5000;     // 5 seconds initial
const MAX_BACKOFF_MS = 60000;        // 60 seconds cap
const BACKOFF_MULTIPLIER = 2;        // exponential: 5s → 10s → 20s → 40s → 60s cap

/**
 * Schedule an existing task for retry at a specific time.
 *
 * @param {string} taskId
 * @param {object} options
 * @param {number} options.retryCount
 * @param {string} options.errorMessage
 * @param {Date|string} options.retryAt
 * @param {number} options.nextBackoffMs
 * @returns {Promise<boolean>}
 */
async function rescheduleRetryTask(taskId, options = {}) {
  const retryAt = options.retryAt instanceof Date
    ? options.retryAt.toISOString()
    : new Date(options.retryAt || Date.now()).toISOString();
  const { rows } = await pg.query(
    `UPDATE tasks SET
      status = 'RETRY',
      retry_count = $2,
      last_error = $3,
      next_retry_at = $4,
      backoff_ms = $5
     WHERE id = $1
     RETURNING id`,
    [
      taskId,
      Number(options.retryCount || 0),
      String(options.errorMessage || "retry_scheduled"),
      retryAt,
      Number(options.nextBackoffMs || DEFAULT_BACKOFF_MS),
    ]
  );
  return rows.length > 0;
}

/**
 * Called when a task worker throws an error.
 * Decides: retry (with backoff) or dead-letter (exhausted).
 *
 * @param {string} taskId
 * @param {Error} error
 * @returns {Promise<"RETRY"|"DEAD_LETTER">}
 */
async function handleFailure(taskId, error) {
  const { rows } = await pg.query(
    `SELECT retry_count, max_retries, backoff_ms, type, plan_id, title
     FROM tasks WHERE id = $1`,
    [taskId]
  );

  if (rows.length === 0) {
    throw new Error(`[retry] Task not found: ${taskId}`);
  }

  const task = rows[0];
  const maxRetries = task.max_retries || DEFAULT_MAX_RETRIES;
  const currentBackoff = task.backoff_ms || DEFAULT_BACKOFF_MS;
  const nextRetryCount = (task.retry_count || 0) + 1;
  const rawMessage = error?.message || String(error);
  const errorMessage = `${DLQ_REASON.EXECUTION_ERROR}: ${rawMessage}`;

  // ─── DEAD LETTER: exhausted retries ────────────────────────
  if (nextRetryCount > maxRetries) {
    await deadLetterTask({
      taskId,
      reasonCode: DLQ_REASON.RETRY_LIMIT_EXCEEDED,
      message: errorMessage,
    });
    await cascadeSkip(taskId);
    await updatePlanStatus(task.plan_id);

    console.error(
      `[dead_letter] ☠ ${task.type}:${taskId} — "${task.title || "untitled"}" ` +
      `after ${maxRetries} retries: ${errorMessage}`
    );

    // Push Telegram notification — non-blocking
    notifier.notifyDeadLetter({
      id:          taskId,
      type:        task.type,
      title:       task.title,
      plan_id:     task.plan_id,
      last_error:  errorMessage,
      retry_count: maxRetries,
    }).catch(err => console.warn("[dead_letter] Notification failed:", err.message));

    return "DEAD_LETTER";
  }

  // ─── RETRY: exponential backoff with jitter (prevents thundering herd) ──
  const jitter      = 0.8 + Math.random() * 0.4;     // 0.8x–1.2x multiplier
  const nextBackoff = Math.round(Math.min(currentBackoff * BACKOFF_MULTIPLIER * jitter, MAX_BACKOFF_MS));
  const retryDelay  = Math.round(currentBackoff * jitter);
  const retryAt     = new Date(Date.now() + retryDelay);

  await rescheduleRetryTask(taskId, {
    retryCount: nextRetryCount,
    errorMessage,
    retryAt,
    nextBackoffMs: nextBackoff,
  });

  console.log(
    `[retry] ↻ ${task.type}:${taskId} — attempt ${nextRetryCount}/${maxRetries} ` +
    `in ${currentBackoff}ms (next backoff: ${nextBackoff}ms)`
  );

  return "RETRY";
}

/**
 * When a task dead-letters, SKIP all tasks that depend on it.
 * Cascades recursively through the entire dependency chain.
 */
async function cascadeSkip(failedTaskId) {
  const { rows: dependents } = await pg.query(
    `SELECT id, title, type FROM tasks
     WHERE $1 = ANY(depends_on)
       AND status IN ('PENDING', 'CREATED', 'QUEUED')`,
    [failedTaskId]
  );

  for (const dep of dependents) {
    await pg.query(
      `UPDATE tasks SET
        status = 'SKIPPED',
        last_error = $2
       WHERE id = $1`,
      [dep.id, `Skipped: dependency ${failedTaskId} failed`]
    );

    console.log(`[cascade_skip] ⊘ ${dep.type}:${dep.id} — "${dep.title || "untitled"}"`);

    // Recursively skip anything downstream of this task
    await cascadeSkip(dep.id);
  }
}

/**
 * Called by dispatcher on a timer.
 * Picks up tasks in RETRY state whose next_retry_at has passed,
 * moves them back to CREATED so the normal dispatch loop picks them up.
 *
 * @returns {Promise<number>} number of tasks re-queued
 */
async function processRetryQueue() {
  const { rows } = await pg.query(
    `UPDATE tasks SET
      status = 'CREATED',
      next_retry_at = NULL
     WHERE status = 'RETRY'
       AND next_retry_at <= NOW()
       AND NOT EXISTS (
         SELECT 1
         FROM task_quarantine tq
         WHERE tq.task_id = tasks.id
           AND tq.active = TRUE
       )
     RETURNING id, type, retry_count`
  );

  if (rows.length > 0) {
    for (const row of rows) {
      console.log(`[retry_queue] ↻ Re-queued ${row.type}:${row.id} (attempt ${row.retry_count})`);
    }
  }

  return rows.length;
}

/**
 * Update plan completion counters and status.
 */
async function updatePlanStatus(planId) {
  if (!planId) return;

  await pg.query(
    `UPDATE plans SET
      completed_tasks = (
        SELECT COUNT(*) FROM tasks WHERE plan_id = $1 AND status = 'COMPLETED'
      ),
      failed_tasks = (
        SELECT COUNT(*) FROM tasks WHERE plan_id = $1
          AND status IN ('DEAD_LETTER', 'SKIPPED', 'FAILED')
      ),
      actual_cost_usd = (
        SELECT COALESCE(SUM(cost_usd), 0) FROM tasks WHERE plan_id = $1
      ),
      status = CASE
        WHEN (SELECT COUNT(*) FROM tasks WHERE plan_id = $1
              AND status IN ('PENDING', 'CREATED', 'QUEUED', 'DISPATCHED', 'RUNNING', 'RETRY')) = 0
        THEN CASE
          WHEN (SELECT COUNT(*) FROM tasks WHERE plan_id = $1
                AND status IN ('DEAD_LETTER', 'FAILED')) > 0
          THEN 'failed'
          ELSE 'completed'
        END
        ELSE 'active'
      END,
      completed_at = CASE
        WHEN (SELECT COUNT(*) FROM tasks WHERE plan_id = $1
              AND status IN ('PENDING', 'CREATED', 'QUEUED', 'DISPATCHED', 'RUNNING', 'RETRY')) = 0
        THEN NOW()
        ELSE NULL
      END
     WHERE id = $1`,
    [planId]
  );
}

module.exports = {
  handleFailure,
  rescheduleRetryTask,
  processRetryQueue,
  updatePlanStatus,
  cascadeSkip,
  DEFAULT_MAX_RETRIES,
  DEFAULT_BACKOFF_MS
};
