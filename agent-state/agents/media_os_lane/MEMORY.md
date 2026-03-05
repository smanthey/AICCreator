# media_os_lane MEMORY

- role: Media OS Lane Agent
- job: Execute the bounded Media OS chain and keep metadata/hash/visual coverage moving forward.
- command: npm run -s media:chain -- --limit 2000 --hash-limit 5000 --visual-limit 2000
- cron: 12,42 * * * *
- focus_profiles: infra_reliability, repo_engineering
