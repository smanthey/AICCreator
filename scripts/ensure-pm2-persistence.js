#!/usr/bin/env node
"use strict";

/**
 * ensure-pm2-persistence.js
 * 
 * Ensures all critical systems are running under PM2 for persistence.
 * This script:
 * 1. Checks if PM2 is installed
 * 2. Verifies PM2 startup is configured
 * 3. Ensures all critical processes are running
 * 4. Provides setup instructions if needed
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const { execSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const CRITICAL_PROCESSES = [
  "claw-architect-api",
  "claw-dispatcher",
  "claw-worker",
  "claw-prompt-oracle",
];

// ─── Check PM2 Installation ──────────────────────────────────────────────

function checkPM2Installed() {
  try {
    execSync("pm2 --version", { encoding: "utf8", stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

// ─── Check PM2 Startup ────────────────────────────────────────────────────

function checkPM2Startup() {
  try {
    const result = execSync("pm2 startup", { encoding: "utf8", stdio: "pipe" });
    // If startup is already configured, it will say "PM2 is already in startup"
    return result.includes("already") || result.includes("systemd") || result.includes("launchd");
  } catch {
    return false;
  }
}

// ─── Get PM2 Process List ─────────────────────────────────────────────────

function getPM2Processes() {
  try {
    const result = execSync("pm2 jlist", { encoding: "utf8", stdio: "pipe" });
    return JSON.parse(result);
  } catch {
    return [];
  }
}

// ─── Check if Process is Running ─────────────────────────────────────────

function isProcessRunning(processName) {
  const processes = getPM2Processes();
  return processes.some((p) => {
    const name = p.name || "";
    return name === processName && p.pm2_env?.status === "online";
  });
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(60));
  console.log("🔍 PM2 Persistence Check");
  console.log("=".repeat(60));
  console.log();

  // Check PM2 installation
  console.log("1. Checking PM2 installation...");
  if (!checkPM2Installed()) {
    console.error("❌ PM2 is not installed!");
    console.log();
    console.log("Install PM2:");
    console.log("  npm install -g pm2");
    process.exit(1);
  }
  console.log("✅ PM2 is installed");
  console.log();

  // Check PM2 startup
  console.log("2. Checking PM2 startup configuration...");
  try {
    const startupCheck = execSync("pm2 startup", { encoding: "utf8", stdio: "pipe" });
    if (startupCheck.includes("already")) {
      console.log("✅ PM2 startup is configured");
    } else if (startupCheck.includes("sudo")) {
      console.log("⚠️  PM2 startup needs to be configured");
      console.log();
      console.log("Run this command (copy the output above):");
      console.log(startupCheck);
    } else {
      console.log("✅ PM2 startup appears configured");
    }
  } catch (err) {
    console.log("⚠️  Could not verify PM2 startup configuration");
    console.log("   Run: pm2 startup");
  }
  console.log();

  // Check critical processes
  console.log("3. Checking critical processes...");
  const processes = getPM2Processes();
  const running = processes.filter((p) => p.pm2_env?.status === "online");
  const stopped = processes.filter((p) => p.pm2_env?.status === "stopped");

  console.log(`   Total PM2 processes: ${processes.length}`);
  console.log(`   Running: ${running.length}`);
  console.log(`   Stopped: ${stopped.length}`);
  console.log();

  let allCriticalRunning = true;
  for (const procName of CRITICAL_PROCESSES) {
    const isRunning = isProcessRunning(procName);
    if (isRunning) {
      console.log(`   ✅ ${procName} - running`);
    } else {
      console.log(`   ❌ ${procName} - NOT running`);
      allCriticalRunning = false;
    }
  }
  console.log();

  // Check if PM2 save is needed
  console.log("4. Checking PM2 save state...");
  try {
    const saveFile = path.join(process.env.HOME || process.env.USERPROFILE || "", ".pm2", "dump.pm2");
    if (fs.existsSync(saveFile)) {
      const stats = fs.statSync(saveFile);
      const ageHours = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60);
      if (ageHours > 24) {
        console.log("⚠️  PM2 save state is older than 24 hours");
        console.log("   Run: pm2 save");
      } else {
        console.log("✅ PM2 save state is recent");
      }
    } else {
      console.log("⚠️  PM2 save state not found");
      console.log("   Run: pm2 save");
    }
  } catch {
    console.log("⚠️  Could not check PM2 save state");
  }
  console.log();

  // Summary
  console.log("=".repeat(60));
  if (allCriticalRunning) {
    console.log("✅ All critical processes are running under PM2");
    console.log();
    console.log("Your systems will persist even if you close terminals.");
    console.log("To verify: Close all terminals and check 'pm2 status' in a new terminal.");
  } else {
    console.log("⚠️  Some critical processes are not running");
    console.log();
    console.log("To start all processes:");
    console.log("  pm2 start ecosystem.background.config.js");
    console.log("  pm2 start ecosystem.config.js");
    console.log("  pm2 save");
  }
  console.log();
  console.log("Useful commands:");
  console.log("  pm2 status          - View all processes");
  console.log("  pm2 logs            - View all logs");
  console.log("  pm2 logs <name>     - View specific process logs");
  console.log("  pm2 restart all     - Restart all processes");
  console.log("  pm2 save            - Save current process list");
  console.log("  pm2 startup         - Configure auto-start on boot");
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
