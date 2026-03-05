"use strict";

/**
 * control/consumer-driven-research.js
 * 
 * Consumer-Driven Execution for Research Agents
 * 
 * Problem: Research agents constantly scrape/monitor feeds, filling databases
 * that no one reads. If Action agents aren't consuming that data, the Research
 * agent is just wasting resources.
 * 
 * Solution: Research agents sleep until an Action agent explicitly requests a
 * "Context Refresh." If no one has asked for data in 24 hours, flag the Research
 * agent as "Redundant."
 */

const pg = require("../infra/postgres");
const redis = require("../infra/redis");
const fsp = require("fs/promises");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CONSUMER_STATE_FILE = path.join(ROOT, "agent-state", "consumer-driven-research-state.json");

// Research agent definitions
const RESEARCH_AGENTS = {
  research_analysis: {
    name: "Research and Analysis Agent",
    data_tables: ["content_items", "external_update_signals", "github_repo_violations"],
    consumer_agents: ["saas_development", "content_writing", "marketing_social"],
  },
  research_sync: {
    name: "Research Sync",
    data_tables: ["content_items", "external_update_signals"],
    consumer_agents: ["content_writing", "saas_development"],
  },
  research_signals: {
    name: "Research Signals",
    data_tables: ["external_update_signals"],
    consumer_agents: ["saas_development", "opportunities_scout"],
  },
  affiliate_research: {
    name: "Affiliate Research",
    data_tables: ["external_update_signals"],
    consumer_agents: ["marketing_social", "content_writing"],
  },
  bot_research: {
    name: "Bot Research",
    data_tables: ["bot_discovery_log"],
    consumer_agents: ["bot_collection_autonomous"],
  },
};

// State tracking
let consumerState = {
  last_requests: {}, // agent_id -> { research_agent, requested_at, consumed_at }
  last_runs: {}, // research_agent -> last_run_at
  redundancy_flags: {}, // research_agent -> { flagged_at, days_unused }
};

/**
 * Load consumer state
 */
async function loadConsumerState() {
  try {
    const data = await fsp.readFile(CONSUMER_STATE_FILE, "utf8");
    consumerState = JSON.parse(data);
  } catch {
    consumerState = {
      last_requests: {},
      last_runs: {},
      redundancy_flags: {},
    };
  }
}

/**
 * Save consumer state
 */
async function saveConsumerState() {
  await fsp.mkdir(path.dirname(CONSUMER_STATE_FILE), { recursive: true });
  await fsp.writeFile(CONSUMER_STATE_FILE, JSON.stringify(consumerState, null, 2));
}

/**
 * Check if research data has been consumed recently
 */
async function checkDataConsumption(researchAgentId) {
  const agent = RESEARCH_AGENTS[researchAgentId];
  if (!agent) return { consumed: false, reason: "unknown_agent" };
  
  // Check if any consumer agent has queried the data tables in last 24 hours
  const { rows } = await pg.query(
    `SELECT 
       payload->>'agent_id' as agent_id,
       type,
       MAX(created_at) as last_query
     FROM tasks
     WHERE payload->>'agent_id' = ANY($1::text[])
       AND created_at >= NOW() - INTERVAL '24 hours'
       AND status = 'COMPLETED'
     GROUP BY payload->>'agent_id', type
     ORDER BY MAX(created_at) DESC`,
    [agent.consumer_agents]
  );
  
  if (rows.length === 0) {
    return {
      consumed: false,
      reason: "no_consumer_activity",
      days_unused: 1,
    };
  }
  
  const mostRecent = rows[0];
  const hoursSince = (Date.now() - new Date(mostRecent.last_query).getTime()) / (1000 * 60 * 60);
  
  return {
    consumed: hoursSince < 24,
    last_consumer: mostRecent.agent_id,
    hours_since_consumption: hoursSince,
    days_unused: hoursSince >= 24 ? Math.floor(hoursSince / 24) : 0,
  };
}

/**
 * Request context refresh from a research agent
 * Called by Action agents when they need fresh data
 */
