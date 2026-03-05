"use strict";

const pg = require("../infra/postgres");
const notifier = require("./notifier");

let _schemaReady = false;

async function ensureQuarantineSchema() {
  if (_schemaReady) return;
  await pg.query(`
    CREATE TABLE IF NOT EXISTS task_quarantine (
      task_id UUID PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      source TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `).catch(() => {});
  await pg.query(`
    CREATE INDEX IF NOT EXISTS idx_task_quarantine_active
    ON task_quarantine (active)
    WHERE active = TRUE
  `).catch(() => {});
  _schemaReady = true;
}

async function quarantineTask(taskId, reason, source = "manual", metadata = {}) {
  if (!taskId) return;
  await ensureQuarantineSchema();
  await pg.query(
    `INSERT INTO task_quarantine (task_id, reason, source, active, metadata)
     VALUES ($1, $2, $3, TRUE, $4::jsonb)
     ON CONFLICT (task_id)
     DO UPDATE SET
       reason = EXCLUDED.reason,
       source = EXCLUDED.source,
       active = TRUE,
       metadata = EXCLUDED.metadata,
       updated_at = NOW()`,
    [taskId, reason || "quarantined", source || "manual", JSON.stringify(metadata || {})]
  );

  // Ambassador notification layer: notify operator when system gives up on a task
  // Only notify for auto-quarantined tasks (not manual ones)
  if (source !== "manual" && source !== "legacy_sync") {
    try {
      const { rows } = await pg.query(
        `SELECT type FROM tasks WHERE id = $1`,
        [taskId]
      ).catch(() => ({ rows: [] }));
      const taskType = rows[0]?.type || "unknown";
      await notifier.notifyQuarantine({
        id: taskId,
        type: taskType,
        reason: reason || "quarantined",
        source: source || "auto",
        metadata: metadata || {},
      });
    } catch (err) {
      // Non-fatal — notification failure shouldn't break quarantine
      console.warn(`[quarantine] Failed to send notification for ${taskId}:`, err.message);
    }
  }
}

async function releaseQuarantine(taskId) {
  if (!taskId) return;
  await ensureQuarantineSchema();
  await pg.query(
    `UPDATE task_quarantine
     SET active = FALSE,
         updated_at = NOW()
     WHERE task_id = $1`,
    [taskId]
  );
}

async function syncLegacyStaleQuarantine() {
  await ensureQuarantineSchema();
  const { rowCount } = await pg.query(
    `INSERT INTO task_quarantine (task_id, reason, source, active, metadata)
     SELECT
       t.id,
       COALESCE(t.dead_letter_reason, 'LEGACY_STALE'),
       'legacy_sync',
       TRUE,
       jsonb_build_object('last_error', t.last_error)
     FROM tasks t
     WHERE t.status = 'DEAD_LETTER'
       AND (
         COALESCE(t.dead_letter_reason, '') ILIKE 'MANUAL_STALE%'
         OR COALESCE(t.last_error, '') ILIKE '%stale dispatched requeue loop cleanup%'
       )
     ON CONFLICT (task_id)
     DO UPDATE SET
       reason = EXCLUDED.reason,
       source = EXCLUDED.source,
       active = TRUE,
       metadata = EXCLUDED.metadata,
       updated_at = NOW()`
  );
  return rowCount || 0;
}

module.exports = {
  ensureQuarantineSchema,
  quarantineTask,
  releaseQuarantine,
  syncLegacyStaleQuarantine,
};
