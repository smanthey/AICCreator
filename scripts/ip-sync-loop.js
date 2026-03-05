#!/usr/bin/env node
"use strict";

require("dotenv").config();

const { spawn } = require("child_process");

const intervalMin = Math.max(15, Number(process.env.IP_SYNC_INTERVAL_MIN || "720") || 720);

function runOnce() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["scripts/ip-sync-uspto.js"], {
      cwd: process.cwd(),
      stdio: "inherit",
      env: process.env,
    });
    child.on("close", () => resolve());
  });
}

async function tick() {
  const started = new Date();
  console.log(`[ip-sync-loop] tick start ${started.toISOString()}`);
  await runOnce();
  const ended = new Date();
  console.log(`[ip-sync-loop] tick end ${ended.toISOString()}`);
}

(async () => {
  await tick();
  setInterval(tick, intervalMin * 60 * 1000);
  console.log(`[ip-sync-loop] running every ${intervalMin} minutes`);
})();
