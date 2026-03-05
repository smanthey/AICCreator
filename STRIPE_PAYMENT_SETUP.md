# Stripe Payment Setup for Lead Gen Emails

## Current Status

### ✅ SkynPatch
- **Status**: Configured and working
- **Stripe Products File**: `.stripe-products.json` exists
- **Payment Link**: `https://buy.stripe.com/aFa9AUa1ldVe0O6fOu00004` (Starter Bundle)
- **Email Integration**: Uses `starter_bundle.url` from `.stripe-products.json`
- **Webhook Handler**: Configured in `scripts/stripe-webhook-handler.js`

### ⚠️ BlackWallStreet
- **Status**: Missing Stripe products file
- **Stripe Products File**: `.stripe-products-blackwallstreetopoly.json` does NOT exist
- **Current Fallback**: Using Etsy link `https://www.etsy.com/listing/4329026086/black-wall-street-history-game-tulsa`
- **Email Integration**: Falls back to Etsy if Stripe file missing
- **Webhook Handler**: Needs to support BlackWallStreet orders

## Setup Instructions

### 1. Set Up BlackWallStreet Stripe Products

Run the setup script to create Stripe products and payment links:

```bash
cd /Users/tatsheen/claw-architect
node scripts/stripe-setup-blackwallstreet.js
```

This will:
- Create a Stripe product for "Black Wall Street Monopoly — Wholesale Case Pack (10 units)"
- Create a price ($50.00 base)
- Create a Payment Link
- Save everything to `.stripe-products-blackwallstreetopoly.json`

**Required Environment Variables:**
- `STRIPE_SECRET_KEY` - Your Stripe secret key (from Stripe Dashboard → Developers → API keys)

### 2. Verify Stripe Webhook Configuration

The webhook handler at `scripts/stripe-webhook-handler.js` currently handles SkynPatch orders. It should automatically work for BlackWallStreet if the metadata includes `brand: "blackwallstreetopoly"`.

**Webhook Endpoint**: `POST /api/webhook/stripe`

**Required Environment Variables:**
- `STRIPE_WEBHOOK_SECRET` - Your Stripe webhook secret (from Stripe Dashboard → Developers → Webhooks)

**Events to Listen For:**
- `checkout.session.completed` - Order placed
- `payment_intent.succeeded` - Payment confirmed
- `payment_intent.payment_failed` - Payment failed
- `charge.refunded` - Refund processed

### 3. Test Payment Links

After setup, test the payment links:

**SkynPatch:**
- Starter Bundle: `https://buy.stripe.com/aFa9AUa1ldVe0O6fOu00004`
- Test with Stripe test mode card: `4242 4242 4242 4242`

**BlackWallStreet:**
- Check the URL in `.stripe-products-blackwallstreetopoly.json` after running setup
- Test with Stripe test mode card: `4242 4242 4242 4242`

### 4. Verify Email Templates

**SkynPatch** (`scripts/daily-send-scheduler.js`):
- Uses `BUNDLE_URL` from `.stripe-products.json` → `starter_bundle.url`
- ✅ Already configured

**BlackWallStreet** (`scripts/blackwallstreetopoly-send-scheduler.js`):
- Uses `WHOLESALE_URL` from `.stripe-products-blackwallstreetopoly.json` → `wholesale.url`
- ⚠️ Will use Stripe link once file is created, currently falls back to Etsy

## Verification Checklist

- [ ] `STRIPE_SECRET_KEY` is set in `.env`
- [ ] `STRIPE_WEBHOOK_SECRET` is set in `.env`
- [x] `.stripe-products.json` exists (SkynPatch) ✅
- [x] `.stripe-products-blackwallstreetopoly.json` exists (BlackWallStreet) ⚠️
- [ ] Stripe webhook endpoint is registered in Stripe Dashboard
- [x] Webhook server is running (`scripts/webhook-server.js`)
- [ ] Test payment links work in Stripe test mode
- [ ] Email templates use correct payment URLs

## Troubleshooting

### Payment link not working
1. Check `.stripe-products.json` or `.stripe-products-blackwallstreetopoly.json` exists
2. Verify the URL in the file is a valid Stripe Payment Link
3. Test the URL directly in a browser
4. Check Stripe Dashboard → Payment Links to see if it's active

### Webhook not receiving events
1. Verify `STRIPE_WEBHOOK_SECRET` is set correctly
2. Check webhook endpoint is registered in Stripe Dashboard
3. Verify webhook server is running: `pm2 list | grep webhook`
4. Check webhook logs: `pm2 logs claw-webhook-server`

### Email shows Etsy link instead of Stripe
1. Run `node scripts/stripe-setup-blackwallstreet.js` to create the products file
2. Verify `.stripe-products-blackwallstreetopoly.json` has a `wholesale.url` field
3. Restart the email scheduler if needed

## Next Steps

1. **Run BlackWallStreet setup**: `node scripts/stripe-setup-blackwallstreet.js`
2. **Verify webhook handler** supports both brands (check metadata.brand field)
3. **Test a payment** in Stripe test mode for both brands
4. **Monitor webhook logs** to ensure orders are being processed correctly
