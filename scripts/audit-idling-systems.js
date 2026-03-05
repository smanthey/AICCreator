#!/usr/bin/env node
"use strict";

/**
 * scripts/audit-idling-systems.js
 * 
 * Comprehensive audit to identify idling/stalled systems:
 * 1. Observer Stalling (Research agents collecting unused data)
 * 2. Self-Healing Deadlock (Healers waiting for errors that never come)
 * 3. Middleware/Dispatcher Traffic Jams (Agents never running)
 * 4. Log Rot (State files growing too large)
 */

require("dotenv").config({ override: true });

const pg = require("../infra/postgres");
const fsp = require("fs/promises");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");

// Import audit modules
const { findZombieAgents, pruneStateFiles } = require("./vacuum-state");
const { getRedundancyReport } = require("../control/consumer-driven-research");
const { validateAllServices, needsHealing } = require("../control/heartbeat-validator");
const { getAgentExecutionState } = require("../control/system-health-coordinator");

async function auditObserverStalling() {
  console.log("\n" + "=".repeat(60));
  console.log("AUDIT 1: Observer Stalling (Research Agents)");
  console.log("=".repeat(60));
  
  const report = await getRedundancyReport();
  
  console.log(`Total research agents: ${report.total_agents}`);
  console.log(`Active agents: ${report.active_agents.length}`);
  console.log(`Redundant agents: ${report.redundant_agents.length}`);
  
  if (report.redundant_agents.length > 0) {
    console.log("\n⚠️  REDUNDANT RESEARCH AGENTS (no consumer demand):");
    for (const agent of report.redundant_agents) {
      console.log(`  - ${agent.name} (${agent.agent_id})`);
      console.log(`    Days unused: ${agent.consumption_state.days_unused}`);
      console.log(`    Reason: ${agent.reason}`);
    }
  }
  
  return report;
}

async function auditSelfHealingDeadlock() {
  console.log("\n" + "=".repeat(60));
  console.log("AUDIT 2: Self-Healing Deadlock");
  console.log("=".repeat(60));
  
  const validations = await validateAllServices();
  const issues = [];
  
  for (const [serviceId, result] of Object.entries(validations)) {
    if (needsHealing(result)) {
      issues.push({
        service: serviceId,
        service_name: result.service_name,
        reason: result.reason,
        healthy: result.healthy,
      });
      
      console.log(`❌ ${result.service_name} needs healing:`);
      console.log(`   Reason: ${result.reason}`);
    } else {
      console.log(`✅ ${result.service_name} is healthy`);
    }
  }
  
  if (issues.length === 0) {
    console.log("\n✅ All services healthy (no deadlock detected)");
  } else {
    console.log(`\n⚠️  ${issues.length} service(s) need healing`);
  }
  
  return { issues, validations };
}

async function auditTrafficJams() {
  console.log("\n" + "=".repeat(60));
  console.log("AUDIT 3: Middleware/Dispatcher Traffic Jams");
  console.log("=".repeat(60));
  
  // Get agent execution state
  const { getHealthState } = require("../control/system-health-coordinator");
  const healthState = getHealthState();
  await getAgentExecutionState(); // Refresh state
  
  const agentState = healthState.agents || {};
  const starvedAgents = [];
  
  // Load mission control agents config
  const configPath = path.join(ROOT, "config", "mission-control-agents.json");
  let missionControlAgents = [];
  try {
    const configData = await fsp.readFile(configPath, "utf8");
    missionControlAgents = JSON.parse(configData);
  } catch {
    console.warn("Could not load mission-control-agents.json");
  }
  
  console.log(`Checking ${missionControlAgents.length} mission control agents...`);
  
  for (const agent of missionControlAgents) {
    const state = agentState[agent.id];
    if (!state) {
      starvedAgents.push({
        agent_id: agent.id,
        agent_name: agent.name,
        hours_since_run: Infinity,
        starvation_level: "unknown",
        reason: "No tasks found in last 7 days",
      });
      continue;
    }
    
    if (state.needs_priority_boost) {
      starvedAgents.push({
        agent_id: agent.id,
        agent_name: agent.name,
        hours_since_run: state.hours_since_run,
        hours_since_success: state.hours_since_success,
        starvation_level: state.starvation_level,
        last_run: state.last_run,
        last_success: state.last_success,
      });
    }
  }
  
  if (starvedAgents.length > 0) {
    console.log(`\n⚠️  STARVED AGENTS (haven't run in 6+ hours):`);
    for (const agent of starvedAgents) {
      console.log(`  - ${agent.agent_name} (${agent.agent_id})`);
      console.log(`    Hours since run: ${agent.hours_since_run.toFixed(1)}`);
      if (agent.hours_since_success !== Infinity) {
        console.log(`    Hours since success: ${agent.hours_since_success.toFixed(1)}`);
      }
      console.log(`    Starvation level: ${agent.starvation_level}`);
    }
  } else {
    console.log("\n✅ No starved agents detected");
  }
  
  return { starvedAgents, totalAgents: missionControlAgents.length };
}

