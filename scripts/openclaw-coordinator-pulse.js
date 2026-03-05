#!/usr/bin/env node
"use strict";

/**
 * scripts/openclaw-coordinator-pulse.js
 * 
 * Main coordination pulse for OpenClaw system.
 * Runs every 5 minutes to:
 * - Coordinate all agents
 * - Prevent conflicts
 * - Ensure intentional scheduling
 * - Apply self-healing
 * - Coordinate research
 * 
 * Based on 60 days of operational experience.
 */

require("dotenv").config({ override: true });

const {
  runCoordinationCycle,
  getRecommendedSchedule,
  generateHealingRecommendations,
} = require("../control/system-health-coordinator");

const {
  runResearchCoordination,
  getResearchSchedule,
} = require("../control/research-coordinator");

const {
  updateScheduleWeights,
} = require("../control/predictive-scheduler");

const {
  crossPollinateSignals,
  getAdaptiveThresholds,
} = require("../control/cross-agent-learning");

const {
  runAmbassadorCycle,
} = require("../control/ambassador-agent");

const {
  getBudgetState,
  shouldThrottle,
} = require("../control/cost-coordinator");

const {
  monitorEntropy,
} = require("../control/entropy-monitor");

const {
  pruneAllAgents,
} = require("../control/context-pruner");

const pg = require("../infra/postgres");

async function main() {
  console.log(`[openclaw-coordinator] Starting pulse at ${new Date().toISOString()}`);
  
  try {
    // 1. Run system health coordination
    console.log("\n[1/3] System Health Coordination...");
    const healthState = await runCoordinationCycle();
    
    console.log(`  Services: ${Object.values(healthState.services).filter(s => s.status === "healthy").length}/${Object.keys(healthState.services).length} healthy`);
    console.log(`  Conflicts: ${healthState.conflicts.length}`);
    console.log(`  Device utilization: ${healthState.resources?.devices?.utilization || 0}%`);
    
    // 2. Run research coordination
    console.log("\n[2/3] Research Coordination...");
    const researchState = await runResearchCoordination();
    
    console.log(`  Research conflicts: ${researchState.conflicts.length}`);
    console.log(`  Scheduled systems: ${researchState.schedule.filter(s => s.should_run).length}/${researchState.schedule.length}`);
    
    // 3. Update predictive scheduling weights
    console.log("\n[3/5] Updating Predictive Scheduling...");
    try {
      await updateScheduleWeights();
      console.log("  Predictive weights updated");
    } catch (err) {
      console.warn(`  Predictive scheduling update failed: ${err.message}`);
    }
    
    // 4. Cross-agent learning
    console.log("\n[4/5] Cross-Agent Learning...");
    let crossPollinationActions = [];
    let adaptiveThresholds = {};
    try {
      crossPollinationActions = await crossPollinateSignals();
      adaptiveThresholds = await getAdaptiveThresholds();
      console.log(`  Cross-pollination actions: ${crossPollinationActions.length}`);
      if (Object.keys(adaptiveThresholds).length > 0) {
        console.log(`  Adaptive thresholds: ${JSON.stringify(adaptiveThresholds)}`);
      }
    } catch (err) {
      console.warn(`  Cross-agent learning failed: ${err.message}`);
    }
    
    // 5. Generate recommendations
    console.log("\n[5/6] Generating Recommendations...");
    const agentSchedule = await getRecommendedSchedule();
    const healingActions = await generateHealingRecommendations();
    
    const shouldRunAgents = agentSchedule.filter(a => a.should_run);
    const shouldNotRunAgents = agentSchedule.filter(a => !a.should_run);
    
    console.log(`  Agents ready to run: ${shouldRunAgents.length}`);
    console.log(`  Agents blocked: ${shouldNotRunAgents.length}`);
    console.log(`  Healing actions: ${healingActions.length}`);
    
    // Log blocked agents with reasons
    if (shouldNotRunAgents.length > 0) {
      console.log("\n  Blocked agents:");
      shouldNotRunAgents.slice(0, 5).forEach(agent => {
        console.log(`    - ${agent.agent_name}: ${agent.reason}`);
      });
    }
    
    // Log healing recommendations
    if (healingActions.length > 0) {
      console.log("\n  Healing recommendations:");
      healingActions.forEach(action => {
        console.log(`    - [${action.priority}] ${action.action}`);
      });
    }
    
    // 6. Budget & Ambassador (Economic Metabolism + Human-in-the-Loop)
    console.log("\n[6/7] Budget & Ambassador...");
    const budgetState = await getBudgetState();
    const throttleState = await shouldThrottle();
    
    console.log(`  Daily spend: $${Number(budgetState.daily_spent || 0).toFixed(2)} / $${Number(budgetState.daily_cap || 0).toFixed(2)} (${Number(budgetState.daily_percentage || 0).toFixed(1)}%)`);
    console.log(`  Throttle level: ${throttleState.level}`);
    if (budgetState.blocked_requests > 0) {
      console.log(`  Blocked requests today: ${budgetState.blocked_requests}`);
    }
    
    // Run Ambassador Agent to send human-readable briefs
    const ambassadorResult = await runAmbassadorCycle(
      {
        ...healthState,
        schedule_recommendations: agentSchedule,
      },
      budgetState
    );
    
    console.log(`  Ambassador briefs sent: ${ambassadorResult.sent}`);
    
    // 7. Vertical Stability (Context Pruning + Entropy Monitoring)
    console.log("\n[7/7] Vertical Stability...");
    
    // Entropy monitoring (check for stuck processes)
    try {
      const entropyResult = await monitorEntropy();
      if (entropyResult.stuck_tasks.length > 0) {
        console.log(`  ⚠️  Stuck tasks: ${entropyResult.stuck_tasks.length}`);
      }
      if (entropyResult.actions_taken.length > 0) {
        console.log(`  🔧 Actions taken: ${entropyResult.actions_taken.length}`);
        entropyResult.actions_taken.forEach(action => {
          console.log(`    - ${action.action}: ${action.reason}`);
        });
      }
    } catch (err) {
      console.warn(`  Entropy monitoring failed: ${err.message}`);
    }
    
    // Context pruning (weekly, or if needed)
    const dayOfWeek = new Date().getDay();
    if (dayOfWeek === 0) { // Sunday
      try {
        console.log("  Running weekly context pruning...");
        const pruneResults = await pruneAllAgents();
        const pruned = pruneResults.filter(r => r.pruned).length;
        if (pruned > 0) {
          console.log(`  ✅ Pruned ${pruned} agent context(s)`);
        }
      } catch (err) {
        console.warn(`  Context pruning failed: ${err.message}`);
      }
    }
    
    console.log("\n[openclaw-coordinator] Pulse complete");
    
    return {
      health: healthState,
      research: researchState,
      agent_schedule: agentSchedule,
      healing_actions: healingActions,
      cross_pollination: crossPollinationActions,
      adaptive_thresholds: adaptiveThresholds,
      budget: budgetState,
      throttle: throttleState,
      ambassador: ambassadorResult,
    };
  } catch (err) {
    console.error(`[openclaw-coordinator] Error:`, err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await pg.end().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[openclaw-coordinator] Fatal:", err);
    process.exit(1);
  });
}

module.exports = { main };
