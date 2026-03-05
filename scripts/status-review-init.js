#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { STATE_ROOT, ensureDir, writeIfMissing, dateKey } = require("../control/agent-memory");

const CONFIG_PATH = path.join(__dirname, "..", "config", "status-review-agents.json");

function loadConfig() {
  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  const data = JSON.parse(raw);
  if (!Array.isArray(data) || !data.length) {
    throw new Error("status-review-agents.json must be a non-empty array");
  }
  return data;
}

function fileSafeId(id) {
  return String(id || "").trim().toLowerCase();
}

function main() {
  const agents = loadConfig();
  ensureDir(STATE_ROOT);
  ensureDir(path.join(STATE_ROOT, "agents"));
  ensureDir(path.join(STATE_ROOT, "shared-context"));
  ensureDir(path.join(STATE_ROOT, "shared-context", "status-review"));
  ensureDir(path.join(STATE_ROOT, "handoffs"));

  writeIfMissing(path.join(STATE_ROOT, "shared-context", "status-review", "SCHEMA_STATUS.md"),
`# Schema Integrity Status

- Tracks migration application status
- Foreign key constraint verification
- ensureSchema() consolidation progress
`);

  writeIfMissing(path.join(STATE_ROOT, "shared-context", "status-review", "SECURITY_STATUS.md"),
`# Security Remediation Status

- Redis authentication status (C1)
- Postgres authentication status (C2)
- Discord gateway stability (C3)
- Critical findings tracking
`);

  writeIfMissing(path.join(STATE_ROOT, "shared-context", "status-review", "WORKER_STATUS.md"),
`# Worker Stability Status

- PM2 restart pattern analysis
- Memory leak detection
- Connection pool errors
- Ollama port conflicts
`);

  writeIfMissing(path.join(STATE_ROOT, "shared-context", "status-review", "UPTIME_STATUS.md"),
`# Uptime Monitoring Status

- Current uptime percentage
- Downtime cause attribution
- Service health tracking
- MTTR metrics
`);

  const today = `${dateKey()}.md`;
  for (const a of agents) {
    const id = fileSafeId(a.id);
    const ad = path.join(STATE_ROOT, "agents", id);
    ensureDir(ad);
    ensureDir(path.join(ad, "memory"));
    ensureDir(path.join(ad, "archive"));

    writeIfMissing(
      path.join(ad, "SOUL.md"),
`# ${id} SOUL

- role: ${a.name}
- mission: ${a.description}
- principle: be explicit, auditable, and deterministic-first.
`
    );

    writeIfMissing(
      path.join(ad, "IDENTITY.md"),
`# ${id} IDENTITY

- lane: ${id}
- owner: ${a.owner || "OpenClaw Mission Control"}
- heartbeat_minutes: ${a.heartbeat_minutes}
- cron: ${a.cron}
- priority: ${a.priority || 2}
`
    );

    writeIfMissing(
      path.join(ad, "AGENTS.md"),
`# ${id} OPERATIONS

1. Load agent prelude and recent memory.
2. Execute assigned status review remediation task.
3. Record heartbeat and outcome.
4. Emit follow-up actions when blockers or gaps are detected.

## Job
- description: ${a.job_description}
- primary_command: \`${a.primary_command}\`
- cron: \`${a.cron}\`

## Code Exploration Standard
- Interpret jmunchcode/jmucnhcode as local symbol-map indexing requests.
- Do not use jcodemunch/jcode for indexing.
- Use filesystem MCP + rg + local symbol-map scripts first, then repo_mapper when available.
`
    );

    writeIfMissing(
      path.join(ad, "MEMORY.md"),
`# ${id} MEMORY

- role: ${a.name}
- job: ${a.job_description}
- command: ${a.primary_command}
- cron: ${a.cron}
`
    );

    writeIfMissing(path.join(ad, "memory", today), `# ${dateKey()} ${id}\n\n`);

    // Create STATUS.md for coordinator
    if (id === "status_review_coordinator") {
      writeIfMissing(
        path.join(ad, "STATUS.md"),
`# Status Review Coordinator Status

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
`
      );
    }
  }

  console.log("=== Status Review Init ===");
  console.log(`agents: ${agents.length}`);
  console.log(`state_root: ${STATE_ROOT}`);
}

main();
