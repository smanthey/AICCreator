#!/usr/bin/env node
/**
 * One-off: Update lust/grace in .stripe-products.json to use the correct
 * product/price IDs and create Payment Links for those prices.
 *
 *   node scripts/stripe-update-lust-grace-ids.js
 */
"use strict";

const path = require("path");
const fs = require("fs");
const https = require("https");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
const PRODUCTS_FILE = path.join(__dirname, "../.stripe-products.json");

const UPDATES = {
  lust: {
    productId: "prod_U4R1CMpDbx673A",
    priceId: "price_1T6I9vKCahDryrU4yHbvktOe",
    name: "Lust — Libido Support (Wholesale Case)",
    amount: 25000,
  },
  grace: {
    productId: "prod_U4R2EPKxZuF0sx",
    priceId: "price_1T6IA7KCahDryrU4Ra76qTwh",
    name: "Grace — Menopause Support (Wholesale Case)",
    amount: 25000,
  },
};

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

async function createPaymentLink(priceId, productKey) {
  const params = {
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    allow_promotion_codes: "true",
    billing_address_collection: "required",
    "shipping_address_collection[allowed_countries][0]": "US",
    "after_completion[type]": "redirect",
    "after_completion[redirect][url]":
      "https://skynpatch.com/wholesale/thank-you?session_id={CHECKOUT_SESSION_ID}",
    "metadata[brand]": "skynpatch",
    "metadata[product_key]": productKey,
    "custom_fields[0][key]": "business_name",
    "custom_fields[0][label][type]": "custom",
    "custom_fields[0][label][custom]": "Business / Store Name",
    "custom_fields[0][type]": "text",
    "custom_fields[0][optional]": "false",
    "custom_text[submit][message]":
      "MOQ: 1 case (50 packs). Ships in 2 business days from in-stock inventory. " +
      "Payment: secure card via Stripe. Wellness consumables are non-returnable; " +
      "damaged shipments replaced at no charge. Volume pricing available — email shop@skynpatch.com.",
  };
  const res = await stripePost("/v1/payment_links", params);
  if (res.status !== 200) {
    throw new Error(JSON.stringify(res.data));
  }
  return { id: res.data.id, url: res.data.url };
}

async function main() {
  if (!STRIPE_KEY) {
    console.error("STRIPE_SECRET_KEY not set");
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(PRODUCTS_FILE, "utf8"));

  for (const [key, spec] of Object.entries(UPDATES)) {
    console.log(`Creating Payment Link for ${key} (${spec.priceId})...`);
    const link = await createPaymentLink(spec.priceId, key);
    data[key] = {
      productId: spec.productId,
      priceId: spec.priceId,
      paymentLinkId: link.id,
      url: link.url,
      name: spec.name,
      amount: spec.amount,
    };
    console.log(`  ${key}: ${link.url}`);
  }

  data.updatedAt = new Date().toISOString();
  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(data, null, 2));
  console.log("\nUpdated .stripe-products.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
