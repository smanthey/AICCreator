#!/usr/bin/env node
/**
 * stripe-add-skus.js
 * ──────────────────────────────────────────────────────────────────────────
 * Adds NEW SkynPatch SKUs to Stripe (product + price + payment link).
 * Safe to run multiple times — skips any key already present in .stripe-products.json.
 *
 * Usage:
 *   node scripts/stripe-add-skus.js              # add all pending SKUs
 *   node scripts/stripe-add-skus.js --dry-run    # preview only, no API calls
 *   node scripts/stripe-add-skus.js --key pre_party   # add a single key only
 *
 * After running, execute stripe-update-checkout.js to add MOQ/shipping text
 * to the newly created payment link pages.
 *
 * Confirmed new SKUs in this file:
 *   pre_party   → Pre-Party Recovery Support    $250/case
 *
 * Confirmed from barcode assets:
 *   sku_007     → Zzzzzz Sleep Support (UPC 00850053954474)
 */
"use strict";

const https  = require("https");
const path   = require("path");
const fs     = require("fs");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const DRY_RUN     = process.argv.includes("--dry-run");
const FORCED_KEY  = (() => {
  const i = process.argv.indexOf("--key");
  return i >= 0 ? process.argv[i + 1] : null;
})();

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
if (!STRIPE_KEY && !DRY_RUN) {
  console.error("STRIPE_SECRET_KEY not set in .env");
  process.exit(1);
}

const PRODUCTS_FILE = path.join(__dirname, "../.stripe-products.json");

// ── New SKU definitions ───────────────────────────────────────────────────
// Add entries here as new SKUs are confirmed from physical case scans.
// tbd:true entries are skipped automatically until you remove the flag.

const NEW_SKUS = [
  {
    key:         "pre_party",
    name:        "Pre-Party — Recovery Support (Wholesale Case)",
    description: "Milk Thistle, N-Acetyl Cysteine, Vitamin B Complex, Alpha Lipoic Acid, Electrolytes. " +
                 "50 packs/case, 4 patches/pack. MSRP $11.96/pack. Event prep and next-day recovery support.",
    amount:      25000,   // $250.00 in cents
    currency:    "usd",
    images:      ["https://skynpatch.com/images/pre-party-box.jpg"],
    metadata:    {
      sku:               "SP-RECOV-CASE",
      pack_count:        "50",
      patches_per_pack:  "4",
      msrp_per_pack:     "11.96",
      shelf_life_months: "36",
      upc:               "00850053954528",
    },
    tbd: false,
  },
  {
    // Confirmed from barcode asset:
    // $HOME/Library/Mobile Documents/com~apple~CloudDocs/smat/SynologyDrive/skynpatch/barcode/case/zzzzzz case00850053954474 ITF-14 SST2.png
    key:         "sku_007",
    name:        "Zzzzzz — Sleep Support (Wholesale Case)",
    description: "Melatonin, L-Theanine, Magnesium, Passionflower, 5-HTP. " +
                 "50 packs/case, 4 patches/pack. MSRP $11.96/pack. Fall asleep faster, wake refreshed.",
    amount:      25000,
    currency:    "usd",
    images:      [],
    metadata:    {
      sku:               "SP-SLEEP2-CASE",
      pack_count:        "50",
      patches_per_pack:  "4",
      msrp_per_pack:     "11.96",
      shelf_life_months: "36",
      upc:               "00850053954474",
    },
    tbd: false,
  },
  {
    key:         "lust",
    name:        "Lust — Libido Support (Wholesale Case)",
    description: "Circulation & desire support for men & women. 50 packs/case, 4 patches/pack. MSRP $9.98/pack. 4-Day Libido Patch.",
    amount:      25000,
    currency:    "usd",
    images:      [],
    metadata:    {
      sku:               "SKNP-LST-4",
      pack_count:        "50",
      patches_per_pack:  "4",
      msrp_per_pack:     "9.98",
      shelf_life_months: "36",
      upc:               "00850053954412",
    },
    tbd: false,
  },
  {
    key:         "grace",
    name:        "Grace — Menopause Support (Wholesale Case)",
    description: "Hot flash, mood & bone support with botanicals. 50 packs/case, 4 patches/pack. MSRP $9.98/pack. 4-Day Menopause Patch.",
    amount:      25000,
    currency:    "usd",
    images:      [],
    metadata:    {
      sku:               "SKNP-GRC-4",
      pack_count:        "50",
      patches_per_pack:  "4",
      msrp_per_pack:     "9.98",
      shelf_life_months: "36",
      upc:               "00850053954450",
    },
    tbd: false,
  },
];

// ── Stripe helpers (matches stripe-setup-products.js pattern) ─────────────

