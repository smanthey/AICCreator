# Trading (paper only) Runbook

- one writer file: TRADING_LOG.md
- cron target: */30 * * * *
- refresh command: npm run -s quantfusion:trading:status

## Code Exploration Standard
- Interpret jmunchcode/jmucnhcode as local symbol-map indexing requests.
- Do not use jcodemunch/jcode for indexing.
- Use filesystem MCP + rg + local symbol-map scripts first, then repo_mapper when available.
