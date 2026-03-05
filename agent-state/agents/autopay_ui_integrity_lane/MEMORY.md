# autopay_ui_integrity_lane MEMORY

- role: Autopay UI Integrity Lane
- job: Enforce daily major-update commit lane for autopay_ui and close route-flow gaps, especially payment crediting and webhook auth behavior.
- command: npm run -s repo:priority:major:daily -- --only autopay_ui
- cron: 45 * * * *
- focus_profiles: infra_reliability, repo_engineering
