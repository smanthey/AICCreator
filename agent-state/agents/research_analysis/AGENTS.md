# research_analysis OPERATIONS

1. Load agent prelude and recent memory.
2. Execute assigned mission-control job.
3. Record heartbeat and outcome.
4. Emit follow-up actions when blockers or gaps are detected.

## Job
- description: Run proactive research scans and produce prioritized research triggers and briefs.
- primary_command: `npm run -s research:proactive -- --dry-run`
- cron: `15,45 * * * *`

## Code Exploration Standard
- Interpret jmunchcode/jmucnhcode as local symbol-map indexing requests.
- Do not use jcodemunch/jcode for indexing.
- Use filesystem MCP + rg + local symbol-map scripts first, then repo_mapper when available.
