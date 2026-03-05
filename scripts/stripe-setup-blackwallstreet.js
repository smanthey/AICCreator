#!/usr/bin/env node
/**
 * stripe-setup-blackwallstreet.js
 * ──────────────────────────────────────────────────────────────────────────
 * One-time setup script: creates BlackWallStreet Monopoly wholesale products
 * in Stripe, then generates Payment Links for wholesale orders.
 *
 * Run once from Mac terminal:
 *   cd ~/claw-architect && node scripts/stripe-setup-blackwallstreet.js
 *
 * What it creates in Stripe:
 *   wholesale: Black Wall Street Monopoly — Wholesale Case Pack (10 units)
 *   Payment Link: shareable hosted checkout URL, saved to .stripe-products-blackwallstreetopoly.json
 *
 * After running, the Payment Link URL gets embedded into the email template.
 *
 * Flags:
 *   --dry-run       Show what would be created, no Stripe API calls
 *   --list          List existing BlackWallStreet products already in Stripe
 */
"use strict";

const https  = require("https");
const path   = require("path");
const fs     = require("fs");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const DRY_RUN = process.argv.includes("--dry-run");
const LIST    = process.argv.includes("--list");

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
if (!STRIPE_KEY && !DRY_RUN) {
  console.error("STRIPE_SECRET_KEY not set in .env");
  process.exit(1);
}

// Output file — saves product IDs and payment link URLs
const PRODUCTS_FILE = path.join(__dirname, "../.stripe-products-blackwallstreetopoly.json");

// ── Product definitions ───────────────────────────────────────────────────

const PRODUCTS = [
  {
    key:         "wholesale",
    name:        "Black Wall Street Monopoly — Wholesale Case Pack (10 units)",
    description: "Educational board game celebrating Black Wall Street. Teaches financial literacy, entrepreneurship, and Black economic history. Case pack of 10 units. $300 + shipping. Volume pricing: $200/case for orders of 100+ units (180 units available).",
    amount:      30000,   // $300.00 in cents (base price for 10-unit case pack)
    currency:    "usd",
    images:      ["https://www.etsy.com/shop/BlackWallStreetopoly"],
    metadata:    { sku: "BWS-CASE-10", units_per_case: "10", brand: "blackwallstreetopoly", base_price: "300", volume_price_100plus: "200", inventory_available: "180" },
  },
  {
    key:         "wholesale_volume",
    name:        "Black Wall Street Monopoly — Volume Order (100+ units)",
    description: "Educational board game celebrating Black Wall Street. Volume pricing for orders of 100+ units. $200 per 10-unit case pack (normally $300). 180 units available total.",
    amount:      20000,   // $200.00 in cents (volume price for 100+ units)
    currency:    "usd",
    images:      ["https://www.etsy.com/shop/BlackWallStreetopoly"],
    metadata:    { sku: "BWS-CASE-10-VOLUME", units_per_case: "10", brand: "blackwallstreetopoly", volume_price: "200", min_quantity: "100", inventory_available: "180" },
  },
];

// ── Stripe API helper ─────────────────────────────────────────────────────

function stripePost(path, params) {
  const body = new URLSearchParams(params).toString();
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: "api.stripe.com",
      port: 443,
      path: path,
      method: "POST",
      headers: {
        "Authorization": `Bearer ${STRIPE_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
      },
    };
    const req = https.request(opts, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data: { error: "parse failed" } });
        }
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
      port: 443,
      path: path,
      method: "GET",
      headers: {
        "Authorization": `Bearer ${STRIPE_KEY}`,
      },
    };
    const req = https.request(opts, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data: { error: "parse failed" } });
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

function flattenParams(obj) {
  const flat = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "object" && !Array.isArray(v)) {
      for (const [sk, sv] of Object.entries(v)) {
        flat[`${k}[${sk}]`] = String(sv);
      }
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (typeof item === "object") {
          for (const [sk, sv] of Object.entries(item)) {
            flat[`${k}[${i}][${sk}]`] = String(sv);
          }
        } else {
          flat[`${k}[${i}]`] = String(item);
        }
      });
    } else {
      flat[k] = String(v);
    }
  }
  return flat;
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n");
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║     BLACKWALLSTREETOPOLY STRIPE PRODUCT SETUP               ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  if (LIST) {
    console.log("  📋 Listing existing BlackWallStreet products in Stripe...\n");
    const res = await stripeGet("/v1/products?limit=100");
    if (res.status === 200) {
      const products = res.data.data || [];
      const bwsProducts = products.filter((p) => 
        p.metadata?.brand === "blackwallstreetopoly" || 
        p.name?.toLowerCase().includes("black wall street")
      );
      if (bwsProducts.length === 0) {
        console.log("  (no BlackWallStreet products found)\n");
      } else {
        for (const p of bwsProducts) {
          console.log(`  • ${p.name} (${p.id})`);
          console.log(`    Active: ${p.active ? "✓" : "✗"}`);
          if (p.metadata?.sku) console.log(`    SKU: ${p.metadata.sku}`);
          console.log("");
        }
      }
    } else {
      console.error(`  ✗ Failed to list products: ${JSON.stringify(res.data).slice(0, 200)}`);
    }
    return;
  }

  if (DRY_RUN) {
    console.log("  ⚠️  DRY RUN — no Stripe API calls will be made\n");
  }

  const results = {};
  const existingFile = fs.existsSync(PRODUCTS_FILE) ? JSON.parse(fs.readFileSync(PRODUCTS_FILE, "utf8")) : {};

  for (const product of PRODUCTS) {
    console.log(`  📦 Setting up: ${product.name}`);

    if (DRY_RUN) {
      console.log(`     [DRY RUN] Would create product, price, and payment link`);
      console.log(`     Amount: $${(product.amount / 100).toFixed(2)} USD`);
      results[product.key] = { url: "[DRY RUN - would be created]" };
      continue;
    }

    // 1. Create product
    const productParams = flattenParams({
      name:        product.name,
      description: product.description,
      metadata:    { ...product.metadata, brand: "blackwallstreetopoly" },
    });
    if (product.images?.length) {
      product.images.forEach((img, i) => { productParams[`images[${i}]`] = img; });
    }
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
      metadata:     { brand: "blackwallstreetopoly", sku: product.metadata.sku },
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
      "after_completion[redirect][url]": "https://www.etsy.com/shop/BlackWallStreetopoly",
      "metadata[brand]":         "blackwallstreetopoly",
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

  console.log("\n  ✅ Products saved to .stripe-products-blackwallstreetopoly.json\n");
  console.log("  ─────────────────────────────────────────────────\n");
  console.log("  PAYMENT LINKS (add to emails):\n");
  for (const [key, data] of Object.entries(results)) {
    if (data.url) {
      console.log(`    ${key}: ${data.url}`);
    }
  }
  console.log("\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
