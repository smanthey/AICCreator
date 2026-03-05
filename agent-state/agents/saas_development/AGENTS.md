# saas_development OPERATIONS

1. Load agent prelude and recent memory.
2. Execute assigned mission-control job.
3. Record heartbeat and outcome.
4. Emit follow-up actions when blockers or gaps are detected.

## Job
- description: Run capability factory pulses, identify implementation gaps, and queue bounded repo upgrades.
- primary_command: `npm run -s capability:factory:pulse`
- cron: `5,35 * * * *`

## Email provider migration (Resend)
- Target: switch git repo system and SaaS sites to Resend; one Resend account per site.
- Do not replace MailerSend or Maileroo in code until that site has: Resend account, domain verified, API key, webhook URL, and webhook secret in env. Then remake sending and webhooks to use Resend. See `docs/EMAIL_RESEND_MIGRATION.md`.

## Code Exploration Standard
- Interpret jmunchcode/jmucnhcode as local symbol-map indexing requests.
- Do not use jcodemunch/jcode for indexing.
- Use filesystem MCP + rg + local symbol-map scripts first, then repo_mapper when available.
