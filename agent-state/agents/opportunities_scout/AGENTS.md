# Opportunities Scout Runbook

- one writer file: OPPORTUNITIES.md
- cron target: 15 * * * *
- refresh command: npm run -s brief:weekly -- --refresh

## Code Exploration Standard
- Interpret jmunchcode/jmucnhcode as local symbol-map indexing requests.
- Do not use jcodemunch/jcode for indexing.
- Use filesystem MCP + rg + local symbol-map scripts first, then repo_mapper when available.
