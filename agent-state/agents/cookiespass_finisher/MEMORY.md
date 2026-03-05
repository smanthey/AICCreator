# cookiespass_finisher MEMORY

- role: CookiesPass Finisher Agent
- job: Run cookiespass:mission:pulse as highest priority. Reuse implementations from existing repos for speed and reliability; do not rebuild from scratch. Run filesystem MCP + rg symbol-map indexing first (no jcodemunch), then run repo_mapper when available to map entrypoints/dependencies before coding.
- command: npm run -s cookiespass:mission:pulse
- cron: */20 * * * *
- focus_profiles: infra_reliability, repo_engineering
