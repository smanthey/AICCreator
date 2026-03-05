import { defineMemory } from "../_schema";

export const memory = defineMemory({
  domain: "performance",
  type: "bug_class",
  name: "execsync_pm2_blocking",
  summary:
    "Using execSync for PM2 status queries blocks the Node event loop and can cause cascading timeouts under load.",
  invariants: [
    "PM2 list/status queries use async exec with promisified child_process.exec, never execSync.",
    "Global status and watchdog scripts await async PM2 helpers and handle timeouts explicitly.",
  ],
  failure_modes: [
    "Global status and dashboards stall for hundreds of milliseconds while PM2 serializes state.",
    "Under concurrent usage, blocked event loop causes HTTP timeouts and misclassification of healthy services.",
  ],
  severity: "high",
  detection_patterns: ["execSync(\"pm2", "execSync('pm2"],
  unsafe_pattern: "execSync(\"pm2 jlist\")",
  safe_pattern: "const { stdout } = await execAsync(\"pm2 jlist\")",
  canonical_implementation: {
    repo: "local/claw-architect",
    file: "scripts/global-redgreen-status.js",
    symbol: "pm2List",
  },
  related_core_module: {
    repo: "local/claw-architect",
    file: "scripts/architect-api.js",
  },
  notes: [
    "See MEMORY.md pattern: execSync(\"pm2 jlist\") blocks the Node event loop (CLAUDE.md landmine #2).",
    "Only one-shot CLI utilities may use execSync for PM2, never long-lived servers or dashboards.",
  ],
  version: "1.0.0",
  last_verified: "2026-03-02T00:00:00.000Z",
  tags: ["bug-class", "pm2", "execSync", "performance"],
});

