# X Growth Runbook

- one writer file: X_DRAFTS.md
- cron target: 10 * * * *
- refresh command: npm run -s copy:lab -- --brand skynpatch --channel email --topic "x growth narrative" --iterations 1 --dry-run

## Code Exploration Standard
- Interpret jmunchcode/jmucnhcode as local symbol-map indexing requests.
- Do not use jcodemunch/jcode for indexing.
- Use filesystem MCP + rg + local symbol-map scripts first, then repo_mapper when available.
