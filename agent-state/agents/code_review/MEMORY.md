# code_review MEMORY

- role: Code Review Agent
- job: Run blocking QA checks on top repos and emit actionable findings for fix lanes.
- command: npm run -s qa:human:blocking
- cron: 25 */2 * * *