function stripePost(endpoint, params) {
  const body = new URLSearchParams(params).toString();
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: "api.stripe.com",
      path:     endpoint,
      method:   "POST",
      headers:  {
        "Authorization":  `Bearer ${STRIPE_KEY}`,
        "Content-Type":   "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
        "Stripe-Version": "2024-06-20",
      },
    };
    const req = https.request(opts, res => {
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
  console.log("║          SKYNPATCH STRIPE — ADD NEW SKUS                    ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  if (DRY_RUN) console.log("  ⚠️  DRY RUN — no Stripe API calls\n");

  const existingFile = fs.existsSync(PRODUCTS_FILE)
    ? JSON.parse(fs.readFileSync(PRODUCTS_FILE, "utf8"))
    : {};

  const results = {};

  for (const sku of NEW_SKUS) {
    // Filter to specific key if --key flag used
    if (FORCED_KEY && sku.key !== FORCED_KEY) continue;

    // Skip TBD entries unless explicitly forced
    if (sku.tbd && !FORCED_KEY) {
      console.log(`  ⏭️  ${sku.key}: marked TBD — skipping (use --key ${sku.key} to force)`);
      continue;
    }
    if (sku.tbd && FORCED_KEY) {
      console.warn(`  ⚠️  ${sku.key}: marked TBD but forcing anyway — confirm physical label first!`);
    }

    // Skip if already in .stripe-products.json
    if (existingFile[sku.key]?.productId) {
      console.log(`  ✅ ${sku.key}: already in Stripe (productId: ${existingFile[sku.key].productId}) — skipping`);
      continue;
    }

    console.log(`  📦 Adding: ${sku.name}`);

    if (DRY_RUN) {
      console.log(`     [DRY RUN] $${(sku.amount / 100).toFixed(2)} USD / case → Payment Link`);
      continue;
    }

    // 1. Create product
    const productParams = flattenParams({
      name:        sku.name,
      description: sku.description,
      metadata:    { ...sku.metadata, brand: "skynpatch" },
    });
    if (sku.images?.length) {
      sku.images.forEach((img, i) => { productParams[`images[${i}]`] = img; });
    }
    const productRes = await stripePost("/v1/products", productParams);
    if (productRes.status !== 200) {
      console.error(`     ✗ Product create failed: ${JSON.stringify(productRes.data).slice(0, 200)}`);
      continue;
    }
    const productId = productRes.data.id;
    console.log(`     ✓ Product: ${productId}`);

    // 2. Create price
    const priceParams = flattenParams({
      product:     productId,
      unit_amount: sku.amount,
      currency:    sku.currency,
      metadata:    { brand: "skynpatch", sku: sku.metadata.sku },
    });
    const priceRes = await stripePost("/v1/prices", priceParams);
    if (priceRes.status !== 200) {
      console.error(`     ✗ Price create failed: ${JSON.stringify(priceRes.data).slice(0, 200)}`);
      results[sku.key] = { productId, priceId: null, paymentLinkId: null, url: null };
      continue;
    }
    const priceId = priceRes.data.id;
    console.log(`     ✓ Price: ${priceId} ($${(sku.amount / 100).toFixed(2)})`);

    // 3. Create Payment Link (matches stripe-setup-products.js params exactly)
    const linkParams = flattenParams({
      "line_items[0][price]":    priceId,
      "line_items[0][quantity]": "1",
      "allow_promotion_codes":   "true",
      "billing_address_collection": "required",
      "shipping_address_collection[allowed_countries][0]": "US",
      "after_completion[type]":  "redirect",
      "after_completion[redirect][url]":
        "https://skynpatch.com/wholesale/thank-you?session_id={CHECKOUT_SESSION_ID}",
      "metadata[brand]":         "skynpatch",
      "metadata[product_key]":   sku.key,
      "metadata[sku]":           sku.metadata.sku,
      "custom_fields[0][key]":   "business_name",
      "custom_fields[0][label][type]":   "custom",
      "custom_fields[0][label][custom]": "Business / Store Name",
      "custom_fields[0][type]":          "text",
      "custom_fields[0][optional]":      "false",
      // MOQ / shipping / payment / returns shown above the pay button
      "custom_text[submit][message]":
        "MOQ: 1 case (50 packs). Ships in 2 business days from in-stock inventory. " +
        "Payment: secure card via Stripe. Wellness consumables are non-returnable; " +
        "damaged shipments replaced at no charge. Volume pricing available — email shop@skynpatch.com.",
    });
    const linkRes = await stripePost("/v1/payment_links", linkParams);
    if (linkRes.status !== 200) {
      console.error(`     ✗ Payment Link failed: ${JSON.stringify(linkRes.data).slice(0, 200)}`);
      results[sku.key] = { productId, priceId, paymentLinkId: null, url: null };
      continue;
    }
    const paymentLinkId  = linkRes.data.id;
    const paymentLinkUrl = linkRes.data.url;
    console.log(`     ✓ Payment Link: ${paymentLinkUrl}`);

    results[sku.key] = {
      productId,
      priceId,
      paymentLinkId,
      url:    paymentLinkUrl,
      name:   sku.name,
      amount: sku.amount,
    };
    console.log("");
  }

  // Merge new results into existing file
  if (Object.keys(results).length > 0) {
    const merged = { ...existingFile, ...results, updatedAt: new Date().toISOString() };
    fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(merged, null, 2));
    console.log("  ✅ .stripe-products.json updated\n");

    console.log("  PAYMENT LINKS:\n");
    for (const [key, data] of Object.entries(results)) {
      if (data.url) console.log(`  ${key.padEnd(20)} ${data.url}`);
    }
    console.log("\n  Next: run stripe-update-checkout.js to add MOQ/shipping text to existing links.\n");
  } else {
    console.log("  ℹ️  Nothing new to add.\n");
  }
}

main().catch(e => { console.error(e); process.exit(1); });
