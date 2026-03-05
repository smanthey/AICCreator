"use strict";

/**
 * control/system-health-coordinator.js
 * 
 * Unified system health coordinator for OpenClaw.
 * Based on 60 days of operational experience:
 * - Coordinates all agents to prevent conflicts
 * - Intentional scheduling based on system state
 * - Unified self-healing across all systems
 * - Deterministic decision-making (no randomness)
 * - Resource-aware execution
 */

const pg = require("../infra/postgres");
const fsp = require("fs/promises");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const HEALTH_STATE_FILE = path.join(ROOT, "agent-state", "system-health-state.json");
const { atomicWriteJSON, atomicReadModifyWrite } = require("./atomic-state");

// System health state
let healthState = {
  last_updated: null,
  services: {},
  agents: {},
  resources: {},
  conflicts: [],
  recommendations: [],
};

// ─── Service Health Monitoring ────────────────────────────────────────────────

async function checkServiceHealth(serviceName, checkFn) {
  try {
    const start = Date.now();
    const result = await checkFn();
    const latency = Date.now() - start;
    
    return {
      name: serviceName,
      status: result ? "healthy" : "unhealthy",
      latency,
      last_check: new Date().toISOString(),
      consecutive_failures: result ? 0 : (healthState.services[serviceName]?.consecutive_failures || 0) + 1,
    };
  } catch (err) {
    return {
      name: serviceName,
      status: "unhealthy",
      error: err.message,
      last_check: new Date().toISOString(),
      consecutive_failures: (healthState.services[serviceName]?.consecutive_failures || 0) + 1,
    };
  }
}

