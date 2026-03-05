"use strict";

const pg = require("../infra/postgres");
const { resolveRouting } = require("../config/task-routing");
const { buildTaskIdempotencyKey } = require("./idempotency");

// Hardware gating thresholds (percentage-based)
const CPU_LOAD_THRESHOLD = Math.max(0, Math.min(100, Number(process.env.WORKER_CPU_LOAD_THRESHOLD || 85)));
const MEMORY_USAGE_THRESHOLD = Math.max(0, Math.min(100, Number(process.env.WORKER_MEMORY_USAGE_THRESHOLD || 90)));

async function chooseEligibleWorker(requiredTags = []) {
  const tags = Array.isArray(requiredTags) ? requiredTags : [];
  
  // Prefer devices with 0 jobs (idle), then least busy
  // Hardware gating: exclude workers with CPU load > threshold OR memory usage > threshold
  // NULL values are treated as eligible (backward compatibility)
  const { rows } = await pg.query(
    `SELECT worker_id, hostname, tags, current_jobs_count
       FROM device_registry
      WHERE status IN ('ready','busy')
        AND NOW() - last_heartbeat <= INTERVAL '30 seconds'
        AND tags @> $1::text[]
        AND (cpu_load_percent IS NULL OR cpu_load_percent <= $2)
        AND (
          free_mem_mb IS NULL 
          OR ram_gb IS NULL 
          OR ram_gb = 0
          OR ((1.0 - (free_mem_mb::numeric / (ram_gb::numeric * 1024))) * 100) <= $3
        )
      ORDER BY 
        CASE WHEN current_jobs_count = 0 THEN 0 ELSE 1 END ASC,
        current_jobs_count ASC,
        last_heartbeat DESC
      LIMIT 1`,
    [tags, CPU_LOAD_THRESHOLD, MEMORY_USAGE_THRESHOLD]
  );
  return rows[0] || null;
}

async function scheduleTaskDraft(type, payload = {}, overrides = {}) {
  const routing = resolveRouting(type);
  const required_tags = overrides.required_tags || routing.required_tags || [];
  const worker_queue = overrides.worker_queue || routing.queue || "claw_tasks";

  const worker = await chooseEligibleWorker(required_tags);

  return {
    type,
    payload,
    worker_queue,
    required_tags,
    idempotency_key: buildTaskIdempotencyKey(type, payload || {}),
    eligible_worker: worker,
    schedulable: !!worker || required_tags.length === 0,
  };
}

module.exports = {
  chooseEligibleWorker,
  scheduleTaskDraft,
};
