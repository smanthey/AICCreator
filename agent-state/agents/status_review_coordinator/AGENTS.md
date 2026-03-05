# status_review_coordinator OPERATIONS

1. Load agent prelude and recent memory.
2. Execute assigned status review remediation task.
3. Record heartbeat and outcome.
4. Emit follow-up actions when blockers or gaps are detected.

## Job
- description: Read ACTION-PLAN-STATUS-REVIEW.md, determine which areas need attention, trigger appropriate worker agents, synthesize reports, and update STATUS.md.
- primary_command: `npm run -s status:review:coordinator`
- cron: `*/30 * * * *`

## Code Exploration Standard
- Interpret jmunchcode/jmucnhcode as local symbol-map indexing requests.
- Do not use jcodemunch/jcode for indexing.
- Use filesystem MCP + rg + local symbol-map scripts first, then repo_mapper when available.
