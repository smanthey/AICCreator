#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");
const { validateAllServices, needsHealing } = require("../control/heartbeat-validator");

const STEPS = [
  { name: "heartbeat-validation", fn: async () => {
    // New: Heartbeat validation before traditional checks
    console.log("[auto-heal] Validating service heartbeats...");
    const validations = await validateAllServices();
    const needsHeal = Object.entries(validations).filter(([_, result]) => needsHealing(result));
    
    if (needsHeal.length > 0) {
      console.warn(`[auto-heal] ⚠️  ${needsHeal.length} service(s) need healing:`);
      for (const [serviceId, result] of needsHeal) {
        console.warn(`  - ${result.service_name}: ${result.reason}`);
      }
      // Continue with healing steps
      return true;
    }
    console.log("[auto-heal] ✅ All services passed heartbeat validation");
    return true;
  }},
  { name: "status:redgreen (pre)", cmd: "npm run -s status:redgreen" },
  { name: "diagnose", cmd: "npm run -s audit:deep && npm run -s audit:gaps" },
  { name: "autofix", cmd: "npm run -s needs:attention:autofix" },
  { name: "reconcile-deadletters", cmd: "npm run -s tasks:reconcile-deadletters" },
  { name: "status:redgreen (post)", cmd: "npm run -s status:redgreen" },
];

async function runStep(step) {
  const started = new Date().toISOString();
  console.log(`[auto-heal] ▶ ${step.name} @ ${started}`);
  
  // Handle async function steps
  if (step.fn) {
    try {
      const result = await step.fn();
      const ended = new Date().toISOString();
      if (result) {
        console.log(`[auto-heal] ✓ ${step.name} @ ${ended}`);
        return true;
      } else {
        console.error(`[auto-heal] ✗ ${step.name} failed @ ${ended}`);
        return false;
      }
    } catch (err) {
      const ended = new Date().toISOString();
      console.error(`[auto-heal] ✗ ${step.name} error: ${err.message} @ ${ended}`);
      return false;
    }
  }
  
  // Handle command steps
  const out = spawnSync("bash", ["-lc", step.cmd], {
    stdio: "inherit",
    env: process.env,
    cwd: process.cwd(),
  });
  const ended = new Date().toISOString();
  const code = Number(out.status ?? 1);
  if (code !== 0) {
    console.error(`[auto-heal] ✗ ${step.name} failed exit=${code} @ ${ended}`);
    return false;
  }
  console.log(`[auto-heal] ✓ ${step.name} @ ${ended}`);
  return true;
}

async function main() {
  console.log(`[auto-heal] start ${new Date().toISOString()}`);
  let failed = 0;
  for (const step of STEPS) {
    if (!(await runStep(step))) failed += 1;
  }
  if (failed > 0) {
    console.error(`[auto-heal] complete with failures=${failed}`);
    process.exit(1);
  }
  console.log("[auto-heal] complete failures=0");
}

main().catch((err) => {
  console.error("[auto-heal] Fatal:", err);
  process.exit(1);
});

