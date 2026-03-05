#!/usr/bin/env node
"use strict";

/**
 * business-improver-agent.js — Business Intelligence Improver Agent
 * 
 * Analyzes sync performance, optimizes queries, adds missing features,
 * and enhances dashboard capabilities.
 */

require("dotenv").config({ override: true });

const fs = require("fs");
const path = require("path");
const { loadAgentPrelude, appendAgentDailyLog } = require("../control/agent-memory");
const { chatJson } = require("../infra/model-router");
const pg = require("../infra/postgres");

const AGENT_ID = "business_improver_agent";

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

// ─── Improver System Prompt ───────────────────────────────────────────────

const IMPROVER_SYSTEM = `You are the Business Intelligence Improver Agent for OpenClaw.

Your mission: Analyze sync performance, optimize queries, add missing features,
and enhance dashboard capabilities.

## Improvement Process

1. **Analyze Metrics**: Review sync performance, query times, error rates
2. **Identify Opportunities**: Find bottlenecks, missing features, optimization targets
3. **Generate Improvements**: Propose specific optimizations and enhancements
4. **Test**: Validate improvements before deploying
5. **Deploy**: Implement optimizations
6. **Measure**: Track impact and results

## Improvement Types

- **Performance**: Query optimization, indexing, caching
- **Features**: Missing functionality, user requests
- **Dashboard**: New visualizations, insights, filters
- **Reliability**: Error handling, retry logic, monitoring

${loadContext("SOUL.md", "USER.md", "AGENT_PRINCIPLES.md")}`;

// ─── Analyze Performance ───────────────────────────────────────────────────

async function analyzePerformance() {
  // Get sync performance metrics
  const { rows: syncMetrics } = await pg.query(
    `SELECT 
       platform,
       AVG(duration_seconds)::numeric(10,2) AS avg_duration,
       COUNT(*) FILTER (WHERE sync_status = 'failed')::int AS error_count,
       COUNT(*) FILTER (WHERE sync_status = 'completed')::int AS success_count
     FROM business_sync_logs
     WHERE started_at > NOW() - INTERVAL '7 days'
     GROUP BY platform
     ORDER BY avg_duration DESC`
  );

  // Get slow queries (if we had query logging)
  // For now, identify platforms with high error rates or long durations
  const issues = syncMetrics
    .filter(m => m.avg_duration > 60 || (m.error_count / (m.success_count + m.error_count)) > 0.1)
    .map(m => ({
      platform: m.platform,
      issue: m.avg_duration > 60 ? "slow_sync" : "high_error_rate",
      metric: m.avg_duration > 60 ? `avg_duration: ${m.avg_duration}s` : `error_rate: ${((m.error_count / (m.success_count + m.error_count)) * 100).toFixed(1)}%`,
    }));

  return issues;
}

// ─── Generate Improvement ──────────────────────────────────────────────────

async function generateImprovement(issue) {
  console.log(`[improver] Generating improvement for: ${issue.platform} - ${issue.issue}`);

  const prompt = `Generate an improvement for the business intelligence system.

Issue:
- Platform: ${issue.platform}
- Type: ${issue.issue}
- Metric: ${issue.metric}

Generate a specific improvement that:
1. Addresses the issue
2. Is measurable
3. Can be implemented
4. Has clear impact

Return JSON:
{
  "improvement_type": "performance|feature|dashboard|reliability",
  "target_component": "sync_script|dashboard|api|database",
  "description": "detailed description...",
  "impact_score": 1-10,
  "effort_estimate_hours": 2,
  "implementation": "code or steps to implement...",
  "before_metrics": {...},
  "expected_after_metrics": {...}
}`;

  try {
    const result = await chatJson(IMPROVER_SYSTEM, prompt, {
      max_tokens: 2000,
      temperature: 0.3,
    });

    if (result && result.description) {
      // Store improvement proposal
      await pg.query(
        `INSERT INTO business_improvement_logs 
         (improvement_type, target_component, description, impact_score, 
          effort_estimate_hours, before_metrics, improver_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          result.improvement_type || "performance",
          result.target_component || "sync_script",
          result.description,
          result.impact_score || 5,
          result.effort_estimate_hours || 2,
          JSON.stringify(result.before_metrics || {}),
          AGENT_ID,
        ]
      );

      return { ok: true, improvement: result };
    }
  } catch (err) {
    console.error(`[improver] Error generating improvement:`, err.message);
    return { ok: false, error: err.message };
  }
}

// ─── Main Agent Function ────────────────────────────────────────────────────

async function main() {
  console.log(`[${AGENT_ID}] Starting improvement cycle`);

  // Load agent prelude
  const prelude = await loadAgentPrelude(AGENT_ID);
  console.log(`[${AGENT_ID}] Loaded prelude`);

  // Analyze performance
  const issues = await analyzePerformance();
  console.log(`[${AGENT_ID}] Found ${issues.length} performance issues`);

  const improvements = [];
  for (const issue of issues.slice(0, 3)) { // Limit to 3 per cycle
    const result = await generateImprovement(issue);
    if (result.ok) {
      improvements.push({ platform: issue.platform, ...result });
    }
  }

  // Log to daily memory
  const summary = improvements.length > 0
    ? `Generated ${improvements.length} improvements: ${improvements.map(i => i.platform).join(", ")}`
    : `No improvements needed - system performing well`;
  await appendAgentDailyLog(AGENT_ID, summary, { improvements, issues_found: issues.length });

  console.log(`[${AGENT_ID}] Improvement cycle complete: ${summary}`);
  return { ok: true, improvements, issues_found: issues.length };
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

module.exports = { main, analyzePerformance, generateImprovement };
