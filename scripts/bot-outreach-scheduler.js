#!/usr/bin/env node
"use strict";

/**
 * bot-outreach-scheduler.js
 * 
 * Automated scheduler for bot discovery and outreach
 * Runs discovery first, then contacts uncontacted leads
 */

require("dotenv").config({ override: true });

const { spawn } = require("child_process");
const path = require("path");

const DISCOVERY_SCRIPT = path.join(__dirname, "bot-lead-discovery.js");
const OUTREACH_SCRIPT = path.join(__dirname, "bot-outreach.js");

const DISCOVERY_PLATFORMS = (process.env.BOT_DISCOVERY_PLATFORMS || "discord,telegram,whatsapp")
  .split(",")
  .map(p => p.trim())
  .filter(Boolean);

const OUTREACH_LIMIT = parseInt(process.env.BOT_OUTREACH_LIMIT || "50", 10);
const DISCOVERY_INTERVAL_HOURS = parseInt(process.env.BOT_DISCOVERY_INTERVAL_HOURS || "24", 10);
const OUTREACH_INTERVAL_HOURS = parseInt(process.env.BOT_OUTREACH_INTERVAL_HOURS || "6", 10);

function runScript(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    console.log(`\n[${new Date().toISOString()}] Running: node ${path.basename(scriptPath)} ${args.join(" ")}`);
    
    const proc = spawn("node", [scriptPath, ...args], {
      stdio: "inherit",
      env: process.env,
      cwd: path.dirname(scriptPath),
    });

    proc.on("exit", (code) => {
      if (code === 0) {
        resolve(code);
      } else {
        reject(new Error(`Script exited with code ${code}`));
      }
    });

    proc.on("error", (err) => {
      reject(err);
    });
  });
}

async function runDiscovery() {
  console.log("=".repeat(60));
  console.log("🤖 Bot Discovery Cycle");
  console.log("=".repeat(60));
  
  for (const platform of DISCOVERY_PLATFORMS) {
    try {
      console.log(`\n📡 Discovering bots on ${platform}...`);
      await runScript(DISCOVERY_SCRIPT, [platform]);
      console.log(`✅ ${platform} discovery completed`);
    } catch (err) {
      console.error(`❌ ${platform} discovery failed:`, err.message);
    }
  }
}

async function runOutreach() {
  console.log("=".repeat(60));
  console.log("📨 Bot Outreach Cycle");
  console.log("=".repeat(60));
  
  try {
    await runScript(OUTREACH_SCRIPT);
    console.log("✅ Outreach completed");
  } catch (err) {
    console.error("❌ Outreach failed:", err.message);
  }
}

async function runFullCycle() {
  console.log("\n" + "=".repeat(60));
  console.log(`🚀 Automated Bot Outreach Cycle - ${new Date().toISOString()}`);
  console.log("=".repeat(60));
  
  // Step 1: Discover new bots
  await runDiscovery();
  
  // Step 2: Contact uncontacted leads
  await runOutreach();
  
  console.log("\n" + "=".repeat(60));
  console.log("✅ Full cycle completed");
  console.log("=".repeat(60));
}

// ─── Scheduling Modes ────────────────────────────────────────────────────────

async function runOnce() {
  await runFullCycle();
  process.exit(0);
}

async function runContinuous() {
  console.log("\n🔄 Starting continuous scheduling mode");
  console.log(`   Discovery interval: ${DISCOVERY_INTERVAL_HOURS} hours`);
  console.log(`   Outreach interval: ${OUTREACH_INTERVAL_HOURS} hours`);
  console.log(`   Platforms: ${DISCOVERY_PLATFORMS.join(", ")}`);
  
  // Run immediately
  await runFullCycle();
  
  // Then schedule periodic runs
  const discoveryInterval = DISCOVERY_INTERVAL_HOURS * 60 * 60 * 1000;
  const outreachInterval = OUTREACH_INTERVAL_HOURS * 60 * 60 * 1000;
  
  // Discovery runs less frequently
  setInterval(async () => {
    await runDiscovery();
  }, discoveryInterval);
  
  // Outreach runs more frequently (contacts discovered leads)
  setInterval(async () => {
    await runOutreach();
  }, outreachInterval);
  
  console.log("\n✅ Scheduler running. Press Ctrl+C to stop.");
  
  // Keep process alive
  process.on("SIGINT", () => {
    console.log("\n\n🛑 Stopping scheduler...");
    process.exit(0);
  });
  
  process.on("SIGTERM", () => {
    console.log("\n\n🛑 Stopping scheduler...");
    process.exit(0);
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || "once"; // "once" or "continuous"
  
  if (mode === "continuous") {
    await runContinuous();
  } else {
    await runOnce();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Fatal error:", err.message);
    process.exit(1);
  });
}

module.exports = { runDiscovery, runOutreach, runFullCycle };
