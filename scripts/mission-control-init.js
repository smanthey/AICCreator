#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { STATE_ROOT, ensureDir, writeIfMissing, dateKey } = require("../control/agent-memory");
const { resolveProfilesForAgent, compactProfileProjection } = require("../control/agent-focus-profiles");

const CONFIG_PATH = path.join(__dirname, "..", "config", "mission-control-agents.json");

function loadConfig() {
  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  const data = JSON.parse(raw);
  if (!Array.isArray(data) || !data.length) {
    throw new Error("mission-control-agents.json must be a non-empty array");
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
  ensureDir(path.join(STATE_ROOT, "handoffs"));

  writeIfMissing(path.join(STATE_ROOT, "shared-context", "MISSION-CONTROL.md"),
`# Mission Control

- OpenClaw orchestrates specialized agents by role.
- Each agent writes heartbeat + run summaries to daily memory.
- Scheduled jobs are executed through PM2 cron profiles.
`);

  const today = `${dateKey()}.md`;
  for (const a of agents) {
    const id = fileSafeId(a.id);
    const focusProfiles = resolveProfilesForAgent(id, a).slice(0, 3);
    const primaryFocus = focusProfiles[0] || null;
    const primaryFocusText = primaryFocus
      ? `${primaryFocus.name} (${primaryFocus.id})`
      : "unassigned";
    const focusLines = focusProfiles
      .map((p) => {
        const c = compactProfileProjection(p, { maxGoals: 2, maxSkills: 10 });
        return `- ${c.name} (${c.id})\n  intent: ${c.intent || "n/a"}\n  goals: ${(c.goals || []).join("; ") || "n/a"}\n  skills: ${(c.skills || []).join(", ") || "n/a"}`;
      })
      .join("\n");
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
- primary_focus_profile: ${primaryFocusText}
`
    );

    writeIfMissing(
      path.join(ad, "IDENTITY.md"),
`# ${id} IDENTITY

- lane: ${id}
- owner: ${a.owner || "OpenClaw Mission Control"}
- heartbeat_minutes: ${a.heartbeat_minutes}
- cron: ${a.cron}
- primary_focus_profile_id: ${primaryFocus?.id || "unassigned"}
`
    );

    writeIfMissing(
      path.join(ad, "AGENTS.md"),
`# ${id} OPERATIONS

1. Load agent prelude and recent memory.
2. Execute assigned mission-control job.
3. Record heartbeat and outcome.
4. Emit follow-up actions when blockers or gaps are detected.

## Job
- description: ${a.job_description}
- primary_command: \`${a.primary_command}\`
- cron: \`${a.cron}\`

## Focus Profiles
${focusLines || "- unassigned"}

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
- focus_profiles: ${focusProfiles.map((p) => p.id).join(", ") || "unassigned"}
`
    );

    writeIfMissing(path.join(ad, "memory", today), `# ${dateKey()} ${id}\n\n`);
  }

  console.log("=== Mission Control Init ===");
  console.log(`agents: ${agents.length}`);
  console.log(`state_root: ${STATE_ROOT}`);
}

main();
