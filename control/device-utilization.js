"use strict";

/**
 * control/device-utilization.js
 *
 * Ensures all online devices are actively working.
 * - Detects idle devices
 * - Generates appropriate work for idle devices (prefers queues with backlog so idle workers help other lanes)
 * - Rebalances work when possible
 * - Prevents devices from sitting idle
 *
 * Worker shifting: run workers with multiple tags (e.g. WORKER_TAGS=infra,io_heavy) so they consume
 * from several queues; idle devices then get work that matches any of their tags and prefer draining
 * backlog over creating new work for already-saturated queues.
 */

const crypto = require("crypto");
const pg = require("../infra/postgres");
const { resolveRouting } = require("../config/task-routing");
const { buildTaskIdempotencyKey } = require("./idempotency");

// Idle threshold: device with 0 jobs for more than 2 minutes is considered idle
const IDLE_THRESHOLD_SECONDS = 120;

// Work generation strategies based on device tags
const IDLE_WORK_STRATEGIES = {
  // Infrastructure tasks
  infra: [
    { type: "report", payload: {}, priority: 3 },
    { type: "research_sync", payload: {}, priority: 3 },
    { type: "platform_health_report", payload: {}, priority: 3 },
  ],
  
  // I/O heavy tasks
  io_heavy: [
    { type: "index", payload: {}, priority: 3 },
    { type: "site_audit", payload: { all: false }, priority: 3 },
    { type: "github_scan", payload: { save: true }, priority: 3 },
  ],
  
  // CPU heavy tasks
  cpu_heavy: [
    { type: "media_hash", payload: {}, priority: 3 },
    { type: "cluster_media", payload: {}, priority: 3 },
  ],
  
  // AI tasks (include top-priority: Roblox, PayClaw — spread across all devices)
  ai: [
    { type: "opencode_controller", payload: { repo: "RobloxGitSync", source: "idle_device", objective: "Cleanup first: fix load/visibility in Studio, script errors, Rojo sync; then incremental gameplay or retention. Per roblox pulse." }, priority: 9 },
    { type: "opencode_controller", payload: { repo: "payclaw", source: "idle_device", objective: "Port and harden PayClaw per docs/SOURCES.md" }, priority: 9 },
    { type: "analyze_content", payload: {}, priority: 3 },
    { type: "generate_copy", payload: {}, priority: 3 },
    { type: "research_signals", payload: {}, priority: 3 },
  ],
  
  // QA tasks
  qa: [
    { type: "qa_run", payload: {}, priority: 3 },
    { type: "qa_spec", payload: {}, priority: 3 },
  ],
  
  // Default fallback tasks
  default: [
    { type: "echo", payload: { message: "idle_device_work" }, priority: 5 },
    { type: "report", payload: {}, priority: 3 },
  ],
};

/**
 * Get all idle devices
 */
async function getIdleDevices() {
  const { rows } = await pg.query(
    `SELECT worker_id, hostname, tags, status, current_jobs_count, last_heartbeat
     FROM device_registry
     WHERE status IN ('ready', 'busy')
       AND NOW() - last_heartbeat <= INTERVAL '30 seconds'
       AND current_jobs_count = 0
       AND NOW() - last_heartbeat >= INTERVAL '${IDLE_THRESHOLD_SECONDS} seconds'
     ORDER BY last_heartbeat ASC`
  );
  return rows;
}

/**
 * Get devices sorted by utilization (least utilized first)
 */
async function getDevicesByUtilization(requiredTags = []) {
  const tags = Array.isArray(requiredTags) ? requiredTags : [];
  const tagFilter = tags.length > 0 ? `AND tags @> $2::text[]` : ``;
  const params = tags.length > 0 ? [tags] : [];
  
  const { rows } = await pg.query(
    `SELECT worker_id, hostname, tags, status, current_jobs_count, last_heartbeat
     FROM device_registry
     WHERE status IN ('ready', 'busy')
       AND NOW() - last_heartbeat <= INTERVAL '30 seconds'
       ${tagFilter}
     ORDER BY current_jobs_count ASC, last_heartbeat DESC`,
    params
  );
  return rows;
}

/**
 * Get work strategies for a device based on its tags
 */
