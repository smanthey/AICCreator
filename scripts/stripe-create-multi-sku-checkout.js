#!/usr/bin/env node
/**
 * stripe-create-multi-sku-checkout.js
 * Creates a single Stripe Payment Link with all 7 Skyn Patch wholesale SKUs;
 * each line item has adjustable quantity (0–50). No shipping (use checkout
 * server for auto-calculated shipping: $5 + $1/case).
 *
 * Preferred: point "Order any mix" in emails to the checkout server URL
 * (skynpatch-wholesale-checkout-server.js) so shipping is auto-calculated.
 *
 * Usage: node scripts/stripe-create-multi-sku-checkout.js
 * Saves URL to .stripe-products.json as multi_sku_checkout.
 */
"use strict";

const path = require("path");
const fs = require("fs");
const https = require("https");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY_SP || process.env.STRIPE_SECRET_KEY;
const PRODUCTS_FILE = path.join(__dirname, "../.stripe-products.json");

const SKU_KEYS = ["zzzzz", "ignite", "longevity", "synergy", "pre_party", "lust", "grace"];

function stripePost(endpoint, params) {
  const body = new URLSearchParams(params).toString();
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: "api.stripe.com",
      path: endpoint,
      method: "POST",
      headers: {
        Authorization: `Bearer ${STRIPE_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
        "Stripe-Version": "2024-06-20",
      },
    };
    const req = https.request(opts, (res) => {
      let raw = "";
      res.on("data", (d) => (raw += d));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode, data: raw });
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  if (!STRIPE_KEY) {
    console.error("STRIPE_SECRET_KEY_SP or STRIPE_SECRET_KEY not set in .env");
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(PRODUCTS_FILE, "utf8"));

  const lineItemParams = {};
  let idx = 0;
  for (const key of SKU_KEYS) {
    const p = data[key];
    if (!p?.priceId) {
      console.warn(`Skipping ${key}: no priceId in .stripe-products.json`);
      continue;
    }
    lineItemParams[`line_items[${idx}][price]`] = p.priceId;
    lineItemParams[`line_items[${idx}][quantity]`] = "0";
    lineItemParams[`line_items[${idx}][adjustable_quantity][enabled]`] = "true";
    lineItemParams[`line_items[${idx}][adjustable_quantity][minimum]`] = "0";
    lineItemParams[`line_items[${idx}][adjustable_quantity][maximum]`] = "50";
    idx++;
  }

  if (idx === 0) {
    console.error("No valid price IDs found for SKUs.");
    process.exit(1);
  }

  const linkParams = {
    ...lineItemParams,
    allow_promotion_codes: "true",
    billing_address_collection: "required",
    "shipping_address_collection[allowed_countries][0]": "US",
    "after_completion[type]": "redirect",
    "after_completion[redirect][url]":
      "https://skynpatch.com/wholesale/thank-you?session_id={CHECKOUT_SESSION_ID}",
    "metadata[brand]": "skynpatch",
    "metadata[type]": "multi_sku_wholesale",
    "custom_fields[0][key]": "business_name",
    "custom_fields[0][label][type]": "custom",
    "custom_fields[0][label][custom]": "Business / Store Name",
    "custom_fields[0][type]": "text",
    "custom_fields[0][optional]": "false",
    "custom_text[submit][message]":
      "Set quantity per SKU (0 = skip). MOQ: at least 1 case. For shipping included, use the Order form at skynpatch.com/wholesale. Ships in 2 business days.",
  };

  console.log("  Creating Payment Link with", idx, "SKUs (no shipping — use checkout server for auto shipping)...\n");

  const res = await stripePost("/v1/payment_links", linkParams);
  if (res.status !== 200) {
    console.error("Stripe API error:", JSON.stringify(res.data, null, 2));
    process.exit(1);
  }

  const url = res.data.url;
  const id = res.data.id;

  data.multi_sku_checkout = { url, id, label: "Order any mix of SKUs (one checkout)" };
  data.updatedAt = new Date().toISOString();
  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(data, null, 2));

  console.log("  ✓ Multi-SKU checkout link created and saved to .stripe-products.json\n");
  console.log("  URL (use in emails):\n  ", url);
  console.log("\n  Customers will see all 7 products with quantity selectors on one Stripe checkout page.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
