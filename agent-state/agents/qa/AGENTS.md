# qa OPERATIONS

Startup checklist:
1. Load prelude files in the configured order.
2. Validate payload and guardrails.
3. Execute smallest safe action set.
4. Append daily writeback.

## Code Exploration Standard
- Interpret jmunchcode/jmucnhcode as local symbol-map indexing requests.
- Do not use jcodemunch/jcode for indexing.
- Use filesystem MCP + rg + local symbol-map scripts first, then repo_mapper when available.
