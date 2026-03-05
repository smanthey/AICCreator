#!/usr/bin/env node
"use strict";

/**
 * dashboard-nudge.js
 * Nudges idle "continue" dashboard lanes by calling the architect API.
 * Run on a schedule (e.g. every 15–30 min) so pipelines keep moving without manual Continue clicks.
 *
 * Usage:
 *   npm run dashboard:nudge           # Trigger continue actions that have been idle > NUDGE_IDLE_MINUTES
 *   npm run dashboard:nudge:dry        # Only list what would be nudged (no triggers)
 *   npm run dashboard:nudge -- --dry-run   # Same as :dry
 *
 * Env: ARCHITECT_PORT (default 4051), ARCHITECT_API_KEY (optional), ARCHITECT_NUDGE_IDLE_MINUTES (default 30)
 *
 * Cron example (every 30 min): 0,30 * * * * cd /path/to/claw-architect && npm run -s dashboard:nudge
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const http = require("http");
const PORT = parseInt(process.env.ARCHITECT_PORT || "4051", 10);
const API_KEY = process.env.ARCHITECT_API_KEY || null;
const dryRun = process.argv.includes("--dry-run") || process.argv.includes("--dry");

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: "127.0.0.1",
      port: PORT,
      path,
      method,
      headers: { "Content-Type": "application/json" },
    };
    if (API_KEY) opts.headers["Authorization"] = `Bearer ${API_KEY}`;
    const req = http.request(opts, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        try {
          const data = buf ? JSON.parse(buf) : {};
          if (res.statusCode >= 400) {
            const err = new Error(data.error || `HTTP ${res.statusCode}`);
            err.statusCode = res.statusCode;
            err.body = data;
            reject(err);
          } else {
            resolve(data);
          }
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", (err) => {
      err.statusCode = null;
      reject(err);
    });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

(async () => {
  try {
    if (dryRun) {
      const data = await request("GET", "/api/dashboard/nudge");
      console.log("Nudge candidates (idle continue actions):");
      console.log(JSON.stringify(data, null, 2));
      if (data.candidates && data.candidates.length > 0) {
        console.log(`\nRun without --dry-run to trigger ${data.candidates.length} action(s).`);
      }
      return;
    }

    const data = await request("POST", "/api/dashboard/nudge", { execute: true });
    console.log("Nudge result:", JSON.stringify(data, null, 2));
    if (data.nudged && data.nudged.length > 0) {
      console.log(`Triggered ${data.nudged.filter((n) => n.accepted).length} action(s).`);
    }
  } catch (err) {
    if (err.code === "ECONNREFUSED") {
      console.error("Dashboard nudge failed: cannot reach architect API.");
      console.error(`  Start the API with: npm run architect:api`);
      console.error(`  (expected http://127.0.0.1:${PORT})`);
    } else if (err.statusCode === 404) {
      console.error("Dashboard nudge failed: nudge endpoint not found (404).");
      console.error("  Ensure architect-api.js includes /api/dashboard/nudge and the API process is the latest version.");
      console.error(`  API should be running: npm run architect:api on port ${PORT}`);
    } else if (err.statusCode === 401) {
      console.error("Dashboard nudge failed: unauthorized (401).");
      console.error("  If ARCHITECT_API_KEY is set, pass the same value when running this script (it reads from .env).");
    } else {
      console.error("Dashboard nudge failed:", err.message);
    }
    process.exitCode = 1;
  }
})();
