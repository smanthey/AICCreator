#!/usr/bin/env node
"use strict";

/**
 * business-coordinator-agent.js — Business Intelligence Coordinator Agent
 * 
 * Orchestrates the business intelligence agent swarm, manages build pipeline,
 * coordinates handoffs, synthesizes results, and reports progress.
 */

require("dotenv").config({ override: true });

const fs = require("fs");
const path = require("path");
const { loadAgentPrelude, appendAgentDailyLog } = require("../control/agent-memory");
const { chatJson } = require("../infra/model-router");
const pg = require("../infra/postgres");

const AGENT_ID = "business_coordinator_agent";

// ─── Load Agent Context ────────────────────────────────────────────────────

function loadContext(...files) {
  const contextDir = path.join(__dirname, "../context");
  return files.map(f => {
    try {
      const fpath = path.join(contextDir, f);
      return `\n---\n${fs.readFileSync(fpath, "utf8")}`;
    } catch (_) {
      return `\n--- [${f} not found] ---`;
    }
  }).join("\n");
}

// ─── Coordinator System Prompt ─────────────────────────────────────────────

const COORDINATOR_SYSTEM = `You are the Business Intelligence Coordinator Agent for OpenClaw.

Your mission: Orchestrate the business intelligence agent swarm, manage build pipeline,
coordinate handoffs, synthesize results, and report progress.

## Coordination Process

1. **Check Agent Status**: Monitor Research, Builder, Updater, Improver agents
2. **Coordinate Handoffs**: Ensure research → build → update → improve flow
3. **Synthesize Progress**: Combine results from all agents
4. **Generate Report**: Create comprehensive status report
5. **Queue Actions**: Determine next actions for each agent

## Agent Handoffs

- Research Agent → Builder Agent: Research findings ready for build
- Builder Agent → Updater Agent: New integrations need monitoring
- Updater Agent → Improver Agent: Performance issues need optimization
- All Agents → Coordinator: Status updates and results

${loadContext("SOUL.md", "USER.md", "AGENT_PRINCIPLES.md")}`;

// ─── Check Agent Status ─────────────────────────────────────────────────────

async function checkAgentStatus() {
  // Check research queue
  const { rows: researchQueue } = await pg.query(
    `SELECT COUNT(*)::int AS pending
     FROM business_integration_research
     WHERE research_status = 'pending'`
  );

  // Check build queue
  const { rows: buildQueue } = await pg.query(
    `SELECT COUNT(*)::int AS queued, 
            COUNT(*) FILTER (WHERE build_status = 'building')::int AS building
     FROM business_build_queue
     WHERE build_status IN ('queued', 'building')`
  );

  // Check integration health
  const { rows: integrationHealth } = await pg.query(
    `SELECT 
       COUNT(*) FILTER (WHERE status = 'connected')::int AS connected,
       COUNT(*) FILTER (WHERE status = 'error')::int AS errors,
       COUNT(*)::int AS total
     FROM business_data_sources`
  );

  // Check recent improvements
  const { rows: improvements } = await pg.query(
    `SELECT COUNT(*)::int AS proposed
     FROM business_improvement_logs
     WHERE improvement_status = 'proposed'
     AND created_at > NOW() - INTERVAL '7 days'`
  );

  return {
    research: { pending: researchQueue[0]?.pending || 0 },
    build: { queued: buildQueue[0]?.queued || 0, building: buildQueue[0]?.building || 0 },
    integrations: integrationHealth[0] || { connected: 0, errors: 0, total: 0 },
    improvements: { proposed: improvements[0]?.proposed || 0 },
  };
}

// ─── Synthesize Progress ──────────────────────────────────────────────────

async function synthesizeProgress(status) {
  const prompt = `Synthesize the current state of the business intelligence system.

Agent Status:
- Research: ${status.research.pending} pending
- Build: ${status.build.queued} queued, ${status.build.building} building
- Integrations: ${status.integrations.connected}/${status.integrations.total} connected, ${status.integrations.errors} errors
- Improvements: ${status.improvements.proposed} proposed

Generate a status report with:
1. Overall system health
2. Pipeline progress (research → build → update → improve)
3. Blockers or issues
4. Next actions for each agent
5. Recommendations`;

  try {
    const result = await chatJson(COORDINATOR_SYSTEM, prompt, {
      max_tokens: 1500,
      temperature: 0.3,
    });

    return result;
  } catch (err) {
    console.error(`[coordinator] Error synthesizing progress:`, err.message);
    return {
      system_health: "unknown",
      pipeline_progress: "unknown",
      blockers: [err.message],
      next_actions: [],
    };
  }
}

// ─── Main Agent Function ────────────────────────────────────────────────────

async function main() {
  console.log(`[${AGENT_ID}] Starting coordination cycle`);

  // Load agent prelude
  const prelude = await loadAgentPrelude(AGENT_ID);
  console.log(`[${AGENT_ID}] Loaded prelude`);

  // Check agent status
  const status = await checkAgentStatus();
  console.log(`[${AGENT_ID}] Agent status:`, JSON.stringify(status, null, 2));

  // Synthesize progress
  const progress = await synthesizeProgress(status);

  // Log to daily memory
  const summary = `Coordinated swarm: ${status.integrations.connected} integrations connected, ${status.build.queued} builds queued, ${status.research.pending} research pending`;
  await appendAgentDailyLog(AGENT_ID, summary, { status, progress });

  console.log(`[${AGENT_ID}] Coordination cycle complete: ${summary}`);
  console.log(`[${AGENT_ID}] Progress:`, JSON.stringify(progress, null, 2));

  return { ok: true, status, progress };
}

// ─── Run ────────────────────────────────────────────────────────────────────

if (require.main === module) {
  main()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error(`[${AGENT_ID}] Fatal error:`, err);
      process.exit(1);
    });
}

module.exports = { main, checkAgentStatus, synthesizeProgress };
