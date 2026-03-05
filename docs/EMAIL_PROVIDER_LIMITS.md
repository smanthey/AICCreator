# Transactional email provider limits (free tiers)

Resend’s free tier is **100 emails per day** and **3,000 per month** total. If you hit the daily limit you’ll see `HTTP 429: You have reached your daily email sending quota`. To get more free volume, use **Brevo** as primary.

## Free-tier comparison

| Provider   | Free daily limit | Free monthly (approx) | Notes |
|-----------|-------------------|------------------------|--------|
| **Brevo** (Sendinblue) | **300/day**       | **~9,000/month**       | Best free volume. Verify domain in Brevo. |
| Resend    | 100/day           | 3,000/month            | Good deliverability; low daily cap. |
| Maileroo  | —                 | 3,000/month            | No per-day cap on free; verify domain to exit Test Mode. |
| Mailjet   | 200/day           | 6,000/month            | Not integrated in this repo. |
| Elastic Email | —              | 15,000/month           | Not integrated in this repo. |

## How to use Brevo (higher limit)

1. Sign up at https://app.brevo.com and verify your sending domain.
2. Create an API key: **SMTP & API → API Keys → Generate** (key format `xkeysib-...`).
3. In `.env`:
   ```bash
   BREVO_API_KEY=xkeysib-xxxxxxxx
   EMAIL_PROVIDER=brevo
   ```
4. Sending will use Brevo first. If you also set `RESEND_API_KEY` or `MAILEROO_API_KEY`, those are used as fallback on failure (unless `EMAIL_FALLBACK_ENABLED=false`).

Code: `infra/send-email.js` (primary by `EMAIL_PROVIDER`), `infra/brevo.js` (Brevo API).

## References

- `docs/EMAIL_DELIVERY_CHECKLIST.md` — delivery issues and Resend 429.
- `docs/EMAIL_RESEND_MIGRATION.md` — per-site Resend migration (one account per site).
