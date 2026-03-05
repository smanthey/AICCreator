"use strict";

/**
 * control/research-coordinator.js
 * 
 * Coordinates all research and automation systems to prevent conflicts
 * and ensure intentional, coordinated execution.
 * 
 * Based on 60 days of experience:
 * - Prevents duplicate research runs
 * - Coordinates research timing
 * - Prioritizes research based on system state
 * - Ensures research feeds into actionable improvements
 */

const pg = require("../infra/postgres");
const fsp = require("fs/promises");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const RESEARCH_STATE_FILE = path.join(ROOT, "agent-state", "research-coordinator-state.json");
const { atomicWriteJSON, atomicReadModifyWrite } = require("./atomic-state");

// Research systems registry
const RESEARCH_SYSTEMS = {
  proactive_research: {
    script: "scripts/proactive-research-assistant.js",
    frequency: "*/30 * * * *", // Every 30 minutes
    priority: 3,
    dependencies: ["database", "ollama"],
    resource_tags: ["ai"],
  },
  research_sync: {
    script: "npm run -s research:sync",
    frequency: "20 * * * *", // Hourly at :20
    priority: 2,
    dependencies: ["database"],
    resource_tags: ["io_heavy"],
  },
  research_signals: {
    script: "npm run -s research:signals",
    frequency: "40 * * * *", // Hourly at :40
    priority: 2,
    dependencies: ["database"],
    resource_tags: ["io_heavy"],
  },
  affiliate_research: {
    script: "npm run -s affiliate:research",
    frequency: "50 */2 * * *", // Every 2 hours at :50
    priority: 1,
    dependencies: ["database"],
    resource_tags: ["io_heavy"],
  },
  bot_research: {
    script: "node scripts/bot-autonomous-agent.js run",
    frequency: "0 */4 * * *", // Every 4 hours
    priority: 4,
    dependencies: ["database", "ollama"],
    resource_tags: ["ai"],
  },
};

// Research state
let researchState = {
  last_updated: null,
  last_runs: {},
  next_runs: {},
  conflicts: [],
  priorities: {},
};

// ─── Conflict Detection ───────────────────────────────────────────────────────

async function detectResearchConflicts() {
  const { rows } = await pg.query(
    `SELECT 
       type,
       COUNT(*) as count,
       array_agg(id) as task_ids,
       MIN(created_at) as oldest,
       MAX(created_at) as newest
     FROM tasks
     WHERE type IN ('research_sync', 'research_signals', 'affiliate_research')
       AND status IN ('CREATED', 'DISPATCHED', 'RUNNING')
       AND created_at >= NOW() - INTERVAL '1 hour'
     GROUP BY type
     HAVING COUNT(*) > 1`
  );
  
  const conflicts = [];
  for (const row of rows) {
    conflicts.push({
      type: row.type,
      count: row.count,
      task_ids: row.task_ids,
      severity: row.count > 3 ? "high" : "medium",
      message: `${row.count} concurrent ${row.type} tasks`,
    });
  }
  
  researchState.conflicts = conflicts;
  return conflicts;
}

// ─── Research Prioritization ─────────────────────────────────────────────────

/**
 * Determine research priorities based on system state and recent results
 */
async function calculateResearchPriorities() {
  const priorities = {};
  
  // Check last run times
  for (const [systemId, system] of Object.entries(RESEARCH_SYSTEMS)) {
    const lastRun = researchState.last_runs[systemId];
    const now = Date.now();
    const lastRunTime = lastRun ? new Date(lastRun).getTime() : 0;
    const ageMinutes = (now - lastRunTime) / 60000;
    
    // Calculate priority based on age and system priority
    let priority = system.priority;
    
    // Boost priority if it's been a while
    if (ageMinutes > 120) priority += 2;
    if (ageMinutes > 240) priority += 3;
    
    // Reduce priority if run recently
    if (ageMinutes < 30) priority = Math.max(1, priority - 2);
    
    priorities[systemId] = {
      base_priority: system.priority,
      calculated_priority: priority,
      age_minutes: ageMinutes,
      should_run: ageMinutes >= 30, // Don't run if executed in last 30 min
    };
  }
  
  researchState.priorities = priorities;
  return priorities;
}

