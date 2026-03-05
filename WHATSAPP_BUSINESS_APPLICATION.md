# WhatsApp Business API Application Guide

This document walks you through applying for the WhatsApp Business API (via Meta) to add WhatsApp as a channel for the OpenClaw Prompt Oracle.

**Estimated time**: 30 minutes to apply. Meta approval typically takes 3–7 business days.

---

## Step 1 — Create / Verify Your Meta Business Account

1. Go to **https://business.facebook.com** and sign in with a Facebook account (or create one).
2. Click **"Create Account"** if you don't have a Meta Business Manager yet.
3. Fill in:
   - **Business name**: `OpenClaw` (or your registered business name)
   - **Your name**: your full legal name
   - **Business email**: use your primary business email
4. Verify your email and complete any identity verification Meta requests.
5. In **Business Settings → Business Info**, add:
   - **Legal business name** (must match your legal registration if you have one)
   - **Business website**: `https://openclaw.io` (or your domain)
   - **Business address** and phone number

---

## Step 2 — Add a Phone Number for WhatsApp

> You'll need a phone number that is **NOT** already registered to a personal WhatsApp account. If your number is on personal WhatsApp, you must first delete that account at https://wa.me/settings (Settings → Account → Delete Account).

1. In Meta Business Manager, go to **WhatsApp → Getting Started** (left sidebar).
2. Click **"Add phone number"**.
3. Enter a dedicated business phone number (VoIP numbers like Twilio work fine).
4. Verify it via SMS or voice call.

**Recommended**: Buy a fresh number specifically for OpenClaw's WhatsApp bot at:
- **Twilio**: https://console.twilio.com (buy a number → verify it → use it here)
- **Google Voice**: free US number
- **OpenPhone**: https://www.openphone.com

---

## Step 3 — Apply for the WhatsApp Business API

1. In Meta Business Manager go to: **WhatsApp → API Setup** or visit:
   **https://developers.facebook.com/docs/whatsapp/cloud-api/get-started**

2. Click **"Create App"** in the developer portal:
   - App type: **Business**
   - App name: `OpenClaw Prompt Oracle`
   - Contact email: your business email

3. From your app dashboard, add the **WhatsApp** product.

4. In **WhatsApp → API Setup**, you'll see:
   - **Phone Number ID** — save this
   - **WhatsApp Business Account ID** — save this
   - **Temporary access token** — good for 24h; generate a permanent one (Step 4)

---

## Step 4 — Generate a Permanent Access Token

1. Go to **Meta Business Manager → System Users** (under Users).
2. Create a **System User** named `openclaw-whatsapp-bot` with **Admin** role.
3. Click **"Generate New Token"** → select your app → grant these permissions:
   - `whatsapp_business_messaging`
   - `whatsapp_business_management`
4. Copy the token → add to your `.env` as:

```
WHATSAPP_ACCESS_TOKEN=your_permanent_token_here
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
WHATSAPP_BUSINESS_ACCOUNT_ID=your_waba_id
WHATSAPP_WEBHOOK_VERIFY_TOKEN=any_random_secret_string_you_choose
```

---

## Step 5 — Set Up Your Webhook

Meta needs to send incoming messages to your server.

1. In your app dashboard → **WhatsApp → Configuration → Webhook**:
   - **Callback URL**: `https://YOUR_DOMAIN/webhooks/whatsapp`
   - **Verify token**: the value of `WHATSAPP_WEBHOOK_VERIFY_TOKEN` from your `.env`

2. Subscribe to these webhook fields:
   - `messages` ← required
   - `message_deliveries`
   - `message_reads`

3. If you don't have a public URL yet, use **ngrok** while testing:
   ```bash
   ngrok http 3031
   # Copy the https URL → use as your callback URL
   ```

---

## Step 6 — Create Message Templates (Required for Outbound)

WhatsApp requires pre-approved templates for any message you send first (outbound). Replies to user-initiated messages are free-form.

### Template 1: Oracle Intro (for outbound prospecting)

**Template name**: `oracle_intro`
**Category**: `UTILITY`
**Language**: English (US)

**Body**:
```
Hi {{1}}, I'm OpenClaw — an AI system for bot operators. I sell $1 system prompts that help bots communicate better with other AI bots across Discord, Telegram, and APIs.

Reply ORACLE to see the 6 available protocols, or STOP to opt out.
```

**Footer**: `OpenClaw Prompt Oracle · $1 per prompt`

### Template 2: Payment Confirmation

**Template name**: `oracle_payment_link`
**Category**: `UTILITY`

**Body**:
```
Your {{1}} protocol prompt is ready. Pay $1 here: {{2}}

After payment, your custom prompt will be delivered to this chat automatically.

Charge ID: {{3}}
```

---

## Step 7 — Submit for Business Verification (for scale)

For sending messages to more than 250 unique numbers/day, Meta requires **Business Verification**:

1. **Business Manager → Security Center → Business Verification**
2. Upload one of:
   - Business registration certificate
   - Tax registration document (EIN letter for US)
   - Utility bill with business name and address
3. Approval takes 1–5 business days

> **For testing**, you can immediately message up to 5 phone numbers you add manually as "test numbers" in the API Setup page without verification.

---

## Step 8 — Add WhatsApp to OpenClaw

Once you have the credentials, add to `.env`:

```bash
# WhatsApp Business API
WHATSAPP_ACCESS_TOKEN=EAAxxxxxxxxxxxxx
WHATSAPP_PHONE_NUMBER_ID=123456789012345
WHATSAPP_BUSINESS_ACCOUNT_ID=987654321098765
WHATSAPP_WEBHOOK_VERIFY_TOKEN=my_secret_verify_token_123

# Bot Commerce webhook server (already running on port 3031)
COMMERCE_PUBLIC_URL=https://openclaw.io
```

Then tell the team to wire up `/webhooks/whatsapp` in `payment-router.js` and `bot-commerce.js` as a new platform alongside Discord and Telegram.

---

## Costs

| Item | Cost |
|------|------|
| Incoming messages (user → OpenClaw) | **Free** |
| Outbound service conversations (within 24h window) | **Free** |
| Template messages (outbound prospecting) | ~$0.005–$0.015 per message (US) |
| Phone number | $0–$5/month (Twilio/VoIP) |

At $1 per prompt sold, break-even is trivially fast.

---

## Useful Links

- Meta Cloud API docs: https://developers.facebook.com/docs/whatsapp/cloud-api
- Business Verification: https://www.facebook.com/business/help/2058515294227817
- Message Templates: https://business.facebook.com/wa/manage/message-templates
- Pricing by country: https://developers.facebook.com/docs/whatsapp/pricing

---

*Last updated: 2026-02-28*
