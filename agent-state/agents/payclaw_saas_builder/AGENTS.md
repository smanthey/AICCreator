# payclaw_saas_builder OPERATIONS

1. Load agent prelude and recent memory.
2. Execute assigned mission-control job.
3. Record heartbeat and outcome.
4. Emit follow-up actions when blockers or gaps are detected.

## Job
- description: Run payclaw:launch to seed/sync repo, copy compliance, register managed_repos. Keeps PayClaw repo aligned with docs/payclaw/SPEC.md and config/payclaw/.
- primary_command: `npm run -s payclaw:launch`
- cron: `10 */2 * * *`

## Code Exploration Standard
- Interpret jmunchcode/jmucnhcode as local symbol-map indexing requests.
- Do not use jcodemunch/jcode for indexing.
- Use filesystem MCP + rg + local symbol-map scripts first, then repo_mapper when available.
