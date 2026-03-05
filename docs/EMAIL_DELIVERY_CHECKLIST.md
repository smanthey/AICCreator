# Email delivery checklist (Skyn Patch / BWS)

**BWS uses 3D Game Art Academy** (domain 3dgameartacademy.com, Brevo sending + webhook at https://3dgameartacademy.com/api/webhooks/brevo), not Skyn Patch.

If emails show as "sent" but **never reach the inbox**, work through this list.

**Migration note:** For the git repo system and SaaS, the target is to switch to Resend (one account per site) and replace MailerSend/Maileroo. Do not replace in code until each site has a Resend account, API key, and webhook secret. See **`docs/EMAIL_RESEND_MIGRATION.md`** for the per-site checklist and order of operations.

## Root cause: Maileroo Test Mode (most likely)

**New Maileroo accounts start in Test Mode:**
- **Max 7 unique recipients** (ever, during Test Mode)
- **Max 100 emails total**
- API returns 200 and may consume credit, but **Maileroo does not deliver** beyond these limits or to unwhitelisted recipients

**To exit Test Mode:**
1. **Add and verify your domain** in Maileroo: Dashboard → Domains → Add domain → Add the DNS records they give you (SPF, DKIM)
2. **Submit the account verification form** (review typically within 12 business hours)

Source: https://maileroo.com/help/what-is-test-mode-and-how-can-i-send-emails-without-any-limitations/

---

## 1. Free-tier limits and higher-limit option (Resend 100/day)

**Resend free tier:** 100 emails per day, 3,000 per month total. You may see `HTTP 429: You have reached your daily email sending quota` once you hit 100/day.

**For more free volume, use Brevo (Sendinblue):** 300 emails per day (~9,000/month) on the free plan.

1. Sign up at https://app.brevo.com and add/verify your sending domain.
2. Create an API key: SMTP & API → API Keys → Generate.
3. Add to `.env`:
   ```
   BREVO_API_KEY=xkeysib-xxxxxxxx
   EMAIL_PROVIDER=brevo
   ```
4. Run: `node scripts/email-diagnose.js --to your@email.com`
5. Check your inbox. If both Resend and Brevo keys are set, fallback will try the other on failure.

**If you stay on Resend:** Set `RESEND_API_KEY` and `EMAIL_PROVIDER=resend`. Keep Maileroo or Brevo as fallback by setting that key too (fallback is enabled by default).

---

## 2. Fix Maileroo (if staying with Maileroo)

### Verify domain

- Dashboard → Domains → Add `skynpatch.com` (or your from-domain)
- Add the DNS records (SPF, DKIM) at your DNS provider
- Wait for "Verified" status

### Use a v2 Sending Key

- Domains → [your domain] → Sending Keys → Create new key
- Use this key in `MAILEROO_API_KEY`
- Keys are per-domain; the key must be for the domain you send from

### Check Maileroo Logs

- Dashboard → Domains → [domain] → Overview → Sending → **Logs**
- Logs show success, errors, suppressed; "View Events" tracks delivery
- If emails don’t appear in Logs, they never reached Maileroo (wrong key, wrong endpoint, or network issue)

---

## 3. Diagnostic script

```bash
node scripts/email-diagnose.js --to your@email.com
# Or with Resend:
node scripts/email-diagnose.js --to your@email.com --resend
```

This sends one test and prints the full API response. Use it to confirm the provider accepts the request and to see any error body.

---

## 4. BWS ramp state (if inflated by failed sends)

If the BWS scheduler shows "Sent today: 20" but no emails were delivered, the state file may be inflated. Forced test sends (`--to-email`) no longer count. To reset the ramp state:

```bash
# Inspect current state
cat .leadgen-state-blackwallstreetopoly.json

# Reset (backup first)
cp .leadgen-state-blackwallstreetopoly.json .leadgen-state-blackwallstreetopoly.json.bak
# Then edit or delete .leadgen-state-blackwallstreetopoly.json to reset
# Example: set totalSent and daySends to 0, or delete the file to start fresh
```

---

## Summary

| Issue | Fix |
|------|-----|
| No emails in inbox, API returns 200 | Likely Test Mode (7 recipients, 100 emails). Verify domain + submit verification. |
| Resend 100/day quota (429) | Use Brevo for higher free limit: `BREVO_API_KEY` + `EMAIL_PROVIDER=brevo` (300/day free) |
| Want reliable delivery now | Resend or Brevo: set API key + `EMAIL_PROVIDER=resend` or `EMAIL_PROVIDER=brevo` |
| Emails not in Maileroo Logs | Wrong key, wrong domain, or API error. Run `email-diagnose.js` and check response. |
| BWS ramp shows fake sends | Forced test sends no longer count. Reset `.leadgen-state-blackwallstreetopoly.json` if needed. |
