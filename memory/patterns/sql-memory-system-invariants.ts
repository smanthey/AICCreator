import { defineMemory } from "../_schema";

export const memory = defineMemory({
  domain: "agent_system",
  type: "architecture",
  name: "sql_memory_system_invariants",
  summary:
    "SQL-backed agent memory must remain the single source of truth for long-term agent learning, with strict schema and access patterns.",
  invariants: [
    "All long-term agent memories (learned, insight, feedback, strategy, blocker, metric, summary) are stored in the agent_memory table.",
    "Memory writes go through the SQL memory module (control/agent-memory-sql.js), not ad-hoc INSERTs.",
    "Embeddings and full-text indexes stay in sync with the content column.",
  ],
  failure_modes: [
    "Agents regress or forget lessons because memories are written only to file logs and never persisted in SQL.",
    "Semantic search returns stale or no results because embeddings were not generated or updated.",
    "Ad-hoc schema drift when new content_type values are introduced outside the central module.",
  ],
  canonical_implementation: {
    repo: "local/claw-architect",
    file: "control/agent-memory-sql.js",
    symbol: "storeMemory",
  },
  related_core_module: {
    repo: "local/claw-architect",
    file: "control/agent-memory.js",
    symbol: "appendAgentDailyLog",
  },
  notes: [
    "See docs/SQL_MEMORY_SYSTEM.md for schema, integration points, and troubleshooting.",
    "New memory content types should be added centrally and documented; avoid one-off JSON in metadata.",
    "When embedding models change, a controlled re-embedding pass is required to avoid mixed distributions.",
  ],
  version: "1.0.0",
  last_verified: "2026-03-02T00:00:00.000Z",
  tags: ["sql", "memory", "agent", "architecture"],
});

