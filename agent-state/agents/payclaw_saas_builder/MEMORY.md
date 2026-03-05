# payclaw_saas_builder MEMORY

- role: PayClaw SaaS Builder Agent
- job: Run payclaw:launch to seed/sync repo, copy compliance, register managed_repos. Keeps PayClaw repo aligned with docs/payclaw/SPEC.md and config/payclaw/.
- command: npm run -s payclaw:launch
- cron: 10 */2 * * *
