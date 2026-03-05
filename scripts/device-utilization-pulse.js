#!/usr/bin/env node
"use strict";

/**
 * scripts/device-utilization-pulse.js
 * 
 * Periodic pulse to ensure all devices are utilized.
 * Runs every 2 minutes to check for idle devices and generate work.
 */

require("dotenv").config({ override: true });

const {
  ensureIdleDevicesHaveWork,
  getUtilizationStats,
  rebalanceWork,
} = require("../control/device-utilization");

async function main() {
  console.log(`[utilization-pulse] Starting at ${new Date().toISOString()}`);
  
  try {
    // Get current utilization stats
    const stats = await getUtilizationStats();
    console.log(`[utilization-pulse] Stats:`, {
      online: stats.online_devices,
      idle: stats.idle_devices,
      busy: stats.busy_devices,
      utilization: `${stats.utilization_percent}%`,
      avg_jobs: stats.avg_jobs_per_device.toFixed(1),
      max_jobs: stats.max_jobs_per_device,
    });
    
    // Generate work for idle devices
    if (stats.idle_devices > 0) {
      console.log(`[utilization-pulse] Generating work for ${stats.idle_devices} idle device(s)...`);
      const generated = await ensureIdleDevicesHaveWork();
      if (generated.length > 0) {
        console.log(`[utilization-pulse] Generated ${generated.length} task(s) for idle devices:`, 
          generated.map(g => `${g.device_id} -> ${g.task_id.slice(0, 8)}`).join(", ")
        );
      } else {
        console.log(`[utilization-pulse] No new work generated (tasks may already exist)`);
      }
    }
    
    // Rebalance if utilization is low
    if (stats.utilization_percent < 80 && stats.online_devices > 1) {
      console.log(`[utilization-pulse] Utilization low (${stats.utilization_percent}%), attempting rebalance...`);
      const rebalanced = await rebalanceWork();
      if (rebalanced.length > 0) {
        console.log(`[utilization-pulse] Rebalanced ${rebalanced.length} task(s)`);
      }
    }
    
    console.log(`[utilization-pulse] Complete`);
  } catch (err) {
    console.error(`[utilization-pulse] Error:`, err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[utilization-pulse] Fatal:", err);
    process.exit(1);
  });
}

module.exports = { main };
