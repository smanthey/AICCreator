#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { appendAgentDailyLog } = require("../control/agent-memory");

const ROOT = path.join(__dirname, "..");
const ACTION_PLAN_PATH = path.join(ROOT, "ACTION-PLAN-STATUS-REVIEW.md");
const STATUS_PATH = path.join(ROOT, "agent-state", "agents", "status_review_coordinator", "STATUS.md");
const CONFIG_PATH = path.join(ROOT, "config", "status-review-agents.json");

function loadActionPlan() {
  try {
    return fs.readFileSync(ACTION_PLAN_PATH, "utf8");
  } catch (err) {
    console.warn(`[coordinator] Could not load ACTION-PLAN: ${err.message}`);
    return "";
  }
}

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

function loadStatus() {
  try {
    return fs.readFileSync(STATUS_PATH, "utf8");
  } catch {
    return null;
  }
}

function updateStatus(updates) {
  const statusDir = path.dirname(STATUS_PATH);
  if (!fs.existsSync(statusDir)) {
    fs.mkdirSync(statusDir, { recursive: true });
  }

  let currentStatus = loadStatus() || `# Status Review Coordinator Status

## Current State

### Schema Integrity
- Migration 078: Pending
- Migration 075: Pending
- ensureSchema() consolidation: Pending

### Security
- Redis auth (C1): Pending
- Postgres auth (C2): Pending
- Discord gateway (C3): Pending

### Worker Stability
- Restart pattern fixes: Pending
- Connection pool fixes: Pending
- Memory leak fixes: Pending

### Uptime
- Monitoring improvements: Pending
- Infrastructure hardening: Pending

## Progress Metrics
- Last updated: ${new Date().toISOString()}
- Blockers: None
- Next actions: Initialize agents and begin remediation
`;

  // Simple status update - replace status values
  for (const [key, value] of Object.entries(updates)) {
    const regex = new RegExp(`(${key}:\\s*)[^\\n]+`, "g");
    currentStatus = currentStatus.replace(regex, `$1${value}`);
  }

  // Update last updated timestamp
  currentStatus = currentStatus.replace(
    /(Last updated: )[^\n]+/,
    `$1${new Date().toISOString()}`
  );

  fs.writeFileSync(STATUS_PATH, currentStatus);
}

function checkWorkerAgentStatus(agentId) {
  const reportPath = path.join(ROOT, "scripts", "reports", `status-review-${agentId}-latest.json`);
  try {
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    return {
      exists: true,
      ok: report.ok,
      lastRun: report.generated_at,
      summary: report.stdout_tail?.slice(-200) || "",
    };
  } catch {
    return { exists: false, ok: false, lastRun: null, summary: "" };
  }
}

function determinePriorities() {
  const actionPlan = loadActionPlan();
  const priorities = {
    schema: { priority: 1, reason: "Foundation for data integrity" },
    security: { priority: 1, reason: "Critical security findings (C1-C3)" },
    worker: { priority: 2, reason: "Affects uptime and stability" },
    uptime: { priority: 2, reason: "Monitoring and infrastructure" },
  };

  // Check current status of each area
  const schemaStatus = checkWorkerAgentStatus("schema_integrity_agent");
  const securityStatus = checkWorkerAgentStatus("security_remediation_agent");
  const workerStatus = checkWorkerAgentStatus("worker_stability_agent");
  const uptimeStatus = checkWorkerAgentStatus("uptime_monitoring_agent");

  const recommendations = [];

  // Schema integrity - high priority if not started
  if (!schemaStatus.exists || !schemaStatus.ok) {
    recommendations.push({
      agent: "schema_integrity_agent",
      priority: 1,
      reason: "Schema integrity is foundation for all other work",
    });
  }

  // Security - always high priority
  if (!securityStatus.exists || !securityStatus.ok) {
    recommendations.push({
      agent: "security_remediation_agent",
      priority: 1,
      reason: "Critical security findings need immediate attention",
    });
  }

  // Worker stability - medium priority
  if (!workerStatus.exists || !workerStatus.ok) {
    recommendations.push({
      agent: "worker_stability_agent",
      priority: 2,
      reason: "Worker restarts affect system reliability",
    });
  }

  // Uptime - medium priority
  if (!uptimeStatus.exists || !uptimeStatus.ok) {
    recommendations.push({
      agent: "uptime_monitoring_agent",
      priority: 2,
      reason: "Uptime monitoring needed for improvement tracking",
    });
  }

  return recommendations.sort((a, b) => a.priority - b.priority);
}

async function main() {
  console.log("=== Status Review Coordinator ===");
  console.log(`Started: ${new Date().toISOString()}`);

  const actionPlan = loadActionPlan();
  if (!actionPlan) {
    console.warn("[coordinator] ACTION-PLAN-STATUS-REVIEW.md not found");
  }

  const recommendations = determinePriorities();
  
  console.log(`\nPriorities determined: ${recommendations.length} areas need attention`);
  for (const rec of recommendations) {
    console.log(`  - ${rec.agent}: ${rec.reason} (priority ${rec.priority})`);
  }

  // Update status file
  const statusUpdates = {
    "Migration 078": recommendations.find(r => r.agent === "schema_integrity_agent") ? "In Progress" : "Pending",
    "Redis auth (C1)": recommendations.find(r => r.agent === "security_remediation_agent") ? "In Progress" : "Pending",
    "Restart pattern fixes": recommendations.find(r => r.agent === "worker_stability_agent") ? "In Progress" : "Pending",
    "Monitoring improvements": recommendations.find(r => r.agent === "uptime_monitoring_agent") ? "In Progress" : "Pending",
  };

  updateStatus(statusUpdates);

  // Emit summary
  const summary = `Coordinator run: ${recommendations.length} areas prioritized. Top: ${recommendations[0]?.agent || "none"}`;
  const learned = recommendations.map(r => `${r.agent}: ${r.reason}`).join("; ");

  await appendAgentDailyLog("status_review_coordinator", {
    goal: "Orchestrate status review remediation workflow",
    task_type: "status_review_coordinator",
    summary,
    learned: learned || "All areas up to date",
    metrics: {
      recommendations_count: recommendations.length,
      high_priority: recommendations.filter(r => r.priority === 1).length,
      medium_priority: recommendations.filter(r => r.priority === 2).length,
    },
    blocker: recommendations.length === 0 ? undefined : `${recommendations.length} areas need attention`,
    next_focus: recommendations[0] ? `Focus on ${recommendations[0].agent}` : "Monitor progress",
    tags: ["coordinator", "status-review"],
    model_used: "status-review-coordinator",
    cost_usd: 0,
    open_loops: recommendations.length > 0 ? [`${recommendations.length} worker agents need execution`] : [],
  });

  // Output JSON for runner to parse
  console.log(JSON.stringify({
    ok: true,
    recommendations_count: recommendations.length,
    recommendations,
    status_updated: true,
  }));

  console.log("\n=== Coordinator Complete ===");
}

main().catch((err) => {
  console.error(`[coordinator] Failed: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
