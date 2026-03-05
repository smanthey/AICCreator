pm2 restart claw-prompt-oracle
#!/usr/bin/env node
"use strict";

/**
 * kill-commerce-server.js
 * Kills any process running on port 3031 (commerce webhook server)
 */

const { execSync } = require("child_process");

const PORT = 3031;

try {
  console.log(`🔍 Checking for processes on port ${PORT}...`);
  
  // Find processes using the port
  const result = execSync(`lsof -ti :${PORT}`, { encoding: "utf8" }).trim();
  
  if (!result) {
    console.log(`✅ No process found on port ${PORT}`);
    process.exit(0);
  }

  const pids = result.split("\n").filter(Boolean);
  console.log(`📋 Found ${pids.length} process(es) on port ${PORT}: ${pids.join(", ")}`);

  for (const pid of pids) {
    try {
      execSync(`kill ${pid}`, { stdio: "inherit" });
      console.log(`✅ Killed process ${pid}`);
    } catch (err) {
      console.error(`❌ Failed to kill process ${pid}: ${err.message}`);
      // Try force kill
      try {
        execSync(`kill -9 ${pid}`, { stdio: "inherit" });
        console.log(`✅ Force killed process ${pid}`);
      } catch (err2) {
        console.error(`❌ Failed to force kill process ${pid}: ${err2.message}`);
      }
    }
  }

  console.log(`\n✅ Port ${PORT} is now free. You can start the server.`);
} catch (err) {
  if (err.status === 1) {
    // lsof returns 1 when no processes found
    console.log(`✅ No process found on port ${PORT}`);
  } else {
    console.error(`❌ Error: ${err.message}`);
    process.exit(1);
  }
}