async function checkDatabaseHealth() {
  try {
    await pg.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

async function checkRedisHealth() {
  try {
    const redis = require("../infra/redis");
    const client = redis.getClient ? redis.getClient() : redis;
    await client.ping();
    return true;
  } catch {
    return false;
  }
}

async function checkOllamaHealth() {
  try {
    const response = await fetch("http://127.0.0.1:11434/api/tags", {
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function runSystemHealthChecks() {
  const checks = [
    { name: "database", fn: checkDatabaseHealth },
    { name: "redis", fn: checkRedisHealth },
    { name: "ollama", fn: checkOllamaHealth },
  ];
  
  const results = {};
  for (const check of checks) {
    results[check.name] = await checkServiceHealth(check.name, check.fn);
  }
  
  healthState.services = results;
  healthState.last_updated = new Date().toISOString();
  
  return results;
}

// ─── Agent Coordination ──────────────────────────────────────────────────────

/**
 * Check for agent conflicts (multiple agents trying to do the same thing)
 */
async function detectAgentConflicts() {
  const { rows } = await pg.query(
    `SELECT 
       type,
       COUNT(*) as count,
       array_agg(DISTINCT status) as statuses,
       MIN(created_at) as oldest,
       MAX(created_at) as newest
     FROM tasks
     WHERE status IN ('CREATED', 'DISPATCHED', 'RUNNING')
       AND created_at >= NOW() - INTERVAL '1 hour'
     GROUP BY type
     HAVING COUNT(*) > 3
     ORDER BY count DESC`
  );
  
  const conflicts = [];
  for (const row of rows) {
    if (row.count > 5) {
      conflicts.push({
        type: "duplicate_tasks",
        task_type: row.type,
        count: row.count,
        severity: row.count > 10 ? "high" : "medium",
        message: `${row.count} concurrent tasks of type ${row.type}`,
      });
    }
  }
  
  healthState.conflicts = conflicts;
  return conflicts;
}

/**
 * Get agent execution state with starvation tracking
 */
async function getAgentExecutionState() {
  const { rows } = await pg.query(
    `SELECT 
       payload->>'agent_id' as agent_id,
       COUNT(*) FILTER (WHERE status = 'RUNNING') as running,
       COUNT(*) FILTER (WHERE status = 'CREATED') as pending,
       MAX(created_at) as last_run,
       MAX(CASE WHEN status = 'COMPLETED' THEN created_at END) as last_success
     FROM tasks
     WHERE payload->>'agent_id' IS NOT NULL
       AND created_at >= NOW() - INTERVAL '7 days'
     GROUP BY payload->>'agent_id'`
  );
  
  const agentState = {};
  const now = Date.now();
  
  for (const row of rows) {
    const lastRun = row.last_run ? new Date(row.last_run).getTime() : 0;
    const lastSuccess = row.last_success ? new Date(row.last_success).getTime() : 0;
    const hoursSinceRun = (now - lastRun) / (1000 * 60 * 60);
    const hoursSinceSuccess = lastSuccess ? (now - lastSuccess) / (1000 * 60 * 60) : Infinity;
    
    // Starvation detection: agent hasn't run in X hours
    const starvationLevel = hoursSinceRun >= 48 ? "critical" : 
                           hoursSinceRun >= 24 ? "high" : 
                           hoursSinceRun >= 12 ? "medium" : 
                           hoursSinceRun >= 6 ? "low" : null;
    
    agentState[row.agent_id] = {
      running: Number(row.running || 0),
      pending: Number(row.pending || 0),
      last_run: row.last_run,
      last_success: row.last_success,
      hours_since_run: hoursSinceRun,
      hours_since_success: hoursSinceSuccess,
      starvation_level: starvationLevel,
      needs_priority_boost: starvationLevel !== null,
    };
  }
  
  healthState.agents = agentState;
  return agentState;
}

// ─── Resource Awareness ───────────────────────────────────────────────────────

/**
 * Get current resource utilization
 */
async function getResourceUtilization() {
  const { rows: devices } = await pg.query(
    `SELECT 
       COUNT(*) as total_devices,
       COUNT(*) FILTER (WHERE status IN ('ready', 'busy') AND NOW() - last_heartbeat <= INTERVAL '30 seconds') as online_devices,
       COUNT(*) FILTER (WHERE status IN ('ready', 'busy') AND NOW() - last_heartbeat <= INTERVAL '30 seconds' AND current_jobs_count = 0) as idle_devices,
       AVG(current_jobs_count) FILTER (WHERE status IN ('ready', 'busy') AND NOW() - last_heartbeat <= INTERVAL '30 seconds') as avg_jobs,
       MAX(current_jobs_count) FILTER (WHERE status IN ('ready', 'busy') AND NOW() - last_heartbeat <= INTERVAL '30 seconds') as max_jobs
     FROM device_registry`
  );
  
  const { rows: queue } = await pg.query(
    `SELECT 
       COUNT(*) FILTER (WHERE status = 'CREATED') as created,
       COUNT(*) FILTER (WHERE status = 'DISPATCHED') as dispatched,
       COUNT(*) FILTER (WHERE status = 'RUNNING') as running,
       COUNT(*) FILTER (WHERE status = 'FAILED') as failed
     FROM tasks
     WHERE created_at >= NOW() - INTERVAL '1 hour'`
  );
  
  const online = Number(devices[0]?.online_devices || 0);
  const idle = Number(devices[0]?.idle_devices || 0);
  const busy = Math.max(0, online - idle);
  const utilization = online > 0 ? ((busy / online) * 100).toFixed(1) : "0";

  const resources = {
    devices: {
      total: Number(devices[0]?.total_devices || 0),
      online,
      idle,
      utilization,
      avg_jobs: parseFloat(devices[0]?.avg_jobs || 0),
      max_jobs: Number(devices[0]?.max_jobs || 0),
    },
    queue: {
      created: Number(queue[0]?.created || 0),
      dispatched: Number(queue[0]?.dispatched || 0),
      running: Number(queue[0]?.running || 0),
      failed: Number(queue[0]?.failed || 0),
      total_pending: Number(queue[0]?.created || 0) + Number(queue[0]?.dispatched || 0),
    },
  };
  
  healthState.resources = resources;
  return resources;
}

// ─── Intentional Scheduling ────────────────────────────────────────────────────

/**
 * Determine if an agent should run based on system state
 * Enhanced with predictive scheduling and cross-agent learning
 * 
 * NOTE: This is now async because it checks predictive scheduling and cross-agent learning
 */
async function shouldAgentRun(agentId, agentConfig, systemState) {
  // Check service health
  const criticalServices = ["database", "redis"];
  for (const service of criticalServices) {
    const serviceHealth = systemState.services[service];
    if (serviceHealth?.status !== "healthy") {
      return {
        should_run: false,
        reason: `Critical service ${service} is unhealthy`,
        priority: "high",
      };
    }
  }
  
  // Check for conflicts
  const agentConflicts = systemState.conflicts.filter(c => 
    c.message?.includes(agentId) || c.task_type?.includes(agentId)
  );
  if (agentConflicts.length > 0) {
    return {
      should_run: false,
      reason: `Agent conflicts detected: ${agentConflicts.map(c => c.message).join(", ")}`,
      priority: "medium",
    };
  }
  
  // Check resource availability
  const resources = systemState.resources;
  if (resources?.queue?.total_pending > 100) {
    return {
      should_run: false,
      reason: "Queue backlog too high, wait for processing",
      priority: "medium",
    };
  }
  
  // Check if agent is already running (unless starvation is critical)
  const agentState = systemState.agents[agentId];
  if (agentState?.running > 0) {
    // Allow concurrent run if agent is critically starved
    if (agentState.starvation_level === "critical") {
      return {
        should_run: true,
        reason: `Agent critically starved (${Number(agentState.hours_since_run || 0).toFixed(1)}h since last run) - allowing concurrent execution`,
        priority: "critical",
        starvation_override: true,
      };
    }
    
    return {
      should_run: false,
      reason: `Agent already has ${agentState.running} running task(s)`,
      priority: "low",
    };
  }
  
  // Starvation counter: give priority boost to agents that haven't run
  if (agentState?.needs_priority_boost) {
    return {
      should_run: true,
      reason: `Agent starved (${Number(agentState.hours_since_run || 0).toFixed(1)}h since last run) - priority boost`,
      priority: agentState.starvation_level === "critical" ? "critical" : 
                agentState.starvation_level === "high" ? "high" : "medium",
      starvation_boost: true,
      hours_since_run: agentState.hours_since_run,
    };
  }
  
  // Check predictive scheduling (Golden Window)
  try {
    const { getGoldenWindow } = require("./predictive-scheduler");
    const goldenWindow = await getGoldenWindow(agentId);
    
    if (goldenWindow.should_defer && goldenWindow.best_score > goldenWindow.current_score + 0.1) {
      return {
        should_run: false,
        reason: `Defer to Golden Window (bucket ${goldenWindow.defer_to_bucket}, score ${Number(goldenWindow.best_score || 0).toFixed(2)})`,
        priority: "low",
        defer_to: goldenWindow.defer_to_bucket,
      };
    }
  } catch (err) {
    // Predictive scheduling unavailable, continue with normal checks
    console.warn(`[health-coordinator] Predictive scheduling check failed: ${err.message}`);
  }
  
  // Check cross-agent learning signals
  try {
    const { getRelevantSignals, getAdaptiveThresholds } = require("./cross-agent-learning");
    const relevantSignals = await getRelevantSignals({
      agent_id: agentId,
      lookback_minutes: 30,
    });
    
    // If critical signals detected, might want to adjust behavior
    const criticalSignals = relevantSignals.filter(s => s.priority === "critical");
    if (criticalSignals.length > 0) {
      // Could adjust priority or behavior here
    }
    
    const thresholds = await getAdaptiveThresholds();
    if (thresholds.concurrency_limit === "reduced") {
      // System-wide concurrency reduction active
    }
  } catch (err) {
    // Cross-agent learning unavailable, continue
    console.warn(`[health-coordinator] Cross-agent learning check failed: ${err.message}`);
  }
  
  // All checks passed
  return {
    should_run: true,
    reason: "System healthy, resources available",
    priority: "normal",
  };
}

/**
 * Get recommended agent execution schedule
 * Enhanced with predictive scheduling
 * @param {Object} opts
 * @param {boolean} [opts.useCurrentState] - If true, skip loading from file (use in-memory state from runCoordinationCycle)
 */
async function getRecommendedSchedule(opts = {}) {
  if (!opts.useCurrentState) await loadHealthState();
  const systemState = {
    services: healthState.services,
    conflicts: healthState.conflicts,
    agents: healthState.agents,
    resources: healthState.resources,
  };
  
  const config = JSON.parse(
    await fsp.readFile(path.join(ROOT, "config", "mission-control-agents.json"), "utf8")
  );
  
  const recommendations = [];
  for (const agent of config) {
    const decision = await shouldAgentRun(agent.id, agent, systemState);
    
    // Enhance with Golden Window info
    let goldenWindow = null;
    try {
      const { getGoldenWindow } = require("./predictive-scheduler");
      goldenWindow = await getGoldenWindow(agent.id);
    } catch {
      // Predictive scheduling unavailable
    }
    
    recommendations.push({
      agent_id: agent.id,
      agent_name: agent.name,
      should_run: decision.should_run,
      reason: decision.reason,
      priority: decision.priority,
      cron: agent.cron,
      heartbeat_minutes: agent.heartbeat_minutes,
      golden_window: goldenWindow ? {
        current_score: goldenWindow.current_score,
        best_score: goldenWindow.best_score,
        best_bucket: goldenWindow.best_bucket,
        should_defer: goldenWindow.should_defer,
      } : null,
      defer_to: decision.defer_to || null,
    });
  }
  
  healthState.recommendations = recommendations;
  await saveHealthState();
  
  return recommendations;
}

// ─── Self-Healing Actions ─────────────────────────────────────────────────────

/**
 * Generate self-healing recommendations
 */
async function generateHealingRecommendations() {
  const recommendations = [];
  
  // Check service health
  for (const [service, health] of Object.entries(healthState.services || {})) {
    if (health.status !== "healthy" && health.consecutive_failures >= 3) {
      recommendations.push({
        type: "service_recovery",
        service,
        action: `Recover ${service} service`,
        priority: "high",
        consecutive_failures: health.consecutive_failures,
      });
    }
  }
  
  // Check resource utilization
  const resources = healthState.resources;
  if (resources?.devices?.idle > 0 && resources?.queue?.total_pending < 10) {
    recommendations.push({
      type: "work_generation",
      action: "Generate work for idle devices",
      priority: "medium",
      idle_devices: resources.devices.idle,
    });
  }
  
  // Check conflicts
  for (const conflict of healthState.conflicts || []) {
    if (conflict.severity === "high") {
      recommendations.push({
        type: "conflict_resolution",
        action: `Resolve conflict: ${conflict.message}`,
        priority: "high",
        conflict,
      });
    }
  }
  
  return recommendations;
}

// ─── State Management ─────────────────────────────────────────────────────────

async function loadHealthState() {
  try {
    const data = await fsp.readFile(HEALTH_STATE_FILE, "utf8");
    healthState = JSON.parse(data);
  } catch {
    // Initialize with default state
    healthState = {
      last_updated: null,
      services: {},
      agents: {},
      resources: {},
      conflicts: [],
      recommendations: [],
    };
  }
}

async function saveHealthState() {
  // Use atomic write to prevent race conditions
  await atomicWriteJSON(HEALTH_STATE_FILE, healthState);
}

// ─── Main Coordination Cycle ──────────────────────────────────────────────────

async function runCoordinationCycle() {
  console.log("[health-coordinator] Starting coordination cycle...");
  
  // 1. Check system health
  await runSystemHealthChecks();
  
  // 2. Check agent conflicts
  await detectAgentConflicts();
  
  // 3. Get agent execution state
  await getAgentExecutionState();
  
  // 4. Get resource utilization
  await getResourceUtilization();
  
  // 5. Generate recommendations (use current state - do not reload from file)
  const schedule = await getRecommendedSchedule({ useCurrentState: true });
  const healing = await generateHealingRecommendations();
  
  // 6. Save state
  await saveHealthState();
  
  return {
    services: healthState.services,
    conflicts: healthState.conflicts,
    agents: healthState.agents,
    resources: healthState.resources,
    schedule_recommendations: schedule,
    healing_recommendations: healing,
  };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  runCoordinationCycle,
  runSystemHealthChecks,
  detectAgentConflicts,
  getAgentExecutionState,
  getResourceUtilization,
  shouldAgentRun,
  getRecommendedSchedule,
  generateHealingRecommendations,
  loadHealthState,
  saveHealthState,
  getHealthState: () => healthState,
};
