// control/notifier.js
// Push notifications to the operator (when enabled).
//  - A task dead-letters (exhausted all retries)
//  - Daily budget cap is approaching or hit
//  - Emergency stop is triggered
//  - A task is quarantined
//
// iMessage delivery is DISABLED: do not send from this machine's iCloud to the
// operator's device. Quarantine/budget/dead-letter alerts are logged only.
// To re-enable iMessage, set IMESSAGE_ENABLED=1 and IMESSAGE_RECIPIENT in .env.
//
// Designed to be non-fatal: notification failures do not break callers.
// Quarantine throttle is DB-backed so it survives gateway restarts.

"use strict";

require("dotenv").config();
const pg = require("../infra/postgres");

// iMessage delivery is permanently disabled at code level.
// Even if IMESSAGE_ENABLED / IMESSAGE_RECIPIENT are set in env,
// this module will not send via Messages.app.
const IMESSAGE_ENABLED = false;
const IMESSAGE_RECIPIENT = "";
const QUARANTINE_THROTTLE_MS = 30 * 60 * 1000; // 30 min — increased from 5 min

// ─────────────────────────────────────────────────────────────
// iMessage delivery — disabled by default (do not send from this iCloud)
// ─────────────────────────────────────────────────────────────

/**
 * Send an iMessage to the operator. Permanently disabled.
 * This is kept as a no-op so callers can continue to await broadcast()
 * without triggering any Messages.app / osascript calls.
 * @param {string} _text
 */
async function sendIMessage(_text) {
  return;
}

/** Strip Markdown formatting for plain-text iMessage delivery. */
function stripMarkdown(str) {
  return String(str ?? "")
    .replace(/\*([^*]+)\*/g, "$1")   // bold
    .replace(/_([^_]+)_/g, "$1")     // italic
    .replace(/`([^`]+)`/g, "$1")     // code
    .replace(/\[([^\]]+)\]/g, "$1"); // link text
}

/** Broadcast a notification to the operator. Never throws. */
async function broadcast(text) {
  await sendIMessage(stripMarkdown(text));
}

// ─────────────────────────────────────────────────────────────
// DB-backed quarantine throttle
// Survives gateway restarts — unlike the old in-memory Map.
// ─────────────────────────────────────────────────────────────

async function ensureThrottleTable() {
  await pg.query(`
    CREATE TABLE IF NOT EXISTS notifier_quarantine_sent (
      task_id TEXT PRIMARY KEY,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});
}

/** Returns true if we should suppress this quarantine notification. */
async function isQuarantineThrottled(taskId) {
  try {
    await ensureThrottleTable();
    const { rows } = await pg.query(
      `SELECT sent_at FROM notifier_quarantine_sent WHERE task_id = $1`,
      [taskId]
    );
    if (!rows.length) return false;
    const elapsed = Date.now() - new Date(rows[0].sent_at).getTime();
    return elapsed < QUARANTINE_THROTTLE_MS;
  } catch {
    return false; // fail open — allow notification on DB error
  }
}

/** Record that we sent a quarantine notification for this task. */
async function markQuarantineSent(taskId) {
  try {
    await ensureThrottleTable();
    await pg.query(
      `INSERT INTO notifier_quarantine_sent (task_id, sent_at)
       VALUES ($1, NOW())
       ON CONFLICT (task_id) DO UPDATE SET sent_at = NOW()`,
      [taskId]
    );
    // Prune entries older than 24h to keep the table small
    await pg.query(
      `DELETE FROM notifier_quarantine_sent WHERE sent_at < NOW() - INTERVAL '24 hours'`
    ).catch(() => {});
  } catch {
    // Non-fatal
  }
}

// ─────────────────────────────────────────────────────────────
// Notification types
// ─────────────────────────────────────────────────────────────

/**
 * Called by retry.js when a task dead-letters.
 * @param {{ id, type, title, plan_id, last_error, retry_count }} task
 */
async function notifyDeadLetter(task) {
  const shortId  = (task.id || "").slice(0, 8);
  const planFrag = task.plan_id ? ` (plan ${task.plan_id.slice(0, 8)})` : "";
  const errSnip  = (task.last_error || "unknown error").slice(0, 140);

  const text = [
    `☠ Dead Letter — task failed permanently${planFrag}`,
    `${task.type} ${shortId} — ${task.title || "untitled"}`,
    `After ${task.retry_count || 0} retries: ${errSnip}`,
  ].join("\n");

  await broadcast(text);
}

/**
 * Called by budget.js when daily spend hits a threshold.
 * @param {{ spent_usd, daily_cap_usd, threshold_pct }} info
 */
async function notifyBudgetWarning({ spent_usd, daily_cap_usd, threshold_pct }) {
  const text = [
    `💸 Budget Warning — ${threshold_pct}% of daily cap used`,
    `Spent: $${Number(spent_usd || 0).toFixed(3)} / $${Number(daily_cap_usd || 0).toFixed(2)} today`,
  ].join("\n");

  await broadcast(text);
}

/**
 * Called when daily cap is completely exhausted.
 */
async function notifyBudgetExhausted({ spent_usd, daily_cap_usd }) {
  const text = [
    `🚫 Daily budget cap hit — new plans blocked`,
    `Spent $${Number(spent_usd || 0).toFixed(3)} (cap: $${Number(daily_cap_usd || 0).toFixed(2)})`,
    `All new LLM plans are rejected until tomorrow (UTC midnight).`,
  ].join("\n");

  await broadcast(text);
}

/**
 * Called when emergency stop is triggered.
 * @param {string} triggeredBy  telegram user id
 */
async function notifyEmergencyStop(triggeredBy) {
  const text = [
    `🛑 EMERGENCY STOP TRIGGERED`,
    `By user ${String(triggeredBy)}`,
    `All queues paused.`,
  ].join("\n");

  await broadcast(text);
}

/**
 * Called when a task is quarantined (stuck task reaper gives up).
 * DB-backed throttle (30 min) prevents spam across gateway restarts.
 * @param {{ id, type, reason, source, metadata }} quarantineInfo
 */
async function notifyQuarantine({ id, type, reason, source, metadata }) {
  const taskId = id || "";

  if (await isQuarantineThrottled(taskId)) {
    return; // already notified recently — suppress
  }

  await markQuarantineSent(taskId);

  const shortId = taskId.slice(0, 8);
  const metaSnip = metadata ? JSON.stringify(metadata).slice(0, 200) : "";

  const text = [
    `🚨 Task Quarantined — System Gave Up`,
    `${type || "unknown"} ${shortId} — ${String(reason || "quarantined")}`,
    `Source: ${String(source || "unknown")}`,
    metaSnip ? `Metadata: ${metaSnip}` : "",
    ``,
    `Failed to dispatch 5+ times. Review or release from quarantine.`,
  ].filter(Boolean).join("\n");

  await broadcast(text);
}

// ─────────────────────────────────────────────────────────────
// Legacy shim — gateway/telegram.js calls setBot() on startup.
// No-op now that we use iMessage, but kept to avoid import errors.
// ─────────────────────────────────────────────────────────────
function setBot(_bot) {
  // no-op: iMessage doesn't need a bot instance
}

/** Escape helper kept for any callers that import it. */
function escMd(str) {
  return String(str ?? "").replace(/([_*`\[])/g, "\\$1");
}

module.exports = {
  setBot,
  broadcast,
  notifyDeadLetter,
  notifyBudgetWarning,
  notifyBudgetExhausted,
  notifyEmergencyStop,
  notifyQuarantine,
  escMd,
};
