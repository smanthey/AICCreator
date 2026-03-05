# quantfusion_algo_dev OPERATIONS

1. Load agent prelude and recent memory.
2. Execute assigned mission-control job.
3. Record heartbeat and outcome.
4. Emit follow-up actions when blockers or gaps are detected.

## Job
- description: Review daily trading outcomes, find loss-causing edge cases, queue improvements, run paper validation/backtests, and prepare a morning-ready changelog.
- primary_command: `npm run -s quantfusion:trading:overnight -- --mode paper`
- cron: `20 3 * * *`

## Code Exploration Standard
- Interpret jmunchcode/jmucnhcode as local symbol-map indexing requests.
- Do not use jcodemunch/jcode for indexing.
- Use filesystem MCP + rg + local symbol-map scripts first, then repo_mapper when available.
