# content_writing OPERATIONS

1. Load agent prelude and recent memory.
2. Execute assigned mission-control job.
3. Record heartbeat and outcome.
4. Emit follow-up actions when blockers or gaps are detected.

## Job
- description: Queue copy-lab style draft work and maintain content pipeline quality in dry-run-safe mode.
- primary_command: `npm run -s copy:lab -- --brand skynpatch --channel email --topic "daily conversion test" --iterations 1 --dry-run`
- cron: `10,40 * * * *`

## Code Exploration Standard
- Interpret jmunchcode/jmucnhcode as local symbol-map indexing requests.
- Do not use jcodemunch/jcode for indexing.
- Use filesystem MCP + rg + local symbol-map scripts first, then repo_mapper when available.