function getWorkStrategiesForDevice(tags) {
  const tagArray = Array.isArray(tags) ? tags : [];
  const strategies = [];
  
  // Collect strategies from all matching tags
  for (const tag of tagArray) {
    if (IDLE_WORK_STRATEGIES[tag]) {
      strategies.push(...IDLE_WORK_STRATEGIES[tag]);
    }
  }
  
  // If no strategies found, use default
  if (strategies.length === 0) {
    strategies.push(...IDLE_WORK_STRATEGIES.default);
  }
  
  return strategies;
}

/** Max CREATED tasks per queue before we avoid generating more for that queue (let backlog drain first) */
const MAX_CREATED_PER_QUEUE_BEFORE_SKIP = 20;
/** Prefer queues with at least this much backlog so idle workers "help out" */
const PREFER_QUEUE_BACKLOG_MIN = 1;

/**
 * Get CREATED task counts by worker_queue (so idle devices can help drain backlog)
 */
async function getCreatedCountByQueue() {
  const { rows } = await pg.query(
    `SELECT COALESCE(worker_queue, 'claw_tasks') AS queue_name, COUNT(*)::int AS c
     FROM tasks
     WHERE status = 'CREATED'
       AND NOT EXISTS (
         SELECT 1 FROM task_quarantine tq WHERE tq.task_id = tasks.id AND tq.active = TRUE
       )
     GROUP BY COALESCE(worker_queue, 'claw_tasks')`
  );
  const byQueue = new Map();
  for (const r of rows) byQueue.set(r.queue_name, Number(r.c || 0));
  return byQueue;
}

/**
 * Generate work for an idle device.
 * Prefers task types whose queue has backlog (so idle workers help other lanes) and
 * skips queues that are already saturated with CREATED tasks.
 */
async function generateWorkForDevice(device) {
  const strategies = getWorkStrategiesForDevice(device.tags);
  
  if (strategies.length === 0) {
    return null;
  }

  const createdByQueue = await getCreatedCountByQueue();

  // Prefer strategies whose queue has some backlog (1..MAX) so we help drain; skip saturated queues
  const eligible = strategies.filter((s) => {
    const routing = resolveRouting(s.type);
    const queue = routing.queue || "claw_tasks";
    const count = createdByQueue.get(queue) || 0;
    return count < MAX_CREATED_PER_QUEUE_BEFORE_SKIP;
  });

  const pool = eligible.length > 0 ? eligible : strategies.filter((s) => {
    const routing = resolveRouting(s.type);
    const queue = routing.queue || "claw_tasks";
    return (createdByQueue.get(queue) || 0) < MAX_CREATED_PER_QUEUE_BEFORE_SKIP;
  });
  if (pool.length === 0) {
    return null;
  }

  // Among eligible, prefer queues with backlog (shift: help other tasks)
  const withBacklog = pool.filter((s) => {
    const routing = resolveRouting(s.type);
    const count = createdByQueue.get(routing.queue || "claw_tasks") || 0;
    return count >= PREFER_QUEUE_BACKLOG_MIN;
  });
  const strategiesToPick = withBacklog.length > 0 ? withBacklog : pool;

  const strategy = strategiesToPick[Math.floor(Math.random() * strategiesToPick.length)];
  const routing = resolveRouting(strategy.type);
  
  // Check if task already exists (avoid duplicates)
  const idempotencyKey = buildTaskIdempotencyKey(strategy.type, {
    ...strategy.payload,
    device_id: device.worker_id,
    generated_for: "idle_device",
  });
  
  const existing = await pg.query(
    `SELECT id FROM tasks
     WHERE idempotency_key = $1
       AND status NOT IN ('COMPLETED', 'FAILED', 'DEAD_LETTER')
     LIMIT 1`,
    [idempotencyKey]
  );
  
  if (existing.rows.length > 0) {
    return null; // Task already exists
  }
  
  // Create the task — explicitly pass id so this works regardless of whether
  // pgcrypto / gen_random_uuid() DEFAULT is configured on the NAS Postgres.
  // Pattern matches inserter.js which also passes id explicitly via uuid().
  const newTaskId = crypto.randomUUID();
  await pg.query(
    `INSERT INTO tasks
       (id, type, payload, priority, worker_queue, required_tags, idempotency_key, status, created_at)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6::text[], $7, 'CREATED', NOW())`,
    [
      newTaskId,
      strategy.type,
      JSON.stringify({
        ...strategy.payload,
        _generated_for: "idle_device",
        _device_id: device.worker_id,
      }),
      strategy.priority,
      routing.queue || "claw_tasks",
      routing.required_tags || [],
      idempotencyKey,
    ]
  );

  return newTaskId;
}

