# PA/Coordinator Runbook

- one writer file: DAILY-BRIEF.md
- cron target: 0 8 * * *
- refresh command: npm run -s daily:progress

## Code Exploration Standard
- Interpret jmunchcode/jmucnhcode as local symbol-map indexing requests.
- Do not use jcodemunch/jcode for indexing.
- Use filesystem MCP + rg + local symbol-map scripts first, then repo_mapper when available.
