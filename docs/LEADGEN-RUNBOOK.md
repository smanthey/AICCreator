# Leadgen Runbook — Skyn Patch & BWS

Goal: **Way more Skyn Patch emails than BWS**, and **better leads for both** (buyer/decision-maker emails, better searches, DB, and OpenClaw).

**BWS uses 3D Game Art Academy** (3dgameartacademy.com, Brevo + webhook there), not Skyn Patch’s domain or providers.

**Leadgen is fully functional** with the BWS/Brevo update: BWS sends via Brevo (hello@3dgameartacademy.com); Skyn Patch unchanged (Resend/Maileroo + shop@skynpatch.com). Both schedulers and autopilots work as before.

## Test sending to an address you control

Use an inbox you can check (e.g. your OpenClaw Gmail):

```bash
# One test email (default provider; use --brevo or --resend to force)
node scripts/email-diagnose.js --to your-openclaw@gmail.com

# BWS: one wholesale-style email to your address (bypasses daily limit)
node scripts/blackwallstreetopoly-send-scheduler.js --to-email your-openclaw@gmail.com

# Skyn Patch: one lead email to your address (bypasses daily limit)
node scripts/daily-send-scheduler.js --to-email your-openclaw@gmail.com
```

Check that inbox (and spam) to confirm delivery.

## Send volume (Skyn Patch >> BWS)

- **Config:** `config/leadgen-send-ratio.json` — `skynpatch_send_max` (e.g. 50), `bws_send_max` (e.g. 12).
- **Ecosystem:** `ecosystem.background.config.js` sets env per PM2 app:
  - **Skyn Patch:** `LEAD_AUTOPILOT_SEND_MAX=50`, `LEAD_AUTOPILOT_TARGET_LEADS=800`, interval 15 min, more cities/queries.
  - **BWS:** `LEAD_AUTOPILOT_SEND_MAX=12`, `LEAD_AUTOPILOT_TARGET_LEADS=400`, interval 30 min, fewer cities.
- **Autopilot:** `scripts/lead-autopilot.js` reads ratio file when env is not set; PM2 env overrides. Restart autopilots after changing ecosystem: `pm2 restart claw-lead-autopilot-skynpatch claw-lead-autopilot-bws`.

## Buyer-focused emails

- **Discovery:** `scripts/email-finder.js` — generic patterns try **wholesale@, buyer@, purchasing@, merchandise@** before info@/contact@. `scripts/enrich-leads-email.js` scrapes **/wholesale, /for-retailers, /purchasing** first, and prefers those prefixes when sorting found emails.
- **Sending:** `scripts/daily-send-scheduler.js` and `scripts/blackwallstreetopoly-send-scheduler.js` **ORDER BY** buyer-like `contact_title` first (buyer, purchasing, wholesale, merchandise, procurement), then category, then id. Populate `contact_title` via email-finder (from `leads_contacts` / Hunter/Apollo when available) so decision-makers get prioritized.

## Better searches and DB

- **Categories:** `config/lead-categories.js` — wellness/health store categories; used by leadgen-agent and reference.
- **Queries (autopilot):** Set via `LEAD_AUTOPILOT_QUERIES` in ecosystem (or env). Skyn Patch: e.g. health food store, vitamin shop, wellness store, supplement store, natural foods, gym, yoga, spa, beauty supply, cbd store. BWS: toy store, black owned boutique, hbcu shop, gift shop, bookstore.
- **DB:** `leads.contact_title` and `leads.contact_name` are used for prioritization and personalization. Email-finder and enrich-leads-email write back contact info; ensure lead sources (e.g. Google Places scrape) don’t overwrite good contact_title when enriching.

## Using OpenClaw as a true agent

- **Mission Control / goals:** Create goals like “Increase Skyn Patch lead quality” or “Find buyer emails for top 100 BWS leads” and let agents run `email-finder.js --limit 100`, refine queries, or backfill `contact_title` from external sources.
- **Ad-hoc enrichment:** Run `node scripts/email-finder.js --limit 200` and/or `node scripts/enrich-leads-email.js` for a one-off push; then run the send scheduler with `--max-sends` as needed.
- **Refining searches:** Use Mission Control or a scheduled task to periodically update `LEAD_AUTOPILOT_QUERIES` or add new cities in ecosystem based on performance (e.g. open rates by region/category from your ESP).
- **DB-first:** Prefer storing all contact variants and titles in `leads` / `leads_contacts` and choosing “best” contact per lead in the scheduler (already done via ORDER BY contact_title). Optionally add a `buyer_score` column and backfill from contact_title/email prefix for even finer control.

## Quick commands

```bash
# Restart autopilots (apply new send caps)
pm2 restart claw-lead-autopilot-skynpatch claw-lead-autopilot-bws

# One-off: enrich more leads (buyer-focused scraping)
node scripts/enrich-leads-email.js
node scripts/email-finder.js --limit 200

# Skyn Patch send (respects ramp + --max-sends from autopilot)
node scripts/daily-send-scheduler.js --max-sends 50

# BWS send
node scripts/blackwallstreetopoly-send-scheduler.js --max-sends 12

# Lead pipeline status
node scripts/lead-pipeline.js --status
```

## Files reference

| File | Purpose |
|-----|--------|
| `config/leadgen-send-ratio.json` | Skyn vs BWS send caps and target leads (fallback when env unset) |
| `config/lead-categories.js` | Lead categories for Skyn Patch / wellness |
| `scripts/lead-autopilot.js` | Per-brand cycle: scrape → enrich → send |
| `scripts/email-finder.js` | Find/verify emails; buyer-first patterns |
| `scripts/enrich-leads-email.js` | Scrape /wholesale, /contact, etc.; buyer-first sort |
| `scripts/daily-send-scheduler.js` | Skyn Patch batch; buyer-first ORDER BY |
| `scripts/blackwallstreetopoly-send-scheduler.js` | BWS batch; buyer-first ORDER BY |
| `agents/leadgen-agent.js` | Leadgen agent (fetch/send templates) |
