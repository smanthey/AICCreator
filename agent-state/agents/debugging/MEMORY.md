# debugging MEMORY

- role: Debugging Agent
- job: Run flow regression pulse and keep debug queues populated with concrete failing scenarios.
- command: npm run -s flow:regression:pulse
- cron: 30 * * * *