async function auditLogRot() {
  console.log("\n" + "=".repeat(60));
  console.log("AUDIT 4: Log Rot (State File Growth)");
  console.log("=".repeat(60));
  
  const pruning = await pruneStateFiles();
  
  console.log(`Total state files: ${pruning.total_files}`);
  console.log(`Files archived: ${pruning.archived}`);
  console.log(`Large active files: ${pruning.large_files}`);
  
  if (pruning.large_files > 0) {
    console.log("\n⚠️  Large active state files detected - agents may be slow");
  }
  
  return pruning;
}

async function auditZombieAgents() {
  console.log("\n" + "=".repeat(60));
  console.log("AUDIT 5: Zombie Agents (No Success in 7 Days)");
  console.log("=".repeat(60));
  
  const zombies = await findZombieAgents(7);
  
  if (zombies.length > 0) {
    console.log(`\n⚠️  ZOMBIE AGENTS (no success in 7+ days):`);
    for (const zombie of zombies) {
      console.log(`  - ${zombie.agent_id} (${zombie.task_type})`);
      console.log(`    Days since success: ${zombie.days_since_success.toFixed(1)}`);
      console.log(`    Total tasks: ${zombie.total_tasks} (${zombie.success_count} success, ${zombie.failure_count} failed)`);
    }
  } else {
    console.log("\n✅ No zombie agents detected");
  }
  
  return zombies;
}

async function main() {
  console.log("=".repeat(60));
  console.log("IDLING SYSTEMS AUDIT");
  console.log("=".repeat(60));
  console.log(`Started at: ${new Date().toISOString()}\n`);
  
  const results = {
    observer_stalling: null,
    self_healing_deadlock: null,
    traffic_jams: null,
    log_rot: null,
    zombie_agents: null,
  };
  
  try {
    // Run all audits
    results.observer_stalling = await auditObserverStalling();
    results.self_healing_deadlock = await auditSelfHealingDeadlock();
    results.traffic_jams = await auditTrafficJams();
    results.log_rot = await auditLogRot();
    results.zombie_agents = await auditZombieAgents();
    
    // Summary
    console.log("\n" + "=".repeat(60));
    console.log("AUDIT SUMMARY");
    console.log("=".repeat(60));
    
    const issues = {
      redundant_research: results.observer_stalling.redundant_agents.length,
      services_needing_healing: results.self_healing_deadlock.issues.length,
      starved_agents: results.traffic_jams.starvedAgents.length,
      large_state_files: results.log_rot.large_files,
      zombie_agents: results.zombie_agents.length,
    };
    
    const totalIssues = Object.values(issues).reduce((a, b) => a + b, 0);
    
    console.log(`Redundant research agents: ${issues.redundant_research}`);
    console.log(`Services needing healing: ${issues.services_needing_healing}`);
    console.log(`Starved agents: ${issues.starved_agents}`);
    console.log(`Large state files: ${issues.large_state_files}`);
    console.log(`Zombie agents: ${issues.zombie_agents}`);
    console.log(`\nTotal issues found: ${totalIssues}`);
    
    if (totalIssues === 0) {
      console.log("\n✅ No idling/stalled systems detected!");
    } else {
      console.log("\n⚠️  Issues detected - review details above");
    }
    
  } catch (err) {
    console.error("\n[audit] Fatal error:", err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await pg.end().catch(() => {});
  }
  
  return results;
}

if (require.main === module) {
  main()
    .then(() => {
      console.log("\n[audit] Complete");
      process.exit(0);
    })
    .catch((err) => {
      console.error("[audit] Fatal:", err);
      process.exit(1);
    });
}

module.exports = { main };