// ─── Intentional Scheduling ───────────────────────────────────────────────────

/**
 * Get recommended research execution schedule
 */
async function getResearchSchedule() {
  await loadResearchState();
  
  // Check for conflicts
  const conflicts = await detectResearchConflicts();
  
  // Calculate priorities
  const priorities = await calculateResearchPriorities();
  
  // Get system health
  const { getHealthState } = require("./system-health-coordinator");
  const healthState = getHealthState();
  
  const schedule = [];
  for (const [systemId, system] of Object.entries(RESEARCH_SYSTEMS)) {
    const priority = priorities[systemId];
    const hasConflict = conflicts.some(c => c.type === systemId || c.type === system.script);
    
    // Check dependencies
    const depsHealthy = system.dependencies.every(dep => 
      healthState.services?.[dep]?.status === "healthy"
    );
    
    if (!depsHealthy) {
      schedule.push({
        system_id: systemId,
        should_run: false,
        reason: `Dependencies unhealthy: ${system.dependencies.join(", ")}`,
        priority: 0,
      });
      continue;
    }
    
    if (hasConflict) {
      schedule.push({
        system_id: systemId,
        should_run: false,
        reason: "Conflict detected",
        priority: 0,
      });
      continue;
    }
    
    schedule.push({
      system_id: systemId,
      should_run: priority.should_run && !hasConflict,
      reason: priority.should_run ? "Ready to run" : `Too soon (${priority.age_minutes.toFixed(0)}m ago)`,
      priority: priority.calculated_priority,
      script: system.script,
      resource_tags: system.resource_tags,
    });
  }
  
  // Sort by priority
  schedule.sort((a, b) => b.priority - a.priority);
  
  return schedule;
}

// ─── Research Execution Tracking ──────────────────────────────────────────────

async function recordResearchRun(systemId, success, result = {}) {
  researchState.last_runs[systemId] = new Date().toISOString();
  researchState.last_updated = new Date().toISOString();
  
  // Calculate next run time based on frequency
  const system = RESEARCH_SYSTEMS[systemId];
  if (system) {
    // Simple calculation: add interval based on frequency pattern
    const nextRun = new Date();
    if (system.frequency.includes("*/30")) {
      nextRun.setMinutes(nextRun.getMinutes() + 30);
    } else if (system.frequency.includes("*/2")) {
      nextRun.setHours(nextRun.getHours() + 2);
    } else if (system.frequency.includes("*/4")) {
      nextRun.setHours(nextRun.getHours() + 4);
    } else {
      nextRun.setHours(nextRun.getHours() + 1);
    }
    researchState.next_runs[systemId] = nextRun.toISOString();
  }
  
  await saveResearchState();
}

// ─── State Management ───────────────────────────────────────────────────────

async function loadResearchState() {
  try {
    const data = await fsp.readFile(RESEARCH_STATE_FILE, "utf8");
    researchState = JSON.parse(data);
  } catch {
    // Initialize with default state
    researchState = {
      last_updated: null,
      last_runs: {},
      next_runs: {},
      conflicts: [],
      priorities: {},
    };
  }
}

async function saveResearchState() {
  // Use atomic write to prevent race conditions
  await atomicWriteJSON(RESEARCH_STATE_FILE, researchState);
}

// ─── Main Coordination ───────────────────────────────────────────────────────

async function runResearchCoordination() {
  console.log("[research-coordinator] Starting research coordination...");
  
  await loadResearchState();
  
  const conflicts = await detectResearchConflicts();
  const priorities = await calculateResearchPriorities();
  const schedule = await getResearchSchedule();
  
  await saveResearchState();
  
  return {
    conflicts,
    priorities,
    schedule,
    last_runs: researchState.last_runs,
    next_runs: researchState.next_runs,
  };
}

module.exports = {
  runResearchCoordination,
  detectResearchConflicts,
  calculateResearchPriorities,
  getResearchSchedule,
  recordResearchRun,
  loadResearchState,
  getResearchState: () => researchState,
};
