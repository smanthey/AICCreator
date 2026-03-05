# Email: Resend migration (per-site)

**Audience:** Agents and operators working on the git repo system or SaaS sites.  
**Goal:** Switch each site from MailerSend / Maileroo to **Resend** (or **Brevo** for higher free limit), with **one account per site**.

**Note:** Resend free tier is 100 emails/day and 3,000/month. For more free volume, use **Brevo** (300/day, ~9,000/month). See `docs/EMAIL_PROVIDER_LIMITS.md`.

## Rule: Do not replace until credentials exist

**Do not change code** to remove MailerSend or Maileroo or to use Resend for a site **until** that site has:

1. A Resend account
2. Domain verified in Resend
3. An API key created and stored in env as `RESEND_API_KEY`
4. A webhook created in Resend pointing to that site (e.g. `https://<site>/api/webhooks/resend`)
5. The webhook signing secret stored in env as `RESEND_WEBHOOK_SECRET`

Only after these exist for a site should you remake sending and webhook handling to use Resend and remove MailerSend/Maileroo for that site.

---

## Per-site checklist

For each site (e.g. Skyn Patch, BWS, CopyLab, Agency OS):

| Step | Action |
|------|--------|
| 1 | Create or use a Resend account for this site (one account per site). |
| 2 | In Resend: add and verify the site’s sending domain (DNS: SPF, DKIM, etc.). |
| 3 | Create an API key in Resend; add to site env as `RESEND_API_KEY`. |
| 4 | Create a webhook in Resend: URL = `https://<site-domain>/api/webhooks/resend`, subscribe to needed events (e.g. sent, delivered, bounced). |
| 5 | Copy the webhook signing secret from Resend; add to site env as `RESEND_WEBHOOK_SECRET`. |
| 6 | Set `EMAIL_PROVIDER=resend` (or equivalent) in that site’s env. |
| 7 | **Then** update code: replace MailerSend/Maileroo with Resend for sending and replace existing webhook handlers with the Resend webhook route (with signature verification). |

---

## Code / repo

- Sending: use Resend API and `RESEND_API_KEY`; remove or bypass MailerSend/Maileroo for that site once switched.
- Webhooks: expose `POST /api/webhooks/resend` (or equivalent); verify signatures with `RESEND_WEBHOOK_SECRET` (e.g. via Svix). Do not process webhook payloads without verification when the secret is set.
- Existing docs: `docs/EMAIL_DELIVERY_CHECKLIST.md` for delivery troubleshooting; this file for migration order and per-site steps.

---

## Summary

- **One Resend account per site.**  
- **Create account, domain, API key, and webhook + secret first; add to env; then** replace MailerSend/Maileroo in code for that site.
