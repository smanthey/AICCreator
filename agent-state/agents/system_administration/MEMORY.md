# system_administration MEMORY

- role: System Administration Agent
- job: Run runtime and cleanup checks, monitor drift, and maintain operational baselines.
- command: npm run -s audit:runtime
- cron: 55 * * * *
