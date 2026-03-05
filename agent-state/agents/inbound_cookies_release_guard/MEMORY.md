# inbound_cookies_release_guard MEMORY

- role: Inbound-cookies Release Guard
- job: Enforce daily major-update commit lane for Inbound-cookies and verify webhook signature enforcement in both TS and Python paths with release-safe checks.
- command: npm run -s repo:priority:major:daily -- --only inbound-cookies
- cron: 15 * * * *
- focus_profiles: infra_reliability, repo_engineering
