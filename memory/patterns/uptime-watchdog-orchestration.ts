import { defineMemory } from "../_schema";

export const memory = defineMemory({
  domain: "uptime",
  type: "runbook",
  name: "uptime_watchdog_hourly_orchestration",
  summary:
    "Uptime watchdog runs hourly as the orchestrator for PM2, heartbeats, and queues, with deterministic recovery and optional LLM diagnosis.",
  invariants: [
    "The uptime watchdog hourly job (`claw-uptime-watchdog-hourly`) runs on cron `0 * * * *`.",
    "Checkers (pm2Checker, heartbeatChecker, queueChecker) execute in parallel, and recoveryExecutor applies fixes in a bounded sequence.",
    "Recovery failures trigger diagnosisAgent, which appends actionable suggestions to the latest report instead of silently failing.",
  ],
  failure_modes: [
    "Fallen-off PM2 processes and agents remain down for hours because the watchdog is disabled or misconfigured.",
    "Crash loops when recovery actions are retried without bounded attempts or backoff.",
    "Operators blind to failure because reports are not written or surfaced to dashboards.",
  ],
  canonical_implementation: {
    repo: "local/claw-architect",
    file: "scripts/uptime-watchdog-hourly.js",
    symbol: "runUptimeWatchdog",
  },
  related_core_module: {
    repo: "local/claw-architect",
    file: "docs/UPTIME-WATCHDOG.md",
  },
  notes: [
    "See docs/UPTIME-WATCHDOG.md for schedule, roles, and CLI usage.",
    "Reports must be written to reports/uptime-watchdog-latest.json and timestamped history files.",
    "Dry-runs (`npm run uptime:watchdog:dry`) should be used in new environments before enabling full recovery.",
  ],
  version: "1.0.0",
  last_verified: "2026-03-02T00:00:00.000Z",
  tags: ["uptime", "watchdog", "pm2", "queue", "runbook"],
});

