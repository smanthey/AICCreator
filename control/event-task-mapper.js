"use strict";

/**
 * Explicit event-to-task mapping and rate limiting for the spawner consumer.
 * Only event types listed here may spawn tasks; no ad-hoc task creation from events.
 */

const redis = require("../infra/redis");
const DEBOUNCE_PREFIX = "event_spawn:";
const DEBOUNCE_MINUTES = parseInt(process.env.EVENT_SPAWN_DEBOUNCE_MINUTES || "5", 10) || 5;
const DEBOUNCE_TTL_SEC = Math.max(60, DEBOUNCE_MINUTES * 60);

const EVENT_TO_TASK = Object.freeze({
  "loyalty.points.earned":     { taskType: "echo", priority: 5 },
  "loyalty.points.redeemed":   { taskType: "echo", priority: 5 },
  "loyalty.points.adjusted":   { taskType: "echo", priority: 5 },
  "loyalty.points.expired":    { taskType: "echo", priority: 5 },
  "wallet.balance.updated":   { taskType: "echo", priority: 3 },
  "customer.transaction.created":  { taskType: "echo", priority: 4 },
  "customer.transaction.updated":  { taskType: "echo", priority: 4 },
  "customer.transaction.recorded": { taskType: "echo", priority: 4 },
});

/**
 * Get task spec for a domain event type, if any.
 * @param {string} eventType - e.g. "loyalty.points.earned"
 * @returns {{ taskType: string, priority: number } | null}
 */
function getTaskSpecForEvent(eventType) {
  if (!eventType || typeof eventType !== "string") return null;
  const spec = EVENT_TO_TASK[eventType];
  return spec ? { taskType: spec.taskType, priority: spec.priority } : null;
}

/**
 * Rate limit: should we spawn a task for this event? Uses Redis key per (eventType, entityId).
 * If key exists, return false (skip). If not, set key with TTL and return true.
 * @param {string} eventType
 * @param {string} entityId - e.g. idempotency_key or customer id from payload
 * @returns {Promise<boolean>}
 */
async function shouldSpawnTask(eventType, entityId) {
  if (!eventType || !entityId) return true;
  const key = `${DEBOUNCE_PREFIX}${eventType}:${String(entityId).slice(0, 200)}`;
  try {
    const set = await redis.set(key, "1", "EX", DEBOUNCE_TTL_SEC, "NX");
    return set === "OK";
  } catch (e) {
    return true;
  }
}

module.exports = {
  getTaskSpecForEvent,
  shouldSpawnTask,
  EVENT_TO_TASK,
};
