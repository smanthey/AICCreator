# Lead gen emails — summary (direct-sales, Stripe products)

Direct-sales B2B wholesale: convert to paid, sell in the email with product names, prices, and Stripe checkout links. Stripe products/prices are used everywhere.

## 1. Skyn Patch (skynpatch_b2b_intro)

**Audience:** Health-focused retail — gyms, health food stores, spas, vitamin shops. Margin, MOQ, shelf-ready.

**Subject:** `Become a Skyn Patch wholesale partner — [Business Name]`

**Body:** Product + wholesale pricing from `.stripe-products.json`: single case **$250**, **Starter Bundle — All 4 SKUs** **$900**. CTA: "Order now — Secure Stripe checkout →". Ships in 2 business days. Reply for questions or volume only.

**Used by:** `scripts/daily-send-scheduler.js` (STRIPE_LINKS); `agents/leadgen-agent.js` (getStripeProducts). Force: `--to-email ADDR --to-name "Name"`.

---

## 2. Black Wall Street Monopoly (blackwallstreetopoly_wholesale_intro)

**Audience:** Toy stores, Black-owned boutiques, HBCU campus stores, gift shops. Education-forward, culturally meaningful.

**Subject:** `Carry Black Wall Street Monopoly — $300/case (10 units) or volume pricing`

**Body:** Product + two Stripe links from `.stripe-products-blackwallstreetopoly.json`: **Wholesale Case Pack (10 units)** **$300** [Buy now →]; **Volume Order (100+ units)** **$200**/case [Order 100+ units →]. In stock, ships fast. Retail Etsy link.

**Used by:** `scripts/blackwallstreetopoly-send-scheduler.js` (PRODUCT_STANDARD + PRODUCT_VOLUME); `agents/leadgen-agent.js` (getStripeProducts, two links). Force: `--to-email ADDR --to-name "Name"`.

---

## Sending both to specific addresses

Run once per recipient (each script sends one email per run when using `--to-email`):

```bash
# Skyn Patch
node scripts/daily-send-scheduler.js --to-email jamonwidit@plushtrap.com --to-name "Jamon"
node scripts/daily-send-scheduler.js --to-email sm@smatdesigns.com --to-name "SM"
node scripts/daily-send-scheduler.js --to-email at@smatdesigns.com --to-name "AT"

# Black Wall Street
node scripts/blackwallstreetopoly-send-scheduler.js --to-email jamonwidit@plushtrap.com --to-name "Jamon"
node scripts/blackwallstreetopoly-send-scheduler.js --to-email sm@smatdesigns.com --to-name "SM"
node scripts/blackwallstreetopoly-send-scheduler.js --to-email at@smatdesigns.com --to-name "AT"
```
