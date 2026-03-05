# content_writing MEMORY

- role: Content Writing Agent
- job: Queue copy-lab style draft work and maintain content pipeline quality in dry-run-safe mode.
- command: npm run -s copy:lab -- --brand skynpatch --channel email --topic "daily conversion test" --iterations 1 --dry-run
- cron: 10,40 * * * *
