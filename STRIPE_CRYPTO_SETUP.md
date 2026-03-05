# Stripe Crypto Wallet Support Setup

## Current Status

Your Stripe Checkout is configured with `automatic_payment_methods: { enabled: true }`, which should automatically show all enabled payment methods from your Stripe Dashboard, including crypto if it's enabled.

## Enabling Crypto Payments in Stripe

### Step 1: Enable Crypto in Stripe Dashboard

1. Go to **Stripe Dashboard** → **Settings** → **Payment methods**
2. Find **Crypto** in the list
3. Click **Enable** or **Activate**
4. Complete any required onboarding steps

### Step 2: Stripe Crypto Onboarding

Stripe Crypto requires:
- Business verification (if not already done)
- Compliance checks
- Wallet address configuration

**Steps:**
1. **Stripe Dashboard** → **Settings** → **Payment methods** → **Crypto**
2. Click **Get started** or **Activate**
3. Complete the onboarding form:
   - Business information
   - Compliance verification
   - Wallet address setup (where crypto payments are received)
4. Wait for approval (usually instant for verified businesses)

### Step 3: Enable in Code (Optional)

If you want to explicitly require crypto to be enabled:

```bash
# Add to .env
STRIPE_ENABLE_CRYPTO=true
```

This will explicitly add `"crypto"` to the payment method types.

**Note:** With `automatic_payment_methods: { enabled: true }`, crypto should appear automatically if enabled in your dashboard. The env var is optional for explicit control.

## Supported Crypto

Stripe Crypto supports:
- **USDC** (USD Coin) - Most common
- **USDT** (Tether)
- Other stablecoins (depending on Stripe's current offerings)

## How It Works

1. Customer clicks payment link
2. Stripe Checkout shows all enabled payment methods
3. If crypto is enabled, customer sees crypto option
4. Customer selects crypto wallet (e.g., MetaMask, Coinbase Wallet)
5. Payment is processed via blockchain
6. Webhook confirms payment → prompt delivered

## Testing Crypto Payments

### Test Mode

1. Enable crypto in **Stripe Dashboard** → **Test mode**
2. Use test wallet addresses
3. Test the full flow

### Production

1. Enable crypto in **Stripe Dashboard** → **Live mode**
2. Complete onboarding
3. Configure wallet addresses
4. Start accepting crypto payments

## Verification

Check if crypto is enabled:

```bash
# Check Stripe Dashboard
# Settings → Payment methods → Crypto should show "Enabled"

# Or test via API
curl https://api.stripe.com/v1/payment_methods \
  -u sk_live_...: \
  -d type=crypto
```

## Troubleshooting

### Crypto Not Showing

1. **Check Dashboard**: Ensure crypto is enabled in Stripe Dashboard
2. **Check Account Status**: Crypto requires verified business account
3. **Check Region**: Crypto availability varies by region
4. **Check Currency**: Crypto typically works with USD

### Onboarding Issues

- **Business Verification**: Complete business verification first
- **Compliance**: Ensure all compliance checks pass
- **Support**: Contact Stripe support if onboarding fails

## Current Configuration

Your code uses:
- `automatic_payment_methods: { enabled: true }` - Shows all enabled methods
- Optional: `STRIPE_ENABLE_CRYPTO=true` - Explicitly requires crypto

**Recommendation**: Enable crypto in Stripe Dashboard first. The automatic payment methods will include it automatically.

## Payment Methods Currently Supported

Based on your code comments:
- ✅ Cards (Visa, Mastercard, Amex, Discover)
- ✅ Apple Pay
- ✅ Google Pay
- ✅ Amazon Pay
- ✅ Cash App Pay
- ✅ Link
- ✅ **Crypto (USDC, USDT)** - If enabled in dashboard
- ✅ ACH Direct Debit
- ✅ Bank transfers
- ✅ BNPL (Klarna, Afterpay, Affirm, Zip)

## Next Steps

1. **Enable Crypto in Stripe Dashboard:**
   - Settings → Payment methods → Crypto → Enable

2. **Complete Onboarding:**
   - Fill out crypto onboarding form
   - Configure wallet addresses
   - Wait for approval

3. **Test:**
   - Create a test payment
   - Verify crypto option appears
   - Complete test payment

4. **Go Live:**
   - Enable in production
   - Start accepting crypto payments

---

**The code is ready. You just need to enable crypto in your Stripe Dashboard!**
