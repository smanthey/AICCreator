# captureinbound_multitenant_guardian MEMORY

- role: CaptureInbound Multitenant Guardian
- job: Enforce daily major-update commit lane for CaptureInbound, focus on tenant-number mismatch repair, diagnostics UI, and automated reconciliation paths. Run jcodemunch MCP symbol index first, then run repo_mapper before coding.
- command: npm run -s repo:priority:major:daily -- --only captureinbound
- cron: */30 * * * *
- focus_profiles: infra_reliability, repo_engineering
