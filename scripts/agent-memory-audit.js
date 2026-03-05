#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { STATE_ROOT } = require("../control/agent-memory");

const REPORT_DIR = path.join(__dirname, "reports");
const REQUIRED_AGENT_FILES = ["SOUL.md", "IDENTITY.md", "AGENTS.md", "MEMORY.md"];
const REQUIRED_INTEGRATION_AGENTS = new Set(
  String(process.env.AGENT_MEMORY_REQUIRED_INTEGRATION || "planner,orchestrator,content")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
);

function ts() {
  return new Date().toISOString();
}

function finding(priority, message, detail = null) {
  return { priority, message, detail };
}

function agentHasIntegration(agent) {
  const candidates = [
    path.join(__dirname, "..", "agents", `${agent}.js`),
    path.join(__dirname, "..", "agents", `${agent}-agent.js`),
  ];
  for (const f of candidates) {
    if (!fs.existsSync(f)) continue;
    const txt = fs.readFileSync(f, "utf8");
    if (txt.includes("loadAgentPrelude") || txt.includes("appendAgentDailyLog")) return true;
  }
  return false;
}

function main() {
  const out = {
    generated_at: ts(),
    state_root: STATE_ROOT,
    agents: [],
    summary: { total_agents: 0, missing_files: 0, missing_integration: 0, high_findings: 0 },
  };

  if (!fs.existsSync(STATE_ROOT)) {
    console.error("agent-state folder missing");
    process.exit(1);
  }

  const agentsRoot = path.join(STATE_ROOT, "agents");
  const agents = fs.existsSync(agentsRoot)
    ? fs.readdirSync(agentsRoot).filter((x) => fs.statSync(path.join(agentsRoot, x)).isDirectory())
    : [];

  for (const a of agents) {
    const ad = path.join(agentsRoot, a);
    const row = { agent: a, findings: [], files_ok: true, integration_ok: true };

    for (const f of REQUIRED_AGENT_FILES) {
      const full = path.join(ad, f);
      if (!fs.existsSync(full)) {
        row.files_ok = false;
        row.findings.push(finding("high", `Missing required file: ${f}`));
      }
    }

    const memDir = path.join(ad, "memory");
    if (!fs.existsSync(memDir)) {
      row.files_ok = false;
      row.findings.push(finding("high", "Missing required directory: memory/"));
    }

    if (!agentHasIntegration(a)) {
      row.integration_ok = false;
      if (REQUIRED_INTEGRATION_AGENTS.has(a)) {
        row.findings.push(finding("high", "Agent code not yet wired to loadAgentPrelude/appendAgentDailyLog."));
      } else {
        row.findings.push(finding("medium", "Agent not yet memory-wired (rollout pending)."));
      }
    }

    out.summary.total_agents += 1;
    out.summary.missing_files += row.findings.filter((f) => f.message.includes("Missing required")).length;
    out.summary.missing_integration += row.integration_ok ? 0 : 1;
    out.summary.high_findings += row.findings.filter((f) => f.priority === "high").length;
    out.agents.push(row);
  }

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = Date.now();
  const reportPath = path.join(REPORT_DIR, `${stamp}-agent-memory-audit.json`);
  fs.writeFileSync(reportPath, JSON.stringify(out, null, 2));

  console.log("=== Agent Memory Audit ===");
  console.log(`agents=${out.summary.total_agents}`);
  console.log(`high_findings=${out.summary.high_findings}`);
  console.log(`missing_integration=${out.summary.missing_integration}`);
  console.log(`report=${reportPath}`);

  if (out.summary.high_findings > 0) process.exit(1);
}

main();
