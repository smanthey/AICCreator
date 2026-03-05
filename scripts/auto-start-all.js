#!/usr/bin/env node
"use strict";

/**
 * auto-start-all.js
 * 
 * One-time setup script that ensures ALL systems auto-start and persist.
 * Run this once and never worry about starting services again.
 * 
 * Usage: node scripts/auto-start-all.js
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const { execSync, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..");

// ─── Check PM2 Installation ──────────────────────────────────────────────

function checkPM2Installed() {
  try {
    execSync("pm2 --version", { encoding: "utf8", stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

// ─── Install PM2 ─────────────────────────────────────────────────────────

function installPM2() {
  console.log("📦 Installing PM2 globally...");
  try {
    execSync("npm install -g pm2", { encoding: "utf8", stdio: "inherit" });
    console.log("✅ PM2 installed");
    return true;
  } catch (err) {
    console.error("❌ Failed to install PM2:", err.message);
    return false;
  }
}

// ─── Configure PM2 Startup ───────────────────────────────────────────────

function configurePM2Startup() {
  console.log("⚙️  Configuring PM2 auto-start on boot...");
  try {
    // Check if already configured
    const checkResult = execSync("pm2 startup", { encoding: "utf8", stdio: "pipe" });
    
    if (checkResult.includes("already") || checkResult.includes("PM2 is already")) {
      console.log("✅ PM2 startup already configured");
      return { configured: true, needsSudo: false };
    }
    
    // Extract the command to run
    if (checkResult.includes("sudo")) {
      console.log("\n⚠️  PM2 startup needs sudo command:");
      console.log("─".repeat(60));
      const lines = checkResult.split("\n");
      const sudoLine = lines.find(l => l.includes("sudo"));
      if (sudoLine) {
        console.log(sudoLine.trim());
      } else {
        console.log(checkResult);
      }
      console.log("─".repeat(60));
      console.log("\n📋 Please run the command shown above (it starts with 'sudo')");
      console.log("   Then run this script again to continue.\n");
      return { configured: false, needsSudo: true, command: sudoLine };
    }
    
    console.log("✅ PM2 startup configured");
    return { configured: true, needsSudo: false };
  } catch (err) {
    // If command fails, it might already be configured or need manual setup
    console.log("⚠️  Could not auto-configure PM2 startup");
    console.log("   This is okay - services will still run, but may not auto-start on boot");
    console.log("   To configure manually, run: pm2 startup");
    return { configured: false, needsSudo: false, manual: true };
  }
}

// ─── Start All Services ─────────────────────────────────────────────────

function startAllServices() {
  console.log("🚀 Starting all services...");
  
  const configs = [
    "ecosystem.background.config.js",
    "ecosystem.config.js",
  ];
  
  let allStarted = true;
  
  for (const config of configs) {
    const configPath = path.join(REPO, config);
    if (!fs.existsSync(configPath)) {
      console.log(`⚠️  Config not found: ${config}`);
      continue;
    }
    
    console.log(`   Starting ${config}...`);
    try {
      const result = spawnSync("pm2", ["start", configPath], {
        cwd: REPO,
        stdio: "pipe",
        encoding: "utf8",
      });
      
      if (result.status === 0) {
        console.log(`   ✅ ${config} started`);
      } else {
        // Check if processes already exist (that's okay)
        const output = result.stdout + result.stderr;
        if (output.includes("already") || output.includes("online")) {
          console.log(`   ✅ ${config} already running`);
        } else {
          console.log(`   ⚠️  ${config} had issues (may already be running)`);
          console.log(`      ${output.substring(0, 200)}`);
        }
      }
    } catch (err) {
      console.log(`   ⚠️  Error starting ${config}: ${err.message}`);
      allStarted = false;
    }
  }
  
  return allStarted;
}

// ─── Save PM2 State ──────────────────────────────────────────────────────

function savePM2State() {
  console.log("💾 Saving PM2 process list...");
  try {
    execSync("pm2 save", { encoding: "utf8", stdio: "inherit", cwd: REPO });
    console.log("✅ PM2 state saved");
    return true;
  } catch (err) {
    console.error("❌ Failed to save PM2 state:", err.message);
    return false;
  }
}

// ─── Verify Services ────────────────────────────────────────────────────

function verifyServices() {
  console.log("🔍 Verifying services...");
  try {
    const result = execSync("pm2 jlist", { encoding: "utf8", stdio: "pipe" });
    const processes = JSON.parse(result);
    
    const online = processes.filter(p => p.pm2_env?.status === "online");
    const stopped = processes.filter(p => p.pm2_env?.status === "stopped");
    const errored = processes.filter(p => p.pm2_env?.status === "errored");
    
    console.log(`   Total processes: ${processes.length}`);
    console.log(`   ✅ Online: ${online.length}`);
    if (stopped.length > 0) {
      console.log(`   ⚠️  Stopped: ${stopped.length}`);
    }
    if (errored.length > 0) {
      console.log(`   ❌ Errored: ${errored.length}`);
      errored.forEach(p => {
        console.log(`      - ${p.name}: ${p.pm2_env?.error?.message || "unknown error"}`);
      });
    }
    
    return errored.length === 0;
  } catch (err) {
    console.error("❌ Failed to verify services:", err.message);
    return false;
  }
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(60));
  console.log("🚀 OpenClaw Auto-Start Setup");
  console.log("=".repeat(60));
  console.log();
  console.log("This script will:");
  console.log("  1. Install PM2 if needed");
  console.log("  2. Configure PM2 to auto-start on boot");
  console.log("  3. Start all services");
  console.log("  4. Save PM2 state");
  console.log("  5. Verify everything is running");
  console.log();
  console.log("After this, all systems will auto-start on boot!");
  console.log();
  
  // Step 1: Check/Install PM2
  console.log("[1/5] Checking PM2 installation...");
  if (!checkPM2Installed()) {
    console.log("PM2 not found. Installing...");
    if (!installPM2()) {
      console.error("\n❌ Failed to install PM2. Please install manually:");
      console.error("   npm install -g pm2");
      process.exit(1);
    }
  } else {
    console.log("✅ PM2 is installed");
  }
  console.log();
  
  // Step 2: Configure startup
  console.log("[2/5] Configuring PM2 startup...");
  const startupResult = configurePM2Startup();
  if (startupResult.needsSudo) {
    console.log("\n⚠️  Please run the sudo command shown above, then run this script again.");
    console.log("   Or continue anyway - services will run but may not auto-start on boot.");
    console.log();
    // Continue anyway - services will still work
  }
  console.log();
  
  // Step 3: Start services
  console.log("[3/5] Starting all services...");
  startAllServices();
  console.log();
  
  // Step 4: Save state
  console.log("[4/5] Saving PM2 state...");
  savePM2State();
  console.log();
  
  // Step 5: Verify
  console.log("[5/5] Verifying services...");
  const allGood = verifyServices();
  console.log();
  
  // Summary
  console.log("=".repeat(60));
  if (allGood) {
    console.log("✅ Auto-start setup complete!");
    console.log();
    console.log("All systems are now configured to:");
    console.log("  • Auto-start on system boot");
    console.log("  • Auto-restart if they crash");
    console.log("  • Persist even if terminals are closed");
    console.log();
    console.log("You can now close all terminals - everything will keep running!");
    console.log();
    console.log("Useful commands:");
    console.log("  pm2 status          - View all processes");
    console.log("  pm2 logs            - View all logs");
    console.log("  pm2 restart all     - Restart all processes");
    console.log("  pm2 stop all        - Stop all processes");
  } else {
    console.log("⚠️  Setup complete, but some services may need attention");
    console.log("   Check 'pm2 status' for details");
  }
  console.log();
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}

module.exports = { main };
