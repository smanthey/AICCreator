"use strict";

const pg = require("../infra/postgres");
const { quarantineTask } = require("./quarantine");

const DLQ_REASON = Object.freeze({
  INVALID_SCHEMA: "INVALID_SCHEMA",
  POLICY_BLOCKED: "POLICY_BLOCKED",
  EXECUTION_ERROR: "EXECUTION_ERROR",
  RETRY_LIMIT_EXCEEDED: "RETRY_LIMIT_EXCEEDED",
});

async function deadLetterTask({ taskId, reasonCode, message, client, metadata = {} }) {
  const db = client || pg;
  const reason = reasonCode || DLQ_REASON.EXECUTION_ERROR;
  const msg = message || reason;

  await db.query(
    `UPDATE tasks
     SET status='DEAD_LETTER',
         dead_lettered_at=NOW(),
         dead_letter_reason=$2,
         last_error=$3
     WHERE id=$1`,
    [taskId, reason, msg]
  );

  if (/MANUAL_STALE/i.test(reason) || /stale dispatched requeue loop cleanup/i.test(msg)) {
    const quarantineMeta = { message: msg, ...metadata };
    const quarantineReason = metadata.reaped_count_60m != null ? "MANUAL_STALE_DISPATCH_CLEANUP" : reason;
    const quarantineSource = metadata.reaped_count_60m != null ? "auto_reaper" : "dead_letter";
    await quarantineTask(taskId, quarantineReason, quarantineSource, quarantineMeta).catch(() => {});
  }
}

module.exports = { DLQ_REASON, deadLetterTask };
