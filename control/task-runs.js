"use strict";

const pg = require("../infra/postgres");

async function claimTaskRun({ taskId, idempotencyKey, workerId, timeoutSeconds = 900 }) {
  if (!idempotencyKey) {
    return { decision: "RUN" };
  }

  const client = await pg.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `SELECT id, status, result, started_at
       FROM task_runs
       WHERE idempotency_key = $1
       FOR UPDATE`,
      [idempotencyKey]
    );

    if (!rows.length) {
      await client.query(
        `INSERT INTO task_runs (task_id, idempotency_key, status, worker_id, started_at)
         VALUES ($1, $2, 'RUNNING', $3, NOW())`,
        [taskId, idempotencyKey, workerId]
      );
      await client.query("COMMIT");
      return { decision: "RUN" };
    }

    const existing = rows[0];
    if (existing.status === "COMPLETED") {
      await client.query("COMMIT");
      return { decision: "SKIP_COMPLETED", result: existing.result || null };
    }

    if (existing.status === "RUNNING") {
      const stale = await client.query(
        `SELECT NOW() - $1::timestamptz > ($2::int * INTERVAL '1 second') AS is_stale`,
        [existing.started_at, Math.max(60, Number(timeoutSeconds) || 900)]
      );
      if (!stale.rows[0]?.is_stale) {
        await client.query("COMMIT");
        return { decision: "SKIP_RUNNING" };
      }
    }

    await client.query(
      `UPDATE task_runs
       SET task_id = $2,
           status = 'RUNNING',
           worker_id = $3,
           started_at = NOW(),
           completed_at = NULL,
           result = NULL,
           error = NULL
       WHERE idempotency_key = $1`,
      [idempotencyKey, taskId, workerId]
    );

    await client.query("COMMIT");
    return { decision: "RUN" };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function completeTaskRun(idempotencyKey, result) {
  if (!idempotencyKey) return;
  await pg.query(
    `UPDATE task_runs
     SET status = 'COMPLETED',
         result = $2,
         completed_at = NOW(),
         error = NULL
     WHERE idempotency_key = $1`,
    [idempotencyKey, JSON.stringify(result || {})]
  );
}

async function failTaskRun(idempotencyKey, error) {
  if (!idempotencyKey) return;
  await pg.query(
    `UPDATE task_runs
     SET status = 'FAILED',
         error = LEFT($2, 2000),
         completed_at = NOW()
     WHERE idempotency_key = $1`,
    [idempotencyKey, String(error || "unknown error")]
  );
}

async function reconcileStaleTaskRuns({ staleSeconds = 1800 } = {}) {
  const threshold = Math.max(300, Number(staleSeconds) || 1800);

  const { rowCount } = await pg.query(
    `UPDATE task_runs tr
     SET status = 'FAILED',
         error = COALESCE(tr.error, 'stale task run reconciled'),
         completed_at = NOW()
     WHERE tr.status = 'RUNNING'
       AND (
         tr.started_at < NOW() - ($1::int * INTERVAL '1 second')
         OR NOT EXISTS (
           SELECT 1 FROM tasks t WHERE t.id = tr.task_id
         )
         OR EXISTS (
           SELECT 1
           FROM tasks t
           WHERE t.id = tr.task_id
             AND t.status IN ('COMPLETED','FAILED','DEAD_LETTER','SKIPPED','CANCELLED')
         )
       )`,
    [threshold]
  );

  return { reconciled: rowCount || 0, threshold_seconds: threshold };
}

module.exports = {
  claimTaskRun,
  completeTaskRun,
  failTaskRun,
  reconcileStaleTaskRuns,
};
