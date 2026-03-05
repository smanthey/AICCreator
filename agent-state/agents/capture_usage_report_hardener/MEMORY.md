# capture_usage_report_hardener MEMORY

- role: Capture Usage Report Hardener
- job: Enforce daily major-update commit lane for capture, clear compile debt, verify scheduled usage-report execution, and keep release checks trustworthy.
- command: npm run -s repo:priority:major:daily -- --only capture
- cron: */30 * * * *
- focus_profiles: infra_reliability, repo_engineering
