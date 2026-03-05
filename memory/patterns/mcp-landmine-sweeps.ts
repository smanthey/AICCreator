import { defineMemory } from "../_schema";

export const memory = defineMemory({
  domain: "agent_system",
  type: "pattern",
  name: "mcp_landmine_sweeps",
  summary:
    "Daily MCP landmine sweeps use search_text over indexed repos to detect dangerous patterns and open structured refactor tasks.",
  invariants: [
    "Landmine search patterns are defined centrally in config/mission-openclaw-architect.json under mcp_sweeps.landmine_search_text_patterns.",
    "Sweeps iterate over all local/* and configured exemplar repos, classifying each hit as landmine or acceptable legacy.",
    "Confirmed landmines result in structured refactor tasks with repo, file path, and suggested fix, not ad-hoc TODOs.",
  ],
  failure_modes: [
    "Known landmines (execSync, JSON shared state, legacy email providers) persist in hot paths because sweeps are not run.",
    "False positives create noise when classification is skipped and every hit opens a task.",
    "Mission configuration drifts out of sync with the actual landmine patterns used by agents.",
  ],
  canonical_implementation: {
    repo: "local/claw-architect",
    file: "docs/mcp-sweeps-landmines.md",
    symbol: "MCP Landmine Sweeps",
  },
  related_core_module: {
    repo: "local/claw-architect",
    file: "config/mission-openclaw-architect.json",
  },
  notes: [
    "Landmine sweeps should be scheduled as part of daily QA/maintenance, not only on demand.",
    "Patterns must stay aligned with AGENTS.md landmines to avoid drift between documentation and enforcement.",
    "Output tasks should be routed into the modernization/refactor queues with clear ownership.",
  ],
  version: "1.0.0",
  last_verified: "2026-03-02T00:00:00.000Z",
  tags: ["mcp", "landmine", "sweeps", "pattern"],
});

