// control/emergency.js
// Global kill switch for the execution layer.
// /emergency-stop halts all dispatch and marks a Redis flag.
// /resume clears the flag and resumes normal operation.
//
// All components check isEmergencyStopped() before acting.

const redis = require("../infra/redis");
const pg    = require("../infra/postgres");

const EMERGENCY_KEY = "clawbot:emergency_stop";

// ── State ──────────────────────────────────────────────────────

async function triggerEmergencyStop(operatorId) {
  await redis.set(EMERGENCY_KEY, JSON.stringify({
    triggered_at: new Date().toISOString(),
    triggered_by: String(operatorId),
  }));

  // Mark all RUNNING tasks as stuck (they will be reaped on resume)
  const { rowCount } = await pg.query(
    `UPDATE tasks SET status = 'CREATED', started_at = NULL
     WHERE status IN ('RUNNING', 'DISPATCHED', 'QUEUED')
     RETURNING id`
  );

  // Pause BullMQ queues via Redis.
  // BullMQ v5 reads the paused state from key: bull:{queueName}:paused
  // (NOT bull:{queueName}:meta — that was wrong and had no effect)
  const queues = [
    "claw_tasks",
    "claw_tasks_io",
    "claw_tasks_io_heavy",
    "claw_tasks_llm",
    "claw_tasks_qa",
  ];
  for (const q of queues) {
    await redis.set(`bull:${q}:paused`, "paused");
  }

  console.log(`[emergency] 🛑 EMERGENCY STOP triggered by ${operatorId}. ${rowCount} tasks reset.`);
  return rowCount;
}

async function clearEmergencyStop(operatorId) {
  await redis.del(EMERGENCY_KEY);

  // Unpause all queues
  const queues = [
    "claw_tasks",
    "claw_tasks_io",
    "claw_tasks_io_heavy",
    "claw_tasks_llm",
    "claw_tasks_qa",
  ];
  for (const q of queues) {
    await redis.del(`bull:${q}:paused`);
  }

  console.log(`[emergency] ✅ Emergency stop cleared by ${operatorId}`);
}

async function isEmergencyStopped() {
  const val = await redis.get(EMERGENCY_KEY);
  return val ? JSON.parse(val) : null;
}

// ── Plan-level stop (not emergency — just cancel one plan) ──────

async function stopPlan(planId) {
  // Cancel all non-terminal tasks in this plan
  const { rows } = await pg.query(
    `UPDATE tasks
     SET status = 'CANCELLED'
     WHERE plan_id = $1
       AND status IN ('CREATED', 'PENDING', 'QUEUED', 'DISPATCHED', 'RETRY')
     RETURNING id, type, status`,
    [planId]
  );

  // Mark plan as cancelled
  await pg.query(
    `UPDATE plans SET status = 'cancelled' WHERE id = $1`,
    [planId]
  );

  // Write audit entry
  await pg.query(
    `INSERT INTO audit_log (plan_id, from_status, to_status, event)
     VALUES ($1, 'active', 'cancelled', 'MANUAL_STOP')`,
    [planId]
  );

  console.log(`[emergency] ✋ Plan ${planId} stopped — ${rows.length} tasks cancelled`);
  return rows.length;
}

module.exports = { triggerEmergencyStop, clearEmergencyStop, isEmergencyStopped, stopPlan };
