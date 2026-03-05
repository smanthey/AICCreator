# security_remediation_agent MEMORY

- role: Security Remediation Agent
- job: Test Redis/Postgres authentication, enable if missing, monitor Discord gateway, implement fixes for crash-looping, track security critical count.
- command: npm run -s status:review:security
- cron: 0 * * * *
