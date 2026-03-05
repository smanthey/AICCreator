# Security Monitor Runbook

- one writer file: SECURITY_STATUS.md
- cron target: 20 * * * *
- refresh command: npm run -s security:runtime -- --json --no-fail

## Code Exploration Standard
- Interpret jmunchcode/jmucnhcode as local symbol-map indexing requests.
- Do not use jcodemunch/jcode for indexing.
- Use filesystem MCP + rg + local symbol-map scripts first, then repo_mapper when available.
