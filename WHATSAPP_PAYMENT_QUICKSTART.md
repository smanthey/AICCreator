# ClawPay WhatsApp Payment Setup - Quick Start

Your WhatsApp Business API was approved! You have 24 hours of free messaging. Let's get payments working.

## ✅ What's Already Set Up

- ✅ WhatsApp webhook handler (`/webhooks/whatsapp`)
- ✅ Stripe payment integration (supports USD, USDC, and all payment methods)
- ✅ WhatsApp message sending function
- ✅ Payment confirmation → prompt delivery flow
- ✅ WhatsApp-friendly message formatting (no markdown)

## 🔧 Required Environment Variables

Add these to your `.env` file:

```bash
# WhatsApp Business API (from Meta Business Manager)
WHATSAPP_ACCESS_TOKEN=your_permanent_token_here
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
WHATSAPP_BUSINESS_ACCOUNT_ID=your_waba_id
WHATSAPP_WEBHOOK_VERIFY_TOKEN=any_random_secret_string_you_choose

# Stripe Payment Processing
STRIPE_SECRET_KEY=sk_live_...  # or sk_test_... for testing
STRIPE_WEBHOOK_SECRET=whsec_...  # from Stripe Dashboard → Webhooks

# Public URL for webhooks and payment redirects
COMMERCE_PUBLIC_URL=https://your-domain.com  # or use ngrok for testing
COMMERCE_PORT=3031  # optional, defaults to 3031
COMMERCE_PRICE_USD=1.00  # optional, defaults to $1.00
```

## 📍 Where to Find WhatsApp Credentials

1. **Meta Business Manager** → **WhatsApp** → **API Setup**
   - Phone Number ID
   - WhatsApp Business Account ID

2. **Meta Business Manager** → **System Users** → Create/Select System User
   - Generate token with permissions: `whatsapp_business_messaging`, `whatsapp_business_management`
   - This is your `WHATSAPP_ACCESS_TOKEN`

3. **Choose a random string** for `WHATSAPP_WEBHOOK_VERIFY_TOKEN` (e.g., `clawpay_whatsapp_2024_secret`)

## 🔗 Configure Webhooks

### WhatsApp Webhook (Meta Business Manager)

1. Go to **WhatsApp** → **Configuration** → **Webhook**
2. Set **Callback URL**: `https://your-domain.com/webhooks/whatsapp`
3. Set **Verify Token**: (same as `WHATSAPP_WEBHOOK_VERIFY_TOKEN` in .env)
4. Subscribe to: `messages`, `message_deliveries`, `message_reads`

### Stripe Webhook (Stripe Dashboard)

1. Go to **Developers** → **Webhooks** → **Add endpoint**
2. Set **URL**: `https://your-domain.com/webhooks/stripe`
3. Select events:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
4. Copy the **Signing secret** → set as `STRIPE_WEBHOOK_SECRET` in .env

## 🚀 Start the Server

```bash
# Option 1: Using npm script
npm run commerce:server

# Option 2: Direct node command
node scripts/bot-commerce.js
```

This starts:
- WhatsApp webhook server (receives messages)
- Stripe webhook handler (receives payment confirmations)
- Telegram commerce bot (if TELEGRAM_BOT_TOKEN is set)

## 🧪 Test the Flow

1. **Verify setup:**
   ```bash
   node scripts/whatsapp-payment-setup.js
   ```

2. **Check health:**
   ```bash
   curl http://localhost:3031/health
   ```

3. **Send a test message:**
   - Send `oracle` to your WhatsApp Business number
   - Follow the prompts:
     - Select a protocol (1-6)
     - Provide context (platform | purpose | target bots)
     - Choose payment method (1 = Stripe)
   - You'll receive a payment link
   - After payment, the prompt is delivered automatically

4. **Monitor payments:**
   ```bash
   npm run commerce:pending
   ```

## 💳 Payment Methods Supported

Stripe automatically presents all enabled payment methods:
- 💳 Cards (Visa, Mastercard, Amex, Discover)
- 🍎 Apple Pay
- 🤖 Google Pay
- 💸 Cash App Pay
- 🔗 Link
- 🪙 USDC/Crypto (stablecoins)
- 🏦 ACH Direct Debit
- 📱 Bank transfers
- And more (based on your Stripe dashboard settings)

## 📝 Message Flow

1. User sends: `oracle`
2. Bot responds: Catalog menu (6 protocols)
3. User selects: Number (1-6)
4. Bot asks: Context questions
5. User provides: Platform | Purpose | Target bots
6. Bot shows: Payment options
7. User selects: Payment method (1 = Stripe)
8. Bot sends: Payment link
9. User pays: Via Stripe (USD, USDC, etc.)
10. Stripe webhook: Confirms payment
11. Bot delivers: Custom prompt automatically

## 🐛 Troubleshooting

### WhatsApp messages not received
- Check webhook URL is accessible (use ngrok for local testing)
- Verify `WHATSAPP_WEBHOOK_VERIFY_TOKEN` matches Meta settings
- Check server logs for webhook errors

### Payments not confirming
- Verify `STRIPE_WEBHOOK_SECRET` is correct
- Check Stripe Dashboard → Webhooks → Recent events
- Ensure `COMMERCE_PUBLIC_URL` is correct

### Messages not sending
- Verify `WHATSAPP_ACCESS_TOKEN` is valid (not expired)
- Check `WHATSAPP_PHONE_NUMBER_ID` is correct
- Ensure you're within the 24-hour free messaging window

## 🎯 Quick Test with ngrok (Local Development)

```bash
# Terminal 1: Start ngrok
ngrok http 3031

# Terminal 2: Update .env
COMMERCE_PUBLIC_URL=https://your-ngrok-url.ngrok.io

# Terminal 3: Start server
npm run commerce:server

# Update Meta webhook URL to: https://your-ngrok-url.ngrok.io/webhooks/whatsapp
```

## 📊 Monitoring

- **Pending payments**: `npm run commerce:pending`
- **Health check**: `curl http://localhost:3031/health`
- **Transaction log**: `agent-state/commerce/transactions.jsonl`
- **Sessions**: `agent-state/commerce/sessions/whatsapp_*.json`

---

**Remember:** You have 24 hours of free messaging after approval. Use this time to test thoroughly!

For detailed WhatsApp setup, see: `WHATSAPP_BUSINESS_APPLICATION.md`
