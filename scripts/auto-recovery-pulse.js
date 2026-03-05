#!/usr/bin/env node
"use strict";

/**
 * auto-recovery-pulse.js
 * 
 * Periodic health check and auto-recovery for all PM2 services.
 * Runs on a frequent cron to ensure everything stays running.
 * 
 * This script:
 * - Checks if critical services are running
 * - Restarts stopped/errored services
 * - Saves PM2 state periodically
 * - Logs recovery actions
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const { exec } = require("child_process");
const path = require("path");
const { promisify } = require("util");

const execAsync = promisify(exec);

const REPO = path.join(__dirname, "..");
const MIN_ONLINE_AGENTS = Math.max(1, Number(process.env.AUTO_RECOVERY_MIN_ONLINE_AGENTS || "8"));

// Critical services that must always be running
const CRITICAL_SERVICES = [
  "claw-architect-api",
  "claw-dispatcher",
  "claw-ollama",
  "claw-openclaw-coordinator",
];

// Important services (should be running but not critical)
const IMPORTANT_SERVICES = [
  "claw-worker-nas",
  "claw-worker-ai",
  "claw-worker",
  "claw-task-governor",
  "clawpay-task-master",
  "claw-webhook-server",
  "claw-prompt-oracle",
  "claw-coordinator-watchdog",
];

const ONLINE_FLOOR_PRIORITY = [
  "claw-dispatcher",
  "claw-worker",
  "claw-worker-ai",
  "claw-worker-nas",
  "claw-task-governor",
  "clawpay-task-master",
  "claw-webhook-server",
  "claw-architect-api",
  "claw-openclaw-coordinator",
  "claw-ollama",
];

// ─── Get PM2 Process List (async, non-blocking) ─────────────────────────

async function getPM2Processes() {
  try {
    const { stdout } = await execAsync("pm2 jlist", { cwd: REPO, timeout: 10_000, maxBuffer: 5 * 1024 * 1024 });
    return JSON.parse(stdout);
  } catch {
    return [];
  }
}

// ─── Check Service Status ────────────────────────────────────────────────

async function checkServiceStatus(processName) {
  const processes = await getPM2Processes();
  const matches = processes.filter((p) => (p.name || "") === processName);

  if (matches.length === 0) {
    return { exists: false, status: "missing" };
  }

  const onlineCount = matches.filter((p) => p.pm2_env?.status === "online").length;
  const proc = matches[0];

  return {
    exists: true,
    status: onlineCount > 0 ? "online" : (proc.pm2_env?.status || "unknown"),
    onlineCount,
    totalCount: matches.length,
    restarts: proc.pm2_env?.restart_time || 0,
    uptime: proc.pm2_env?.pm_uptime || 0,
  };
}

// ─── Restart Service (async) ─────────────────────────────────────────────

async function restartService(processName) {
  try {
    await execAsync(`pm2 restart ${processName}`, { cwd: REPO, timeout: 15_000, maxBuffer: 1 * 1024 * 1024 });
    return true;
  } catch (err) {
    console.error(`[auto-recovery] Failed to restart ${processName}:`, err.message);
    return false;
  }
}

// ─── Start Service (async) ───────────────────────────────────────────────

async function startService(processName) {
  try {
    // Try to start from saved configs
    const configs = ["ecosystem.background.config.js", "ecosystem.config.js"];

    for (const config of configs) {
      try {
        await execAsync(`pm2 start ${config} --only ${processName}`, {
          cwd: REPO,
          timeout: 30_000,
          maxBuffer: 1 * 1024 * 1024,
        });
        return true;
      } catch {
        // Try next config
      }
    }

    return false;
  } catch (err) {
    console.error(`[auto-recovery] Failed to start ${processName}:`, err.message);
    return false;
  }
}

// ─── Save PM2 State (async) ──────────────────────────────────────────────

async function savePM2State() {
  try {
    await execAsync("pm2 save", { cwd: REPO, timeout: 30_000, maxBuffer: 512 * 1024 });
    return true;
  } catch {
    return false;
  }
}

// ─── Main Recovery Cycle ───────────────────────────────────────────────

async function main() {
  console.log(`[auto-recovery] Health check at ${new Date().toISOString()}`);
  
  const processes = await getPM2Processes();
  const online = processes.filter(p => p.pm2_env?.status === "online");
  const stopped = processes.filter(p => p.pm2_env?.status === "stopped");
  const errored = processes.filter(p => p.pm2_env?.status === "errored");
  
  console.log(`[auto-recovery] Status: ${online.length} online, ${stopped.length} stopped, ${errored.length} errored`);
  
  let recovered = 0;
  let failed = 0;
  
  // Check critical services
  for (const service of CRITICAL_SERVICES) {
    const status = await checkServiceStatus(service);
    
    if (!status.exists || status.status !== "online") {
      console.log(`[auto-recovery] ⚠️  Critical service ${service} is ${status.status}`);
      
      if (status.exists) {
        // Restart existing service
        if (await restartService(service)) {
          console.log(`[auto-recovery] ✅ Restarted ${service}`);
          recovered++;
        } else {
          console.log(`[auto-recovery] ❌ Failed to restart ${service}`);
          failed++;
        }
      } else {
        // Try to start missing service
        if (await startService(service)) {
          console.log(`[auto-recovery] ✅ Started ${service}`);
          recovered++;
        } else {
          console.log(`[auto-recovery] ❌ Failed to start ${service}`);
          failed++;
        }
      }
    }
  }
  
  // Check important services (less aggressive)
  for (const service of IMPORTANT_SERVICES) {
    const status = await checkServiceStatus(service);

    if (!status.exists || status.status !== "online") {
      console.log(`[auto-recovery] ⚠️  Important service ${service} is ${status.status}`);
      if (await startService(service)) {
        console.log(`[auto-recovery] ✅ Started ${service}`);
        recovered++;
      } else {
        console.log(`[auto-recovery] ❌ Failed to start ${service}`);
        failed++;
      }
      continue;
    }

    if (status.status === "errored" && status.restarts < 5) {
      // Only restart if errored and hasn't restarted too many times
      console.log(`[auto-recovery] ⚠️  Important service ${service} is errored`);
      if (await restartService(service)) {
        console.log(`[auto-recovery] ✅ Restarted ${service}`);
        recovered++;
      }
    }
  }

  // Enforce minimum number of online agents/processes.
  const afterServiceChecks = await getPM2Processes();
  let onlineCount = afterServiceChecks.filter((p) => p.pm2_env?.status === "online").length;
  if (onlineCount < MIN_ONLINE_AGENTS) {
    console.log(
      `[auto-recovery] ⚠️  Online floor breach (${onlineCount}/${MIN_ONLINE_AGENTS}). Starting floor-priority services...`
    );
    for (const service of ONLINE_FLOOR_PRIORITY) {
      if (onlineCount >= MIN_ONLINE_AGENTS) break;
      const status = await checkServiceStatus(service);
      if (status.status === "online") continue;
      if (await startService(service)) {
        recovered++;
        console.log(`[auto-recovery] ✅ Floor start ${service}`);
      } else {
        failed++;
        console.log(`[auto-recovery] ❌ Floor start failed ${service}`);
      }
      const refreshed = await getPM2Processes();
      onlineCount = refreshed.filter((p) => p.pm2_env?.status === "online").length;
    }
    console.log(`[auto-recovery] Floor result: ${onlineCount} online`);
  }
  
  // Save state every 10th run (every ~50 minutes)
  const shouldSave = Math.random() < 0.1;
  if (shouldSave) {
    await savePM2State();
    console.log(`[auto-recovery] 💾 Saved PM2 state`);
  }
  
  if (recovered > 0) {
    console.log(`[auto-recovery] ✅ Recovered ${recovered} service(s)`);
  }
  
  if (failed > 0) {
    console.log(`[auto-recovery] ❌ Failed to recover ${failed} service(s)`);
  }
  
  if (recovered === 0 && failed === 0) {
    console.log(`[auto-recovery] ✅ All services healthy`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[auto-recovery] Fatal:", err);
    process.exit(1);
  });
}

module.exports = { main };
