#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "config", "mission-control-agents.json");

function loadAgents() {
  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((a) => String(a?.id || "").trim())
    .filter(Boolean);
}

function main() {
  const names = ["claw-mission-heartbeat", ...loadAgents().map((id) => `claw-mission-${id}`)];
  process.stdout.write(names.join(","));
}

main();
