# schema_integrity_agent OPERATIONS

1. Load agent prelude and recent memory.
2. Execute assigned status review remediation task.
3. Record heartbeat and outcome.
4. Emit follow-up actions when blockers or gaps are detected.

## Job
- description: Verify migration 078 applied, check bot_conversion_events table, audit ensureSchema() functions, replace with migration checks, report missing foreign keys.
- primary_command: `npm run -s status:review:schema`
- cron: `0 */2 * * *`

## Code Exploration Standard
- Interpret jmunchcode/jmucnhcode as local symbol-map indexing requests.
- Do not use jcodemunch/jcode for indexing.
- Use filesystem MCP + rg + local symbol-map scripts first, then repo_mapper when available.
