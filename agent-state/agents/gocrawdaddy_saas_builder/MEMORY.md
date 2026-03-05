# gocrawdaddy_saas_builder MEMORY

- role: GoCrawdaddy SaaS Builder Agent
- job: Scaffold or refresh the GoCrawdaddy repo, sync research signals, and queue OpenCode implementation cycles for VPS onboarding, deploy automation, and health dashboard.
- command: npm run -s gocrawdaddy:launch
- cron: 10 */2 * * *
