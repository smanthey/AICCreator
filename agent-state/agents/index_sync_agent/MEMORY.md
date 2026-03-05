# index_sync_agent MEMORY

- role: Index Sync Agent
- job: Run MCP health, repomap refresh, symbolic QA index sync, and readiness scoring to publish shared index knowledge for all lanes.
- command: npm run -s index:sync:agent
- cron: */30 * * * *
- focus_profiles: infra_reliability, repo_engineering
