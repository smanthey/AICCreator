## Symbolic Memory Extraction Loop (Design)

This document defines how incidents, watchdog reports, and SQL memory should feed into structured `memory/` symbols, using jCodeMunch (and other MCP tools) as the indexing layer.

### 1. Goals

- **Distill**: Turn noisy incidents, logs, and reports into compact, reusable patterns (`memory/*`).
- **Align**: Keep `memory/*` aligned with core modules (PM2, queues, SQL memory, uptime).
- **Automate**: Make extraction as automatic as possible while preserving human review.

### 2. Inputs

- **Uptime watchdog reports**: `reports/uptime-watchdog-*.json`
- **Daily capability reports**: `reports/capability-factory/*.md` / `.json`
- **SQL agent memories**: via `control/agent-memory-sql.js`
- **Mission configs and sweeps**:
  - `config/mission-openclaw-architect.json` (landmine + drift patterns)
  - `docs/mcp-sweeps-landmines.md`
  - `docs/mcp-sweeps-drift.md`

### 3. Target artifacts

1. **Patterns** (`memory/patterns/*.ts`)
   - e.g. `pm2-async-status-query`, `redis_queue_reliability`, `sql_memory_system_invariants`.
2. **Runbooks** (`memory/runbooks/*.ts` or `type: "runbook"`)
   - e.g. `uptime_watchdog_hourly_orchestration`.
3. **Incidents** (`memory/incidents/*.ts` or `type: "incident"`)
   - Each maps a concrete failure to a root-cause pattern (or creates one).

All are typed via `memory/_schema.ts` and indexed by jCodeMunch.

### 4. High-level loop

1. **Collect raw evidence**
   - Scan recent uptime watchdog reports (last 24–72h).
   - Query SQL memory for high-importance `blocker` and `strategy` entries.
   - Read recent capability-factory summaries.
2. **Cluster by failure mode / theme**
   - Group items by domain: `pm2`, `queue`, `sql_memory`, `uptime`, `security`, etc.
   - Within each domain, group by recurring symptom (e.g. “PM2 crash-loop”, “DLQ spike”).
3. **Check for existing memory symbols**
   - Use jCodeMunch:
     - `search_symbols` in `memory/` for matching domain + name.
     - If found, **update** invariants / failure_modes instead of creating duplicates.
4. **Create or update MemoryObjects**
   - When a new pattern emerges, emit a `memory/patterns/*.ts` entry via the generator script.
   - For incidents, create `type: "incident"` entries that reference:
     - `canonical_implementation` (where it happened)
     - `related_core_module` (where the fix should live).
5. **Mark verification**
   - Whenever a fix lands and is confirmed, bump `version` and update `last_verified`.
   - MCP drift sweeps (`mcp-sweeps-drift.md`) use these fields to detect stale patterns.

### 5. Implementation sketch (scripts)

1. **Doc + report indexing**
   - `scripts/generate-doc-symbol-index.js` (already created):
     - Scans all `.md` files and creates `memory/docs-index.ts` with `{ path, title, tags }`.
     - jCodeMunch indexes this so cheap models can jump from a pattern to the right doc.
2. **Memory/skill generation**
   - `scripts/generate-memory-skill.js` (already created):
     - Takes a JSON spec and writes a typed `memory/patterns/*.ts` or `skills/*.ts` file.
     - Used by agents to emit new symbols instead of freeform markdown.
3. **Future: automated extractor**
   - A future `scripts/memory-extraction-loop.js` (or Trigger.dev task) should:
     - Read recent uptime reports and SQL memories.
     - Propose JSON specs for new/updated MemoryObjects.
     - Call `generate-memory-skill.js` to materialize them, then open a review task.

### 6. Interaction with Crunchcode / jCodeMunch MCP

- **Symbol-first access**:
  - Agents must use jCodeMunch (`search_symbols`, `get_symbol`) to fetch:
    - `memory/*` patterns and runbooks.
    - `skills/*` definitions.
    - `memory/docs-index.ts` entries for relevant markdown.
- **Drift + landmine sweeps**:
  - Landmine sweeps (docs/mcp-sweeps-landmines.md) and drift sweeps (docs/mcp-sweeps-drift.md) become:
    - Producers of incidents and pattern updates in `memory/`.
    - Consumers of `memory/*` to know what “good” looks like.

This keeps markdown, reports, and runtime behavior compressed into a small, symbol-indexed knowledge graph that cheap models can query and maintain.

