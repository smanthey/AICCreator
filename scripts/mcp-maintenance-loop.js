#!/usr/bin/env node
"use strict";

/**
 * MCP Maintenance Loop (skeleton)
 *
 * This script does NOT call MCP directly (that happens via your MCP host).
 * Instead, it:
 *   - Reads mcp/mission.json
 *   - Reads mcp/domain-exemplars.json
 *   - Reads mcp/detectors/*.json
 *   - Emits a lightweight plan of which detectors to run against which repos
 *
 * The output is designed to be consumed by an MCP-capable agent that can:
 *   - call index_folder / index_repo
 *   - call search_text / search_symbols
 *   - open refactor tasks based on findings
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const MCP_DIR = path.join(ROOT, "mcp");

function readJson(relPath) {
  const full = path.join(ROOT, relPath);
  const raw = fs.readFileSync(full, "utf8");
  return JSON.parse(raw);
}

function loadDetectors() {
  const detectorsDir = path.join(MCP_DIR, "detectors");
  const files = fs.readdirSync(detectorsDir);
  const detectors = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const full = path.join(detectorsDir, file);
    const raw = fs.readFileSync(full, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      detectors.push(...parsed);
    }
  }
  return detectors;
}

function main() {
  const mission = readJson("mcp/mission.json");
  const exemplars = readJson("mcp/domain-exemplars.json");
  const detectors = loadDetectors();

  const cadence = process.argv[2] || "hourly"; // "hourly" | "daily" | "weekly"
  const steps = mission.cadence[cadence] || [];

  const plan = {
    mission_id: mission.mission_id,
    cadence,
    steps,
    targets: mission.targets,
    domains: Object.keys(exemplars),
    detectors: detectors.map((d) => ({
      id: d.id,
      type: d.type,
      domain: d.domain || null,
      severity: d.severity || "medium",
    })),
    generated_at: new Date().toISOString(),
  };

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(plan, null, 2));
}

if (require.main === module) {
  main();
}

