"use strict";

/**
 * control/coordinator-watchdog.js
 * 
 * Watchdog for the Coordinator Pulse to prevent SPOF.
 * 
 * If the coordinator hasn't updated in 10 minutes, agents enter "safe mode"
 * where they only run critical tasks and skip non-essential work.
 */

const fsp = require("fs/promises");
const path = require("path");
const pg = require("../infra/postgres");
const { buildHealthSummary, authProvidersFromEnv } = require("./health-summary");

const ROOT = path.join(__dirname, "..");
const HEALTH_STATE_FILE = path.join(ROOT, "agent-state", "system-health-state.json");
const COORDINATOR_STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

// ─── Check Coordinator Health ────────────────────────────────────────────────

async function checkCoordinatorHealth() {
  try {
    const stats = await fsp.stat(HEALTH_STATE_FILE);
    const ageMs = Date.now() - stats.mtimeMs;
    const isStale = ageMs > COORDINATOR_STALE_THRESHOLD_MS;
    
    return {
      healthy: !isStale,
      last_update: new Date(stats.mtimeMs).toISOString(),
      age_ms: ageMs,
      age_minutes: Math.floor(ageMs / 60000),
      stale: isStale,
    };
  } catch (err) {
    // File doesn't exist = coordinator never ran = unhealthy
    return {
      healthy: false,
      last_update: null,
      age_ms: Infinity,
      age_minutes: Infinity,
      stale: true,
    };
  }
}

// ─── Safe Mode Decision ───────────────────────────────────────────────────────

/**
 * Determine if system should enter safe mode
 * Safe mode = only critical agents run, skip non-essential work
 */
async function shouldEnterSafeMode() {
  const health = await checkCoordinatorHealth();
  
  if (health.stale) {
    return {
      safe_mode: true,
      reason: `Coordinator stale (${health.age_minutes} minutes old)`,
      critical_only: true,
    };
  }
  
  return {
    safe_mode: false,
    reason: "Coordinator healthy",
    critical_only: false,
  };
}

// ─── Critical Agents List ──────────────────────────────────────────────────────

const CRITICAL_AGENTS = [
  "system_administration",
  "data_processing",
  "scheduling_calendar",
];

/**
 * Check if an agent is critical (should run even in safe mode)
 */
function isCriticalAgent(agentId) {
  return CRITICAL_AGENTS.includes(agentId);
}

// ─── Fast Health Check ────────────────────────────────────────────────────────

/**
 * Fast-track health check (<1s) for agents before execution
 * Returns minimal health status without full coordination cycle
 */
async function fastHealthCheck() {
  const start = Date.now();
  
  try {
    // Quick database check
    const dbCheck = await Promise.race([
      pg.query("SELECT 1"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 500)),
    ]);
    
    // Quick coordinator staleness check
    const coordinatorHealth = await checkCoordinatorHealth();
    
    const latency = Date.now() - start;
    
    const nowIso = new Date().toISOString();
    const healthSummary = buildHealthSummary({
      checkedAt: nowIso,
      safeMode: coordinatorHealth.stale,
      coordinator: {
        healthy: coordinatorHealth.healthy,
        last_update: coordinatorHealth.last_update,
        age_minutes: Number.isFinite(coordinatorHealth.age_minutes) ? coordinatorHealth.age_minutes : null,
        stale: coordinatorHealth.stale,
      },
      services: {
        database: {
          status: dbCheck ? "healthy" : "unhealthy",
          latency_ms: latency,
          consecutive_failures: dbCheck ? 0 : 1,
        },
        coordinator: {
          status: coordinatorHealth.healthy ? "healthy" : "degraded",
          latency_ms: null,
          consecutive_failures: coordinatorHealth.stale ? 1 : 0,
        },
      },
      authProviders: authProvidersFromEnv(),
    });

    return {
      ok: dbCheck && coordinatorHealth.healthy,
      latency_ms: latency,
      database: dbCheck ? "healthy" : "unhealthy",
      coordinator: coordinatorHealth.healthy ? "healthy" : "stale",
      coordinator_age_minutes: coordinatorHealth.age_minutes,
      safe_mode: coordinatorHealth.stale,
      health_summary: healthSummary,
    };
  } catch (err) {
    const nowIso = new Date().toISOString();
    const healthSummary = buildHealthSummary({
      checkedAt: nowIso,
      safeMode: true,
      coordinator: {
        healthy: false,
        last_update: null,
        age_minutes: null,
        stale: true,
      },
      services: {
        database: {
          status: "unhealthy",
          latency_ms: null,
          consecutive_failures: 1,
          error: err.message,
        },
      },
      authProviders: authProvidersFromEnv(),
    });
    return {
      ok: false,
      latency_ms: Date.now() - start,
      error: err.message,
      safe_mode: true, // Enter safe mode on error
      health_summary: healthSummary,
    };
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  checkCoordinatorHealth,
  shouldEnterSafeMode,
  isCriticalAgent,
  fastHealthCheck,
  CRITICAL_AGENTS,
};
