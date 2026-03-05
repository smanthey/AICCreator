import { defineMemory } from "../_schema";

export const memory = defineMemory({
  domain: "pm2",
  type: "pattern",
  name: "async_status_query_only",
  summary:
    "PM2 status and control operations on hot paths must use async exec with pm2 jlist, never execSync.",
  invariants: [
    "All PM2 status queries in long-running Node processes use async exec (child_process.exec / spawn) against `pm2 jlist`.",
    "No code on the Mission Control hot path calls `execSync` for PM2 commands.",
    "PM2 control operations (start/stop/restart) invoked from HTTP handlers or cron scripts are non-blocking and have timeouts.",
  ],
  failure_modes: [
    "Node event loop blocked by execSync on pm2, causing cascading timeouts across the API.",
    "Uptime watchdog and auto-heal loops stall, misclassifying healthy processes as down.",
    "Crash loops when watchdog retries pile up faster than PM2 can respond.",
  ],
  canonical_implementation: {
    repo: "local/claw-architect",
    file: "scripts/architect-api.js",
    symbol: "getPm2StatusAsync",
  },
  related_core_module: {
    repo: "local/claw-architect",
    file: "scripts/uptime-watchdog-hourly.js",
    symbol: "runUptimeWatchdog",
  },
  notes: [
    "See CLAUDE.md landmine: \"Do not use execSync for PM2 calls.\"",
    "The only acceptable synchronous PM2 usage is in one-shot CLI utilities, not in long-lived servers.",
    "New PM2 helpers must be added to a central module and audited before use elsewhere.",
  ],
  version: "1.0.0",
  last_verified: "2026-03-02T00:00:00.000Z",
  tags: ["pm2", "async", "uptime", "pattern", "landmine"],
});

