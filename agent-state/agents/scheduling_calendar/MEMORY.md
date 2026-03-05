# scheduling_calendar MEMORY

- role: Scheduling and Calendar Agent
- job: Execute backlog orchestrator in dry-run mode for safe schedule planning and readiness checks.
- command: npm run -s backlog:orchestrator -- --dry-run
- cron: */15 * * * *
