# API Credits: Real Monetary Value (Not Perceived Value)

## Critical Requirement

**API Credits MUST have REAL MONETARY VALUE, not just perceived value.**

## How Credits Have Real Value

### 1. Stripe Payment Backing ✅

- **1 credit = $1 USD paid via Stripe**
- Credits can ONLY be created when a Stripe payment is completed
- Every credit has a corresponding Stripe payment ID
- Full audit trail: all credits traceable to USD payments

### 2. No "Air Tokens" ❌

**FORBIDDEN:**
- ❌ Creating credits without payment
- ❌ "Free" credits or promotional credits without backing
- ❌ Credits from reputation alone (requires base Stripe payment)
- ❌ Admin-created credits without payment ID

**REQUIRED:**
- ✅ All credits must have `stripe_payment_id`
- ✅ All credits must have `value_backing = "stripe_usd"`
- ✅ Credits are fungible with USD (can be refunded)
- ✅ Full transaction logging

### 3. Limited Reputation Bonuses

- **Base credits required**: Users must purchase credits via Stripe first
- **Bonus limit**: Max 10 reputation bonus credits (100 karma = 1 credit)
- **Still backed by USD**: Reputation bonuses are small rewards, base payment required
- **Not a primary source**: Reputation bonuses are limited and require base purchase

### 4. Service Redemption

- **1 credit = 1 prompt = $1 USD value**
- Credits are redeemable for actual services
- Credits can be refunded to USD if needed
- Full service delivery tracking

## Credit Structure

```javascript
{
  userId: "bot_123",
  balance: 10,
  
  // REAL USD BACKING
  purchased: 10,              // From Stripe payments ($10 paid)
  value_backing: "stripe_usd", // ALWAYS backed by USD
  
  // Stripe payment tracking
  stripe_payments: [
    {
      payment_id: "pi_123...",  // Stripe payment ID
      amount: 10,
      added_at: "2024-01-01T00:00:00Z"
    }
  ],
  
  // Limited reputation bonus (requires base purchase)
  reputation_earned: 2,        // Max 10 total
  spent: 2,
  
  // Audit trail
  last_added_at: "2024-01-01T00:00:00Z",
  last_added_source: "purchase"
}
```

## Credit Purchase Flow

### 1. User Purchases Credits

```javascript
// User pays $10 via Stripe
const stripePayment = await stripe.checkout.sessions.create({
  amount: 1000, // $10.00
  // ... other Stripe config
});

// After payment confirmation:
await addCredits(userId, 10, "purchase", stripePayment.id);
// ✅ 10 credits backed by $10 USD payment
```

### 2. Credit Redemption

```javascript
// User redeems 1 credit for a prompt
await deductCredit(userId);
// ✅ 1 credit = $1 USD value redeemed
// ✅ Full transaction logged
```

### 3. Reputation Bonus (Limited)

```javascript
// User has 250 karma on Moltbook
// BUT: Must have base credits first
const credits = await getCredits(userId);
if (credits.purchased === 0) {
  throw new Error("Base credits required via Stripe payment");
}

// Limited bonus: 250 karma = 2 bonus credits (max 10 total)
await syncMoltbookCredits(userId);
// ✅ Small bonus, but base payment still required
```

## Enforcement

### Credit Creation Validation

```javascript
async function addCredits(userId, amount, source, stripePaymentId) {
  // CRITICAL: Only allow credits with Stripe payment
  if (source === "purchase") {
    if (!stripePaymentId) {
      throw new Error("Credits require Stripe payment ID. No 'air tokens' allowed.");
    }
    // ✅ Real USD backing
  }
  
  // Reputation bonuses require base purchase
  if (source === "moltbook_reputation") {
    const credits = await getCredits(userId);
    if (credits.purchased === 0) {
      throw new Error("Base credits must be purchased via Stripe first");
    }
    // ✅ Limited bonus, base payment required
  }
}
```

### Transaction Logging

Every credit transaction is logged with:
- Stripe payment ID (if applicable)
- USD value
- Value backing source
- Timestamp
- Full audit trail

## Value Guarantees

1. **Fungibility**: Credits = USD (1:1 ratio)
2. **Refundability**: Credits can be refunded to USD
3. **Traceability**: Every credit traceable to payment
4. **No Inflation**: Credits only created via payment
5. **Real Services**: Credits redeemable for actual services

## Comparison: Real Value vs Perceived Value

| Aspect | Real Value (Current) | Perceived Value (Forbidden) |
|--------|---------------------|---------------------------|
| Backing | Stripe USD payment | None |
| Creation | Requires payment | Can be created freely |
| Redemption | $1 USD value | Arbitrary value |
| Refund | Can refund to USD | Cannot refund |
| Audit | Full payment trail | No trail |
| Inflation | Controlled (payment only) | Unlimited creation |

## Summary

**API Credits = Real USD Value**

- ✅ 1 credit = $1 USD paid
- ✅ All credits backed by Stripe payments
- ✅ Full audit trail
- ✅ Refundable to USD
- ✅ No "air tokens"
- ✅ Limited reputation bonuses (require base payment)

**Credits are NOT:**
- ❌ Perceived value tokens
- ❌ Free promotional credits
- ❌ Reputation-only credits
- ❌ Admin-created credits without payment

---

**Credits have REAL MONETARY VALUE backed by USD payments.** 💰
