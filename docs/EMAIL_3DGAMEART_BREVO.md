# 3D Game Art Academy — Brevo + env (Replit / Vercel)

**Goal:** Use Brevo for transactional email on the 3DGameArtAcademy repo and set env (including MCP API key) on Replit and Vercel.

## 1. Brevo for 3D Game Art Academy

- **Domain:** Verify **3dgameartacademy.com** in Brevo (app.brevo.com → Senders & Domains).
- **API key:** Create in Brevo (SMTP & API → API Keys). Add to **Replit Secrets** and **Vercel → Project → Environment Variables** as `BREVO_API_KEY`.
- **In repo:** The 3DGameArtAcademy repo now supports Brevo. When `BREVO_API_KEY` is set (e.g. in Replit Secrets or Vercel env), `server/resend-email.ts` uses `server/brevo-email.ts` for all sends. No code change needed beyond setting the env var. See `server/brevo-email.ts` and `server/resend-email.ts`.

## 2. Env / secrets to add

Add these to **Replit** (Secrets) and **Vercel** (Environment Variables) for the 3D Game Art Academy project:

| Variable | Description |
|----------|-------------|
| `EMAIL_PROVIDER` | `brevo` |
| `BREVO_API_KEY` | Your Brevo API key (e.g. `xkeysib-...`) |
| `BREVO_WEBHOOK_SECRET` | Optional: if you add a Brevo webhook to the site for bounces/opens |
| `MCP_API_KEY` or `BREVO_MCP_API_KEY` | MCP API key (add to Replit and Vercel secrets) |

## 3. .env template for 3D Game Art (local or reference)

```bash
# Copy into 3DGameArtAcademy repo .env or use as reference for Replit/Vercel
EMAIL_PROVIDER=brevo
BREVO_API_KEY=xkeysib-xxxxxxxx
BREVO_WEBHOOK_SECRET=
BREVO_MCP_API_KEY=
```

## 4. BWS uses 3D Game Art Academy (not Skyn Patch)

**Black Wall Street (BWS)** lead gen uses the **same setup as 3D Game Art Academy**: domain **3dgameartacademy.com**, Brevo for sending, and webhook at **https://3dgameartacademy.com/api/webhooks/brevo**. BWS does not use Skyn Patch’s domain or providers.

In **claw-architect** `.env`:

- `BLACKWALLSTREETOPOLY_FROM_EMAIL=hello@3dgameartacademy.com`
- `BLACKWALLSTREETOPOLY_FROM_NAME=3D Game Art Academy`
- `MAILEROO_ALLOWED_FROM_EMAILS=shop@skynpatch.com,hello@3dgameartacademy.com`
- `BREVO_API_KEY` — same Brevo account as 3D Game Art Academy (verify 3dgameartacademy.com in Brevo).

The BWS scheduler (`scripts/blackwallstreetopoly-send-scheduler.js`) sends via Brevo with the above sender. See `.env.example` for the full block.
