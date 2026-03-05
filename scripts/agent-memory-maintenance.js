#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const {
  STATE_ROOT,
  listKnownAgents,
  compactAgentMemory,
  readText,
} = require("../control/agent-memory");

function arg(flag, fallback = null) {
  const args = process.argv.slice(2);
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
}

function uniqLines(md) {
  const seen = new Set();
  const out = [];
  for (const line of String(md || "").split("\n")) {
    const key = line.trim();
    if (!key || key.startsWith("#")) {
      out.push(line);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

function dedupeMemory(agent) {
  const f = path.join(STATE_ROOT, "agents", agent, "MEMORY.md");
  if (!fs.existsSync(f)) return false;
  const cur = readText(f, "");
  const next = uniqLines(cur);
  if (next !== cur) {
    fs.writeFileSync(f, next);
    return true;
  }
  return false;
}

function main() {
  const keepDays = Math.max(3, Number(arg("--keep-days", "7")) || 7);
  const agents = listKnownAgents();
  let moved = 0;
  let deduped = 0;

  for (const a of agents) {
    moved += compactAgentMemory(a, keepDays).moved;
    if (dedupeMemory(a)) deduped += 1;
  }

  console.log(`agent-memory-maintenance complete`);
  console.log(`agents=${agents.length} logs_archived=${moved} memory_files_deduped=${deduped}`);
}

main();
