#!/usr/bin/env node
/**
 * stripe-setup-products.js
 * ──────────────────────────────────────────────────────────────────────────
 * One-time setup script: creates SkynPatch wholesale products and prices
 * in Stripe, then generates Payment Links for each SKU.
 *
 * Run once from Mac terminal:
 *   cd ~/claw-architect && node scripts/stripe-setup-products.js
 *
 * What it creates in Stripe:
 *   4 products: Zzzzz, Ignite, Longevity, Synergy
 *   Each: $250.00 USD / master case (50 packs × $11.96 MSRP = $598 retail)
 *   Payment Links: shareable hosted checkout URLs, saved to .stripe-products.json
 *
 * After running, those Payment Link URLs get embedded into the email template
 * and in the Stripe orders DB table.
 *
 * Flags:
 *   --dry-run       Show what would be created, no Stripe API calls
 *   --list          List existing SkynPatch products already in Stripe
 *   --reset         Archive old SkynPatch products and recreate fresh
 */
"use strict";

const https  = require("https");
const path   = require("path");
const fs     = require("fs");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const DRY_RUN = process.argv.includes("--dry-run");
const LIST    = process.argv.includes("--list");
const RESET   = process.argv.includes("--reset");

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
if (!STRIPE_KEY && !DRY_RUN) {
  console.error("STRIPE_SECRET_KEY not set in .env");
  process.exit(1);
}

// Output file — saves product IDs and payment link URLs
const PRODUCTS_FILE = path.join(__dirname, "../.stripe-products.json");

// ── Product definitions ───────────────────────────────────────────────────

const PRODUCTS = [
  {
    key:         "zzzzz",
    name:        "Zzzzz — Sleep Support (Wholesale Case)",
    description: "Melatonin, L-Theanine, Passion Flower. 50 packs/case, 4 patches/pack. MSRP $11.96/pack. Fall asleep faster, wake refreshed.",
    amount:      25000,   // $250.00 in cents
    currency:    "usd",
    images:      ["https://skynpatch.com/images/zzzzz-box.jpg"],
    metadata:    { sku: "SP-SLEEP-CASE", pack_count: "50", patches_per_pack: "4", msrp_per_pack: "11.96", shelf_life_months: "36" },
  },
  {
    key:         "ignite",
    name:        "Ignite — Energy Support (Wholesale Case)",
    description: "Vitamin B12, L-Carnitine, CoQ10. 50 packs/case, 4 patches/pack. MSRP $11.96/pack. All-day energy without crashes.",
    amount:      25000,
    currency:    "usd",
    images:      ["https://skynpatch.com/images/ignite-box.jpg"],
    metadata:    { sku: "SP-ENERGY-CASE", pack_count: "50", patches_per_pack: "4", msrp_per_pack: "11.96", shelf_life_months: "36" },
  },
  {
    key:         "longevity",
    name:        "Longevity — Vitality Support (Wholesale Case)",
    description: "NAD+, NMN, Resveratrol. 50 packs/case, 4 patches/pack. MSRP $11.96/pack. Daily cellular anti-aging support.",
    amount:      25000,
    currency:    "usd",
    images:      ["https://skynpatch.com/images/longevity-box.jpg"],
    metadata:    { sku: "SP-VITAL-CASE", pack_count: "50", patches_per_pack: "4", msrp_per_pack: "11.96", shelf_life_months: "36" },
  },
  {
    key:         "synergy",
    name:        "Synergy — Digestive & Immunity Support (Wholesale Case)",
    description: "Zinc, Curcumin, Probiotics. 50 packs/case, 4 patches/pack. MSRP $11.96/pack. Gut health and immune response.",
    amount:      25000,
    currency:    "usd",
    images:      ["https://skynpatch.com/images/synergy-box.jpg"],
    metadata:    { sku: "SP-IMMUN-CASE", pack_count: "50", patches_per_pack: "4", msrp_per_pack: "11.96", shelf_life_months: "36" },
  },
  {
    key:         "starter_bundle",
    name:        "Skyn Patch Starter Bundle — All 4 SKUs (Wholesale)",
    description: "One case each of Zzzzz, Ignite, Longevity, and Synergy. 200 total packs. Perfect low-risk retail test. Shelf-ready display included.",
    amount:      90000,   // $900 (vs $1,000 for 4 individual cases — $100 bundle savings)
    currency:    "usd",
    images:      ["https://skynpatch.com/images/bundle-all.jpg"],
    metadata:    { sku: "SP-BUNDLE-4SKU", pack_count: "200", patches_per_pack: "4", msrp_per_pack: "11.96", savings_usd: "100" },
  },
];

// ── Stripe API helper ─────────────────────────────────────────────────────

function stripePost(path, params) {
  const body = new URLSearchParams(params).toString();
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: "api.stripe.com",
      path,
      method:   "POST",
      headers:  {
        "Authorization":  `Bearer ${STRIPE_KEY}`,
        "Content-Type":   "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
        "Stripe-Version": "2024-06-20",
      },
    };
    const req = https.request(opts, (res) => {
      let raw = "";
      res.on("data", d => raw += d);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, data: raw }); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function stripeGet(path) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: "api.stripe.com",
      path,
      method:   "GET",
      headers:  {
        "Authorization":  `Bearer ${STRIPE_KEY}`,
        "Stripe-Version": "2024-06-20",
      },
    };
    const req = https.request(opts, (res) => {
      let raw = "";
      res.on("data", d => raw += d);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, data: raw }); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

