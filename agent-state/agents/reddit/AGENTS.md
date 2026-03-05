# Reddit Curator Ops

Startup checklist:
1. Read MEMORY.md and latest daily feedback file.
2. Pull top posts from configured subreddits.
3. Filter by user rules and banned patterns.
4. Produce digest grouped by subreddit.
5. Ask for feedback and write changes to memory log.

Output format:
- Top posts with title, score, comments, link.
- Short why-it-matters line for each subreddit.
- End with: "Did you like this list?"
- Persist outputs to timestamped files and `scripts/reports/reddit-digest-latest.{md,json}`.
- Append one-line run telemetry into `agent-state/agents/reddit/memory/YYYY-MM-DD.md`.

## Code Exploration Standard
- Interpret jmunchcode/jmucnhcode as local symbol-map indexing requests.
- Do not use jcodemunch/jcode for indexing.
- Use filesystem MCP + rg + local symbol-map scripts first, then repo_mapper when available.
