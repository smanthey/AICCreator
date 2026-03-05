"use strict";

/**
 * control/entropy-monitor.js
 * 
 * Infinite Loop Kill-Switch - Entropy Monitoring
 * 
 * Problem: Local models occasionally get stuck in "Repetition Loops" (e.g., generating
 * `................` forever). Since you aren't paying for tokens, you might not notice
 * until CPU is at 100% for 5 hours.
 * 
 * Solution: Output Stagnation detection. If an agent hasn't updated its state.json in
 * 3 minutes but the process is using >50% CPU, Force Restart Ollama.
 */

const { execSync } = require("child_process");
const fsp = require("fs/promises");
const path = require("path");
const pg = require("../infra/postgres");

const ROOT = path.join(__dirname, "..");
const STATE_ROOT = path.join(ROOT, "agent-state");

// Configuration
const STAGNATION_THRESHOLD_MS = 3 * 60 * 1000; // 3 minutes
const CPU_THRESHOLD_PERCENT = 50; // 50% CPU
const CHECK_INTERVAL_MS = 60000; // Check every minute

// Track process state
let processState = {};

/**
 * Get CPU usage for a process (percentage)
 */
function getProcessCPU(pid) {
  try {
    // Use ps: -o %cpu= suppresses header (works on macOS/BSD and Linux)
    const output = execSync(`ps -p ${pid} -o %cpu=`, { encoding: "utf8", timeout: 5000 });
    return parseFloat(output.trim()) || 0;
  } catch {
    return 0;
  }
}

/**
 * Check if a state file has been updated recently
 */
async function checkStateFileFreshness(agentId) {
  const stateFiles = [
    path.join(STATE_ROOT, "agents", agentId, "memory", `${new Date().toISOString().split("T")[0]}.md`),
    path.join(STATE_ROOT, "system-health-state.json"),
  ];
  
  let mostRecent = 0;
  for (const file of stateFiles) {
    try {
      const stats = await fsp.stat(file);
      mostRecent = Math.max(mostRecent, stats.mtimeMs);
    } catch {
      // File doesn't exist, that's okay
    }
  }
  
  return {
    last_update_ms: mostRecent,
    age_ms: Date.now() - mostRecent,
    is_stale: Date.now() - mostRecent > STAGNATION_THRESHOLD_MS,
  };
}

/**
 * Check for running tasks that might be stuck
 */
async function checkStuckTasks() {
  const { rows } = await pg.query(
    `SELECT 
       id,
       type,
       payload->>'agent_id' as agent_id,
       status,
       created_at,
       updated_at,
       EXTRACT(EPOCH FROM (NOW() - updated_at)) * 1000 as age_ms
     FROM tasks
     WHERE status = 'RUNNING'
       AND updated_at < NOW() - INTERVAL '3 minutes'
     ORDER BY updated_at ASC`
  );
  
  const stuck = [];
  for (const row of rows) {
    // Try to find process ID from payload or system
    const agentId = row.agent_id || row.type;
    const stateCheck = await checkStateFileFreshness(agentId);
    
    if (stateCheck.is_stale) {
      stuck.push({
        task_id: row.id,
        task_type: row.type,
        agent_id: agentId,
        age_ms: row.age_ms,
        state_stale: stateCheck.is_stale,
        last_state_update: new Date(stateCheck.last_update_ms).toISOString(),
      });
    }
  }
  
  return stuck;
}

/**
 * Check Ollama process for high CPU usage
 */
async function checkOllamaHealth() {
  try {
    // Find Ollama process
    const output = execSync("pgrep -f ollama | head -1", { encoding: "utf8", timeout: 5000 });
    const pid = parseInt(output.trim());
    
    if (!pid) {
      return {
        ollama_running: false,
        needs_restart: false,
      };
    }
    
    const cpu = getProcessCPU(pid);
    const highCPU = cpu > CPU_THRESHOLD_PERCENT;
    
    return {
      ollama_running: true,
      pid,
      cpu_percent: cpu,
      high_cpu: highCPU,
      needs_restart: highCPU, // Restart if CPU is high (might be stuck)
    };
  } catch {
    return {
      ollama_running: false,
      needs_restart: false,
    };
  }
}

/**
 * Restart Ollama service
 */
async function restartOllama() {
  console.log("[entropy-monitor] Restarting Ollama due to high CPU/stagnation...");
  
  try {
    // Try PM2 restart first
    try {
      execSync("pm2 restart claw-ollama", { encoding: "utf8", timeout: 10000 });
      console.log("[entropy-monitor] Ollama restarted via PM2");
      return { restarted: true, method: "pm2" };
    } catch {
      // PM2 not available, try systemctl
      try {
        execSync("systemctl restart ollama", { encoding: "utf8", timeout: 10000 });
        console.log("[entropy-monitor] Ollama restarted via systemctl");
        return { restarted: true, method: "systemctl" };
      } catch {
        // Last resort: kill and let it restart
        execSync("pkill -9 ollama", { encoding: "utf8", timeout: 5000 });
        console.log("[entropy-monitor] Ollama process killed (will restart automatically)");
        return { restarted: true, method: "kill" };
      }
    }
  } catch (err) {
    console.error("[entropy-monitor] Failed to restart Ollama:", err.message);
    return { restarted: false, error: err.message };
  }
}

/**
 * Monitor for entropy issues and take action
 */
async function monitorEntropy() {
  const results = {
    stuck_tasks: [],
    ollama_health: null,
    actions_taken: [],
  };
  
  // Check for stuck tasks
  const stuckTasks = await checkStuckTasks();
  results.stuck_tasks = stuckTasks;
  
  if (stuckTasks.length > 0) {
    console.warn(`[entropy-monitor] Found ${stuckTasks.length} stuck task(s)`);
    for (const task of stuckTasks) {
      console.warn(`  - Task ${task.task_id} (${task.task_type}): ${(task.age_ms / 1000 / 60).toFixed(1)} minutes old`);
    }
  }
  
  // Check Ollama health
  const ollamaHealth = await checkOllamaHealth();
  results.ollama_health = ollamaHealth;
  
  if (ollamaHealth.needs_restart) {
    console.warn(`[entropy-monitor] Ollama CPU at ${Number(ollamaHealth.cpu_percent || 0).toFixed(1)}% - restarting`);
    const restartResult = await restartOllama();
    results.actions_taken.push({
      action: "restart_ollama",
      reason: `High CPU usage (${Number(ollamaHealth.cpu_percent || 0).toFixed(1)}%)`,
      result: restartResult,
    });
  }
  
  // If we have stuck tasks AND high CPU, definitely restart
  if (stuckTasks.length > 0 && ollamaHealth.high_cpu) {
    if (!ollamaHealth.needs_restart) {
      // Restart wasn't triggered by CPU alone, but we have stuck tasks
      console.warn("[entropy-monitor] Stuck tasks + high CPU detected - forcing Ollama restart");
      const restartResult = await restartOllama();
      results.actions_taken.push({
        action: "restart_ollama",
        reason: `Stuck tasks (${stuckTasks.length}) + high CPU (${Number(ollamaHealth.cpu_percent || 0).toFixed(1)}%)`,
        result: restartResult,
      });
    }
  }
  
  return results;
}

module.exports = {
  monitorEntropy,
  checkStuckTasks,
  checkOllamaHealth,
  restartOllama,
  STAGNATION_THRESHOLD_MS,
  CPU_THRESHOLD_PERCENT,
};
