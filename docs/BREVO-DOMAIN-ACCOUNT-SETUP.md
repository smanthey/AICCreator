# Brevo Domain Account Setup (OpenClaw)

This runbook standardizes Brevo as the default transactional email provider.

## Recommended Account Strategy

- Use **one Brevo account per domain/brand** when possible.
- Keep each account isolated for:
  - sender reputation
  - deliverability diagnostics
  - domain-specific compliance and webhook routing
- Keep `claw-architect` as the shared orchestration layer, but store per-brand API keys/secrets.

## Required Env Vars

- `EMAIL_PROVIDER=brevo`
- `BREVO_API_KEY=<brevo-account-api-key>`
- `BREVO_FROM_EMAIL=<verified-sender@yourdomain>`
- `BREVO_FROM_NAME=<sender name>`
- `RESEND_API_KEY=<optional fallback>`
- `MAILEROO_API_KEY=<optional legacy fallback>`
- `EMAIL_FALLBACK_ENABLED=true` (optional; only when fallback providers are configured)

## Per-Domain Cutover Checklist

1. Create/confirm Brevo account for domain.
2. Verify sender domain and SPF/DKIM/DMARC in DNS.
3. Create transactional API key in Brevo.
4. Configure webhook endpoint per site/service.
5. Set env vars for the specific brand deployment.
6. Run `node scripts/email-core-smoke.js` with domain sender/test recipient.
7. Confirm send logs in `agent-state/email/email-events.jsonl`.
8. Enable fallback provider only if needed for reliability.

## Notes

- `infra/send-email.js` now supports provider values: `brevo`, `resend`, `maileroo`.
- If `provider` is not explicitly passed, default precedence is:
  1. `EMAIL_PROVIDER`
  2. Brevo when `BREVO_API_KEY` is set
  3. Resend when `RESEND_API_KEY` is set
  4. Maileroo legacy path

