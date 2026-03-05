# security_remediation_agent OPERATIONS

1. Load agent prelude and recent memory.
2. Execute assigned status review remediation task.
3. Record heartbeat and outcome.
4. Emit follow-up actions when blockers or gaps are detected.

## Job
- description: Test Redis/Postgres authentication, enable if missing, monitor Discord gateway, implement fixes for crash-looping, track security critical count.
- primary_command: `npm run -s status:review:security`
- cron: `0 * * * *`

## Code Exploration Standard
- Interpret jmunchcode/jmucnhcode as local symbol-map indexing requests.
- Do not use jcodemunch/jcode for indexing.
- Use filesystem MCP + rg + local symbol-map scripts first, then repo_mapper when available.
