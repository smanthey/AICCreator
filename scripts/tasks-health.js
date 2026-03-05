#!/usr/bin/env node
"use strict";

const { spawnSync } = require("child_process");

const checks = [
  { name: "topology", args: ["run", "verify:topology"] },
  { name: "runtime-audit", args: ["run", "audit:runtime"] },
  { name: "task-contract-audit", args: ["run", "audit:tasks"] },
  { name: "agent-drift-audit", args: ["run", "audit:drift"] },
];

let failed = false;
for (const check of checks) {
  process.stdout.write(`\n[tasks:health] ▶ ${check.name}\n`);
  const res = spawnSync("npm", check.args, {
    stdio: "inherit",
    env: process.env,
  });
  if (res.status !== 0) {
    failed = true;
    process.stderr.write(`[tasks:health] ✗ ${check.name} failed\n`);
    break;
  }
  process.stdout.write(`[tasks:health] ✓ ${check.name}\n`);
}

if (failed) {
  process.exit(1);
}

process.stdout.write("\n[tasks:health] all checks passed\n");