async function requestContextRefresh(consumerAgentId, researchAgentId, context = {}) {
  await loadConsumerState();
  
  const key = `${consumerAgentId}:${researchAgentId}`;
  consumerState.last_requests[key] = {
    consumer_agent: consumerAgentId,
    research_agent: researchAgentId,
    requested_at: new Date().toISOString(),
    context,
  };
  
  await saveConsumerState();
  
  // Return whether research agent should run
  const consumption = await checkDataConsumption(researchAgentId);
  
  return {
    should_run: true, // Explicit request always triggers run
    requested_by: consumerAgentId,
    research_agent: researchAgentId,
    consumption_state: consumption,
  };
}

/**
 * Check if a research agent should run (consumer-driven)
 */
async function shouldResearchAgentRun(researchAgentId) {
  await loadConsumerState();
  
  const agent = RESEARCH_AGENTS[researchAgentId];
  if (!agent) {
    return {
      should_run: false,
      reason: "unknown_research_agent",
    };
  }
  
  // Check for explicit requests in last hour
  const recentRequests = Object.values(consumerState.last_requests).filter(req => {
    if (req.research_agent !== researchAgentId) return false;
    const requestedAt = new Date(req.requested_at).getTime();
    const hoursSince = (Date.now() - requestedAt) / (1000 * 60 * 60);
    return hoursSince < 1;
  });
  
  if (recentRequests.length > 0) {
    return {
      should_run: true,
      reason: "explicit_request",
      requested_by: recentRequests.map(r => r.consumer_agent),
      requests_count: recentRequests.length,
    };
  }
  
  // Check data consumption
  const consumption = await checkDataConsumption(researchAgentId);
  
  if (!consumption.consumed && consumption.days_unused >= 1) {
    // Flag as redundant if unused for 24+ hours
    if (!consumerState.redundancy_flags[researchAgentId]) {
      consumerState.redundancy_flags[researchAgentId] = {
        flagged_at: new Date().toISOString(),
        days_unused: consumption.days_unused,
      };
      await saveConsumerState();
    }
    
    return {
      should_run: false,
      reason: "no_consumer_demand",
      days_unused: consumption.days_unused,
      redundant: true,
    };
  }
  
  // Default: run if data is being consumed
  return {
    should_run: consumption.consumed,
    reason: consumption.consumed ? "active_consumption" : "no_recent_consumption",
    consumption_state: consumption,
  };
}

/**
 * Record that a research agent ran
 */
async function recordResearchRun(researchAgentId, success = true) {
  await loadConsumerState();
  
  consumerState.last_runs[researchAgentId] = {
    ran_at: new Date().toISOString(),
    success,
  };
  
  // Clear redundancy flag if run was successful
  if (success && consumerState.redundancy_flags[researchAgentId]) {
    delete consumerState.redundancy_flags[researchAgentId];
  }
  
  await saveConsumerState();
}

/**
 * Get redundancy report
 */
async function getRedundancyReport() {
  await loadConsumerState();
  
  const report = {
    redundant_agents: [],
    active_agents: [],
    total_agents: Object.keys(RESEARCH_AGENTS).length,
  };
  
  for (const [agentId, agent] of Object.entries(RESEARCH_AGENTS)) {
    const shouldRun = await shouldResearchAgentRun(agentId);
    const consumption = await checkDataConsumption(agentId);
    
    const agentInfo = {
      agent_id: agentId,
      name: agent.name,
      should_run: shouldRun.should_run,
      reason: shouldRun.reason,
      consumption_state: consumption,
      redundant: shouldRun.redundant || false,
    };
    
    if (shouldRun.redundant || (!shouldRun.should_run && consumption.days_unused >= 1)) {
      report.redundant_agents.push(agentInfo);
    } else {
      report.active_agents.push(agentInfo);
    }
  }
  
  return report;
}

module.exports = {
  requestContextRefresh,
  shouldResearchAgentRun,
  recordResearchRun,
  checkDataConsumption,
  getRedundancyReport,
  RESEARCH_AGENTS,
};
