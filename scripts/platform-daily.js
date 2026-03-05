#!/usr/bin/env node
"use strict";

const { spawnSync } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "..");

function runStep(name, cmd, args) {
  const started = Date.now();
  console.log(`\n[platform:daily] ▶ ${name}`);
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 20 * 60 * 1000,
    env: process.env,
  });
  const ms = Date.now() - started;
  const stdout = (res.stdout || "").trim();
  const stderr = (res.stderr || "").trim();

  if (stdout) console.log(stdout);
  if (stderr) console.error(stderr);

  if (res.status !== 0) {
    throw new Error(`${name} failed (exit=${res.status}, ${ms}ms)`);
  }
  console.log(`[platform:daily] ✓ ${name} (${ms}ms)`);
}

function main() {
  const startedAt = new Date().toISOString();
  console.log(`[platform:daily] started ${startedAt}`);

  runStep("verify-topology", "npm", ["run", "verify:topology"]);
  runStep("github-bootstrap", "npm", ["run", "github:bootstrap", "--", "--limit", "200"]);
  runStep("github-scan", "npm", ["run", "github:scan", "--", "--limit", "200", "--strict-baseline"]);
  runStep("github-baseline-gate", "npm", ["run", "github:baseline:gate"]);
  runStep("research-sync", "npm", ["run", "research:sync", "--", "--days", "14", "--limit", "25"]);
  runStep("research-signals", "npm", ["run", "research:signals", "--", "--days", "30", "--limit", "500"]);
  runStep("affiliate-research", "npm", ["run", "affiliate:research", "--", "--limit", "15"]);
  runStep("launch-e2e-matrix", "npm", ["run", "e2e:launch:matrix"]);
  runStep("qa-human-blocking", "npm", ["run", "qa:human:blocking"]);
  runStep("agent-memory-audit", "npm", ["run", "agent:memory:audit"]);
  runStep("security-sweep", "npm", ["run", "security:sweep", "--", "--dep-fail-on", "critical"]);
  runStep("platform-health", "npm", ["run", "platform:health"]);

  const finishedAt = new Date().toISOString();
  console.log(`\n[platform:daily] completed ${finishedAt}`);
}

try {
  main();
} catch (err) {
  console.error(`[platform:daily] fatal: ${err.message}`);
  process.exit(1);
}
