# Email Hub Integration Guide (All Sites)

## Start
```bash
cd $HOME/claw-architect
npm run email:hub:server
```

Dashboard:
- [http://127.0.0.1:4045/email-hub/dashboard](http://127.0.0.1:4045/email-hub/dashboard)

## Required Env
- `EMAIL_HUB_API_KEY` (recommended)
- `EMAIL_HUB_PORT` (optional, default `4045`)
- `EMAIL_HUB_DEFAULT_FROM_EMAIL` (for flow actions that send email)
- `MAILEROO_WEBHOOK_SECRET` (if Maileroo webhook endpoint is used)
- `RESEND_WEBHOOK_SECRET` (if Resend webhook endpoint is used)
- `EMAIL_HUB_FORWARD_URLS` (optional comma-separated URLs to forward normalized events)

## Site-side Send API
`POST /api/email-hub/v1/send`

```json
{
  "site": "payclaw",
  "to": "user@example.com",
  "subject": "Invoice reminder",
  "html": "<p>Pay here...</p>",
  "fromEmail": "billing@payclaw.app",
  "fromName": "PayClaw",
  "provider": "maileroo"
}
```

Auth header:
- `Authorization: Bearer <EMAIL_HUB_API_KEY>`

## Site-side Trigger API
`POST /api/email-hub/v1/trigger`

Use this for cross-site automation events (payment states, onboarding states, etc.).

```json
{
  "type": "payment.paid",
  "provider": "stripe",
  "site": "payclaw",
  "recipient": "ops@payclaw.app",
  "subject": "Invoice paid",
  "payload": { "invoiceId": "inv_123" }
}
```

## Webhook Ingest Endpoints
- `POST /api/email-hub/v1/webhooks/maileroo`
- `POST /api/email-hub/v1/webhooks/resend`

These normalize provider payloads, append analytics events, and execute matching flows.

## Flow API
- `GET /api/email-hub/v1/events`
- `GET /api/email-hub/v1/analytics/summary`
- `GET /api/email-hub/v1/flows`
- `POST /api/email-hub/v1/flows/validate`
- `POST /api/email-hub/v1/flows`

Flow model:
```json
{
  "id": "bounced-alert",
  "name": "Bounce Alert",
  "trigger": "maileroo.bounce",
  "enabled": true,
  "conditions": { "site": "capture" },
  "actions": [
    { "type": "webhook", "url": "https://capture.example.com/api/internal/email-alert" },
    {
      "type": "send_email",
      "to": "ops@capture.com",
      "fromEmail": "noreply@capture.com",
      "subject": "Bounce detected for {{recipient}}",
      "text": "Event {{event}} for {{recipient}} on {{site}}"
    }
  ]
}
```

## Recommended Migration Pattern for Existing Repos
1. Keep existing local email code in place.
2. Add optional env flag `EMAIL_HUB_BASE_URL`.
3. If set, route sends to email hub first.
4. Keep local provider send as fallback during rollout.
5. Move webhook callbacks to email hub endpoints.
6. Monitor dashboard metrics and events for parity before fully switching.