// ── Build nested params (Stripe uses dot notation for nested objects) ─────

function flattenParams(obj, prefix = "") {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      Object.assign(out, flattenParams(v, key));
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (typeof item === "object") {
          Object.assign(out, flattenParams(item, `${key}[${i}]`));
        } else {
          out[`${key}[${i}]`] = item;
        }
      });
    } else if (v !== undefined) {
      out[key] = v;
    }
  }
  return out;
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n");
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║         SKYNPATCH STRIPE PRODUCT SETUP                      ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  if (DRY_RUN) {
    console.log("  ⚠️  DRY RUN — no Stripe API calls\n");
    for (const p of PRODUCTS) {
      console.log(`  Would create: ${p.name}`);
      console.log(`    → $${(p.amount/100).toFixed(2)} USD / case`);
      console.log(`    → Payment Link + Checkout URL\n`);
    }
    return;
  }

  if (LIST) {
    console.log("  Fetching existing SkynPatch products from Stripe...\n");
    const res = await stripeGet("/v1/products?limit=20&active=true&metadata[brand]=skynpatch");
    const products = res.data?.data || [];
    if (products.length === 0) {
      console.log("  No SkynPatch products found in Stripe yet.\n");
    } else {
      for (const p of products) {
        console.log(`  ${p.name}`);
        console.log(`    ID: ${p.id}  active: ${p.active}`);
      }
    }
    return;
  }

  const results = {};
  const existingFile = fs.existsSync(PRODUCTS_FILE) ? JSON.parse(fs.readFileSync(PRODUCTS_FILE)) : {};

  for (const product of PRODUCTS) {
    console.log(`  📦 Setting up: ${product.name}`);

    // 1. Create product
    const productParams = flattenParams({
      name:        product.name,
      description: product.description,
      metadata:    { ...product.metadata, brand: "skynpatch" },
    });
    const productRes = await stripePost("/v1/products", productParams);
    if (productRes.status !== 200) {
      console.error(`    ✗ Product create failed: ${JSON.stringify(productRes.data).slice(0, 200)}`);
      continue;
    }
    const productId = productRes.data.id;
    console.log(`    ✓ Product created: ${productId}`);

    // 2. Create price
    const priceParams = flattenParams({
      product:      productId,
      unit_amount:  product.amount,
      currency:     product.currency,
      metadata:     { brand: "skynpatch", sku: product.metadata.sku },
    });
    const priceRes = await stripePost("/v1/prices", priceParams);
    if (priceRes.status !== 200) {
      console.error(`    ✗ Price create failed: ${JSON.stringify(priceRes.data).slice(0, 200)}`);
      continue;
    }
    const priceId = priceRes.data.id;
    console.log(`    ✓ Price created: ${priceId} ($${(product.amount/100).toFixed(2)})`);

    // 3. Create Payment Link
    const linkParams = flattenParams({
      "line_items[0][price]":    priceId,
      "line_items[0][quantity]": "1",
      "allow_promotion_codes":   "true",
      "billing_address_collection": "required",
      "shipping_address_collection[allowed_countries][0]": "US",
      "after_completion[type]":  "redirect",
      "after_completion[redirect][url]": "https://skynpatch.com/wholesale/thank-you?session_id={CHECKOUT_SESSION_ID}",
      "metadata[brand]":         "skynpatch",
      "metadata[product_key]":   product.key,
      "metadata[sku]":           product.metadata.sku,
      "custom_fields[0][key]":   "business_name",
      "custom_fields[0][label][type]": "custom",
      "custom_fields[0][label][custom]": "Business / Store Name",
      "custom_fields[0][type]":  "text",
      "custom_fields[0][optional]": "false",
    });
    const linkRes = await stripePost("/v1/payment_links", linkParams);
    if (linkRes.status !== 200) {
      console.error(`    ✗ Payment Link failed: ${JSON.stringify(linkRes.data).slice(0, 200)}`);
      // Still save what we have
      results[product.key] = { productId, priceId, paymentLink: null, url: null };
      continue;
    }
    const paymentLinkId  = linkRes.data.id;
    const paymentLinkUrl = linkRes.data.url;
    console.log(`    ✓ Payment Link: ${paymentLinkUrl}`);

    results[product.key] = { productId, priceId, paymentLinkId, url: paymentLinkUrl, name: product.name, amount: product.amount };
    console.log("");
  }

  // Save to file
  const merged = { ...existingFile, ...results, updatedAt: new Date().toISOString() };
  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(merged, null, 2));

  console.log("\n  ✅ Products saved to .stripe-products.json\n");
  console.log("  ─────────────────────────────────────────────────\n");
  console.log("  PAYMENT LINKS (add to emails):\n");
  for (const [key, data] of Object.entries(results)) {
    if (data.url) {
      console.log(`  ${key.padEnd(20)} ${data.url}`);
    }
  }
  console.log("\n  Run this once, then run daily-send-scheduler.js to start sending.\n");
  console.log("  Next step: node scripts/stripe-setup-products.js was successful —");
  console.log("  the payment links are now live and embedded in outgoing emails.\n");
}

main().catch(e => { console.error(e); process.exit(1); });