/**
 * Ensure all idle devices get work
 */
async function ensureIdleDevicesHaveWork() {
  const idleDevices = await getIdleDevices();
  const generated = [];
  
  for (const device of idleDevices) {
    try {
      const taskId = await generateWorkForDevice(device);
      if (taskId) {
        generated.push({
          device_id: device.worker_id,
          hostname: device.hostname,
          tags: device.tags,
          task_id: taskId,
        });
      }
    } catch (err) {
      console.warn(`[utilization] Failed to generate work for ${device.worker_id}:`, err.message);
    }
  }
  
  return generated;
}

/**
 * Get utilization statistics
 */
async function getUtilizationStats() {
  const { rows } = await pg.query(
    `SELECT 
       COUNT(*) FILTER (WHERE status IN ('ready', 'busy') AND NOW() - last_heartbeat <= INTERVAL '30 seconds') as online_devices,
       COUNT(*) FILTER (WHERE status IN ('ready', 'busy') AND NOW() - last_heartbeat <= INTERVAL '30 seconds' AND current_jobs_count = 0) as idle_devices,
       COUNT(*) FILTER (WHERE status IN ('ready', 'busy') AND NOW() - last_heartbeat <= INTERVAL '30 seconds' AND current_jobs_count > 0) as busy_devices,
       AVG(current_jobs_count) FILTER (WHERE status IN ('ready', 'busy') AND NOW() - last_heartbeat <= INTERVAL '30 seconds') as avg_jobs_per_device,
       MAX(current_jobs_count) FILTER (WHERE status IN ('ready', 'busy') AND NOW() - last_heartbeat <= INTERVAL '30 seconds') as max_jobs_per_device
     FROM device_registry`
  );
  
  const stats = rows[0] || {};
  const online = Number(stats.online_devices || 0);
  const idle = Number(stats.idle_devices || 0);
  const busy = Number(stats.busy_devices || 0);
  const utilization = online > 0 ? ((busy / online) * 100).toFixed(1) : 0;
  
  return {
    online_devices: online,
    idle_devices: idle,
    busy_devices: busy,
    utilization_percent: parseFloat(utilization),
    avg_jobs_per_device: parseFloat(stats.avg_jobs_per_device || 0),
    max_jobs_per_device: Number(stats.max_jobs_per_device || 0),
  };
}

/**
 * Rebalance work by finding tasks that could be moved to less busy devices
 */
async function rebalanceWork() {
  // Get all devices sorted by utilization
  const allDevices = await getDevicesByUtilization();
  
  if (allDevices.length < 2) {
    return []; // Need at least 2 devices to rebalance
  }
  
  // Find devices with significant load difference
  const maxJobs = Math.max(...allDevices.map(d => d.current_jobs_count || 0));
  const minJobs = Math.min(...allDevices.map(d => d.current_jobs_count || 0));
  
  // Only rebalance if there's a significant difference (3+ jobs)
  if (maxJobs - minJobs < 3) {
    return [];
  }
  
  // Find busy devices (top 25% by job count)
  const busyDevices = allDevices
    .filter(d => (d.current_jobs_count || 0) > minJobs + 2)
    .slice(0, Math.ceil(allDevices.length * 0.25));
  
  // Find idle devices (bottom 25% by job count)
  const idleDevices = allDevices
    .filter(d => (d.current_jobs_count || 0) <= minJobs)
    .slice(-Math.ceil(allDevices.length * 0.25));
  
  if (busyDevices.length === 0 || idleDevices.length === 0) {
    return [];
  }
  
  // Generate work for idle devices to help balance
  const rebalanced = [];
  for (const device of idleDevices) {
    try {
      const taskId = await generateWorkForDevice(device);
      if (taskId) {
        rebalanced.push({
          device_id: device.worker_id,
          task_id: taskId,
        });
      }
    } catch (err) {
      console.warn(`[utilization] Rebalance failed for ${device.worker_id}:`, err.message);
    }
  }
  
  return rebalanced;
}

module.exports = {
  getIdleDevices,
  getDevicesByUtilization,
  getWorkStrategiesForDevice,
  getCreatedCountByQueue,
  generateWorkForDevice,
  ensureIdleDevicesHaveWork,
  getUtilizationStats,
  rebalanceWork,
};
