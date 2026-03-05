import { defineMemory } from "../_schema";

export const memory = defineMemory({
  domain: "monitoring",
  type: "bug_class",
  name: "cron_restart_false_positive",
  summary:
    "Uptime watchdog misclassifies healthy cron processes as crash loops when using restart count alone without status.",
  invariants: [
    "Cron processes in stopped state with high restart counts are treated as healthy (expected behavior for */N jobs).",
    "Crash-loop detection for cron processes requires both status === \"online\" and an unusually high restart count.",
  ],
  failure_modes: [
    "Healthy cron processes are repeatedly restarted, creating noise and hiding real failures.",
    "Operators waste time investigating expected stopped cron jobs flagged as crash loops.",
  ],
  severity: "medium",
  detection_query: {
    type: "search_text",
    pattern: "cron_crash_loop",
    file_pattern: "scripts/uptime-watchdog-*.js",
  },
  canonical_implementation: {
    repo: "local/claw-architect",
    file: "control/uptime-watchdog-agents.js",
    symbol: "classifyProcess",
  },
  related_core_module: {
    repo: "local/claw-architect",
    file: "docs/UPTIME-WATCHDOG.md",
  },
  notes: [
    "See MEMORY.md entry: uptime-watchdog false positive cron_crash_loop, 2026-03-02.",
    "Cron processes should accumulate restarts over time; status is the key differentiator.",
  ],
  version: "1.0.0",
  last_verified: "2026-03-02T00:00:00.000Z",
  tags: ["bug-class", "cron", "uptime", "watchdog"],
});

