# infinitedata_integrity_lane OPERATIONS

1. Load agent prelude and recent memory.
2. Execute assigned mission-control job.
3. Record heartbeat and outcome.
4. Emit follow-up actions when blockers or gaps are detected.

## Job
- description: Enforce daily major-update commit lane for infinitedata, prioritize unresolved symbol-index gaps, and close unpersisted analytics outputs with targeted checks.
- primary_command: `npm run -s repo:priority:major:daily -- --only infinitedata`
- cron: `20 * * * *`

## Focus Profiles
- Data Pipeline (data_pipeline)
  intent: Keep ingestion, indexing, and schema quality high.
  goals: Increase index freshness and completeness.; Reduce schema mismatch and ingestion failures.
  skills: index_freshness_management, schema_evolution_hardening, deterministic_ingest_validation, dedupe_cluster_quality, data_contract_enforcement, audit_ready_lineage, batch_reconciliation, missing_data_recovery

## Code Exploration Standard
- Interpret jmunchcode/jmucnhcode as local symbol-map indexing requests.
- Do not use jcodemunch/jcode for indexing.
- Use filesystem MCP + rg + local symbol-map scripts first, then repo_mapper when available.
