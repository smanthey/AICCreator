#!/usr/bin/env node
"use strict";

const path = require("path");
const fs = require("fs");
const {
  STATE_ROOT,
  ensureDir,
  writeIfMissing,
  dateKey,
} = require("../control/agent-memory");
const { resolveProfilesForAgent, compactProfileProjection } = require("../control/agent-focus-profiles");

const AGENTS = [
  "planner",
  "orchestrator",
  "content",
  "classifier",
  "leadgen",
  "research",
  "qa",
  "repo_autofix",
];

const MISSION_CONFIG = path.join(__dirname, "..", "config", "mission-control-agents.json");

function missionAgents() {
  try {
    if (!fs.existsSync(MISSION_CONFIG)) return [];
    const cfg = JSON.parse(fs.readFileSync(MISSION_CONFIG, "utf8"));
    if (!Array.isArray(cfg)) return [];
    return cfg
      .map((x) => String(x?.id || "").trim().toLowerCase())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function main() {
  const allAgents = [...new Set([...AGENTS, ...missionAgents()])];
  ensureDir(STATE_ROOT);
  ensureDir(path.join(STATE_ROOT, "shared-context"));
  ensureDir(path.join(STATE_ROOT, "handoffs"));
  ensureDir(path.join(STATE_ROOT, "agents"));

  writeIfMissing(path.join(STATE_ROOT, "USER.md"), "# USER\n\n- Add user operating preferences here.\n");
  writeIfMissing(path.join(STATE_ROOT, "shared-context", "THESIS.md"), "# THESIS\n\n- Add strategic operating thesis.\n");
  writeIfMissing(path.join(STATE_ROOT, "shared-context", "FEEDBACK-LOG.md"), "# Feedback Log\n\n");
  writeIfMissing(path.join(STATE_ROOT, "shared-context", "SIGNALS.md"), "# Signals\n\n");
  writeIfMissing(path.join(STATE_ROOT, "handoffs", "DAILY-INTEL.md"), "# Daily Intel\n\n");
  writeIfMissing(path.join(STATE_ROOT, "handoffs", "DAILY-ASSIGNMENT.md"), "# Daily Assignment\n\n");
  writeIfMissing(path.join(STATE_ROOT, "handoffs", "DAILY-DRAFTS.md"), "# Daily Drafts\n\n");

  for (const a of allAgents) {
    const focusProfiles = resolveProfilesForAgent(a, { id: a }).slice(0, 3);
    const primaryFocus = focusProfiles[0] || null;
    const focusLines = focusProfiles
      .map((p) => {
        const c = compactProfileProjection(p, { maxGoals: 2, maxSkills: 10 });
        return `- ${c.name} (${c.id})\n  intent: ${c.intent || "n/a"}\n  skills: ${(c.skills || []).join(", ") || "n/a"}`;
      })
      .join("\n");
    const ad = path.join(STATE_ROOT, "agents", a);
    ensureDir(ad);
    ensureDir(path.join(ad, "memory"));
    ensureDir(path.join(ad, "archive"));
    writeIfMissing(path.join(ad, "SOUL.md"), `# ${a} SOUL\n\n- Add stable behavioral principles.\n- primary_focus_profile: ${primaryFocus ? `${primaryFocus.name} (${primaryFocus.id})` : "unassigned"}\n`);
    writeIfMissing(path.join(ad, "IDENTITY.md"), `# ${a} IDENTITY\n\n- lane: ${a}\n- primary_focus_profile_id: ${primaryFocus?.id || "unassigned"}\n`);
    writeIfMissing(path.join(ad, "AGENTS.md"), `# ${a} OPERATIONS\n\n1. Load prelude\n2. Execute\n3. Write back\n\n## Focus Profiles\n${focusLines || "- unassigned"}\n\n## Code Exploration Standard\n- Interpret jmunchcode/jmucnhcode as local symbol-map indexing requests.\n- Do not use jcodemunch/jcode.\n- Use filesystem MCP + rg + repo symbol-map scripts first, then repo_mapper only if available.\n`);
    writeIfMissing(path.join(ad, "MEMORY.md"), `# ${a} MEMORY\n\n`);
    // Daily log files are created on first real write by appendAgentDailyLog.
    // Do NOT pre-create empty placeholders here — they cause misleading 0-byte
    // files that look like failed runs for agents that simply weren't invoked.
  }

  console.log(`agent-state initialized at ${STATE_ROOT}`);
  console.log(`agents=${allAgents.length}`);
}

main();
