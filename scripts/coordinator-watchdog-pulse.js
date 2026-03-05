#!/usr/bin/env node
"use strict";

/**
 * scripts/coordinator-watchdog-pulse.js
 * 
 * Watchdog that monitors the Coordinator Pulse itself.
 * If coordinator is stale, triggers recovery actions.
 */

require("dotenv").config({ override: true });

const { checkCoordinatorHealth } = require("../control/coordinator-watchdog");
const { spawnSync } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "..");

async function main() {
  console.log(`[coordinator-watchdog] Checking coordinator health at ${new Date().toISOString()}`);
  
  const health = await checkCoordinatorHealth();
  
  if (health.stale) {
    console.warn(`[coordinator-watchdog] ⚠️  Coordinator is STALE (${health.age_minutes} minutes old)`);
    console.warn(`[coordinator-watchdog] Last update: ${health.last_update || "never"}`);
    
    // Try to restart coordinator pulse
    console.log("[coordinator-watchdog] Attempting to restart coordinator...");
    try {
      const result = spawnSync("pm2", ["restart", "claw-openclaw-coordinator"], {
        cwd: ROOT,
        stdio: "inherit",
        timeout: 10000,
      });
      
      if (result.status === 0) {
        console.log("[coordinator-watchdog] ✅ Coordinator restarted successfully");
      } else {
        console.error("[coordinator-watchdog] ❌ Failed to restart coordinator");
      }
    } catch (err) {
      console.error(`[coordinator-watchdog] ❌ Restart failed: ${err.message}`);
    }
  } else {
    console.log(`[coordinator-watchdog] ✅ Coordinator healthy (${health.age_minutes} minutes old)`);
  }
  
  return health;
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[coordinator-watchdog] Fatal:", err);
    process.exit(1);
  });
}

module.exports = { main };
