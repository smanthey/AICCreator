"use strict";

/**
 * scripts/stripe-core-smoke.js
 *
 * Minimal internal caller for core/stripe to prove the v1.0.0 implementation works.
 *
 * Usage:
 *   node scripts/stripe-core-smoke.js checkout
 *   node scripts/stripe-core-smoke.js active-sub <customerId>
 *   node scripts/stripe-core-smoke.js cancel-sub <subscriptionId>
 */

require("dotenv").config({ override: true });

const {
  CORE_STRIPE_VERSION,
  createCheckoutSession,
  getCustomerActiveSubscription,
  cancelSubscription,
} = require("../core/stripe");

async function main() {
  const [command, arg] = process.argv.slice(2);

  if (!command || command === "help") {
    // eslint-disable-next-line no-console
    console.log(
      [
        "",
        "core/stripe v" + CORE_STRIPE_VERSION + " smoke tests",
        "",
        "Commands:",
        "  checkout                      # create a simple one-time Checkout session (requires STRIPE_* env)",
        "  active-sub <customerId>      # show active subscription for a customer",
        "  cancel-sub <subscriptionId>  # set cancel_at_period_end=true for a subscription",
        "",
      ].join("\n")
    );
    process.exit(0);
  }

  if (command === "checkout") {
    const publicUrl = (process.env.COMMERCE_PUBLIC_URL || process.env.PUBLIC_URL || "").replace(
      /\/$/,
      ""
    );
    if (!publicUrl) {
      throw new Error("Set COMMERCE_PUBLIC_URL or PUBLIC_URL for redirect URLs");
    }

    const result = await createCheckoutSession({
      mode: "payment",
      priceIds: [process.env.STRIPE_TEST_PRICE_ID || ""].filter(Boolean),
      lineItems: process.env.STRIPE_TEST_PRICE_ID
        ? undefined
        : [
            {
              price_data: {
                currency: "usd",
                unit_amount: 100,
                product_data: {
                  name: "OpenClaw Test Payment",
                },
              },
              quantity: 1,
            },
          ],
      successUrl: `${publicUrl}/stripe/smoke-success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${publicUrl}/stripe/smoke-cancel`,
      metadata: {
        source: "core-stripe-smoke",
      },
    });

    // eslint-disable-next-line no-console
    console.log("Checkout session created:", JSON.stringify(result, null, 2));
    process.exit(0);
  }

  if (command === "active-sub") {
    if (!arg) {
      throw new Error("Usage: active-sub <customerId>");
    }
    const sub = await getCustomerActiveSubscription(arg);
    // eslint-disable-next-line no-console
    console.log(
      sub ? JSON.stringify({ id: sub.id, status: sub.status, customer: sub.customer }, null, 2) : "null"
    );
    process.exit(0);
  }

  if (command === "cancel-sub") {
    if (!arg) {
      throw new Error("Usage: cancel-sub <subscriptionId>");
    }
    const updated = await cancelSubscription(arg, { cancelAtPeriodEnd: true });
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({ id: updated.id, status: updated.status, cancel_at_period_end: updated.cancel_at_period_end }, null, 2)
    );
    process.exit(0);
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Stripe core smoke test failed:", err && err.message ? err.message : err);
  process.exit(1);
});

