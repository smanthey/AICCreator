#!/usr/bin/env node
/**
 * verify-stripe-pricing.js
 * ─────────────────────────────────────────────────────────────────────────
 * Verifies that correct wholesale pricing exists for all products and that
 * the codebase uses them (reads .stripe-products.json and BWS file).
 *
 * Usage:
 *   node scripts/verify-stripe-pricing.js           # check local JSON files only
 *   node scripts/verify-stripe-pricing.js --stripe  # also verify prices in Stripe API
 *
 * Expects:
 *   Skyn Patch (.stripe-products.json): 7 SKUs at $250, starter_bundle at $900
 *   BWS (.stripe-products-blackwallstreetopoly.json): wholesale $300, wholesale_volume $200
 */
"use strict";

const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const ROOT = path.join(__dirname, "..");

// ── Expected pricing (cents) ───────────────────────────────────────────

const SKYNPATCH = {
  file: path.join(ROOT, ".stripe-products.json"),
  skuKeys: ["zzzzz", "ignite", "longevity", "synergy", "pre_party", "lust", "grace"],
  bundleKey: "starter_bundle",
  expectedPerCase: 25000,   // $250
  expectedBundle: 90000,   // $900
};

const BWS = {
  file: path.join(ROOT, ".stripe-products-blackwallstreetopoly.json"),
  products: {
    wholesale:        30000,   // $300 per case (10 units)
    wholesale_volume: 20000,   // $200 per case for 100+ units
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────

function loadJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (e) {
    return null;
  }
}

function stripeGet(path) {
  const key = process.env.STRIPE_SECRET_KEY_SP || process.env.STRIPE_SECRET_KEY;
  if (!key) return Promise.resolve({ status: 0, data: null });
  const https = require("https");
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: "api.stripe.com",
      path,
      method: "GET",
      headers: {
        Authorization: `Bearer ${key}`,
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
    req.end();
  });
}

// ── Checks ───────────────────────────────────────────────────────────────

function checkSkynPatch(data, verifyStripe) {
  const errors = [];
  const warnings = [];

  if (!data || typeof data !== "object") {
    errors.push(".stripe-products.json missing or invalid");
    return { errors, warnings };
  }

  // Required fields per product
  const required = ["productId", "priceId", "url", "name", "amount"];

  for (const key of SKYNPATCH.skuKeys) {
    const p = data[key];
    if (!p) {
      errors.push(`Skyn: missing product key "${key}"`);
      continue;
    }
    for (const field of required) {
      if (p[field] === undefined || p[field] === null) {
        errors.push(`Skyn ${key}: missing field "${field}"`);
      }
    }
    if (p.amount !== undefined && p.amount !== SKYNPATCH.expectedPerCase) {
      errors.push(`Skyn ${key}: expected amount ${SKYNPATCH.expectedPerCase} ($250), got ${p.amount}`);
    }
  }

  const bundle = data[SKYNPATCH.bundleKey];
  if (!bundle) {
    errors.push(`Skyn: missing "${SKYNPATCH.bundleKey}"`);
  } else {
    for (const field of required) {
      if (bundle[field] === undefined || bundle[field] === null) {
        errors.push(`Skyn ${SKYNPATCH.bundleKey}: missing field "${field}"`);
      }
    }
    if (bundle.amount !== undefined && bundle.amount !== SKYNPATCH.expectedBundle) {
      errors.push(`Skyn ${SKYNPATCH.bundleKey}: expected amount ${SKYNPATCH.expectedBundle} ($900), got ${bundle.amount}`);
    }
  }

  // Optional: keys in file but not in our 7-SKU list (e.g. sku_007)
  const extraKeys = Object.keys(data).filter(
    (k) => !["updatedAt", ...SKYNPATCH.skuKeys, SKYNPATCH.bundleKey].includes(k)
  );
  if (extraKeys.length) {
    warnings.push(`Skyn: extra keys in file (not used in emails): ${extraKeys.join(", ")}`);
  }

  return { errors, warnings };
}

function checkBWS(data) {
  const errors = [];
  const warnings = [];

  if (!data || typeof data !== "object") {
    errors.push(".stripe-products-blackwallstreetopoly.json missing or invalid");
    return { errors, warnings };
  }

  const required = ["productId", "priceId", "url", "name", "amount"];

  for (const [key, expectedAmount] of Object.entries(BWS.products)) {
    const p = data[key];
    if (!p) {
      errors.push(`BWS: missing product key "${key}"`);
      continue;
    }
    for (const field of required) {
      if (p[field] === undefined || p[field] === null) {
        errors.push(`BWS ${key}: missing field "${field}"`);
      }
    }
    if (p.amount !== undefined && p.amount !== expectedAmount) {
      errors.push(`BWS ${key}: expected amount ${expectedAmount}, got ${p.amount}`);
    }
  }

  return { errors, warnings };
}

async function verifyStripePrices(data, brand) {
  const results = [];
  const keys = brand === "skynpatch"
    ? [...SKYNPATCH.skuKeys, SKYNPATCH.bundleKey]
    : Object.keys(BWS.products);
  const expected = (key) => {
    if (brand === "skynpatch") {
      return key === SKYNPATCH.bundleKey ? SKYNPATCH.expectedBundle : SKYNPATCH.expectedPerCase;
    }
    return BWS.products[key];
  };

  for (const key of keys) {
    const p = data[key];
    if (!p?.priceId) continue;
    const res = await stripeGet(`/v1/prices/${p.priceId}`);
    if (res.status !== 200) {
      results.push({ key, ok: false, msg: `Stripe API error: ${res.status}` });
      continue;
    }
    const unitAmount = res.data?.unit_amount;
    const exp = expected(key);
    const ok = unitAmount === exp;
    results.push({
      key,
      ok,
      msg: ok ? `Stripe price $${(unitAmount / 100).toFixed(0)}` : `Stripe has $${(unitAmount / 100).toFixed(0)}, expected $${(exp / 100).toFixed(0)}`,
    });
  }
  return results;
}

// ── Consumers check ──────────────────────────────────────────────────────

function checkConsumers() {
  const errors = [];
  const leadgenPath = path.join(ROOT, "agents", "leadgen-agent.js");
  const resendPath = path.join(ROOT, "scripts", "resend-converting-emails.js");
  const dailyPath = path.join(ROOT, "scripts", "daily-send-scheduler.js");

  const leadgenSrc = fs.existsSync(leadgenPath) ? fs.readFileSync(leadgenPath, "utf8") : "";
  const resendSrc = fs.existsSync(resendPath) ? fs.readFileSync(resendPath, "utf8") : "";
  const dailySrc = fs.existsSync(dailyPath) ? fs.readFileSync(dailyPath, "utf8") : "";

  for (const key of SKYNPATCH.skuKeys) {
    if (!leadgenSrc.includes(`"${key}"`)) errors.push(`leadgen-agent.js does not reference SKU "${key}"`);
    if (!resendSrc.includes(`"${key}"`)) errors.push(`resend-converting-emails.js does not reference SKU "${key}"`);
  }
  if (!leadgenSrc.includes("starter_bundle")) errors.push("leadgen-agent.js does not reference starter_bundle");
  if (!dailySrc.includes("STRIPE_LINKS") || !dailySrc.includes("starter_bundle")) {
    errors.push("daily-send-scheduler.js does not use .stripe-products.json / bundle");
  }

  return errors;
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const verifyStripe = process.argv.includes("--stripe");

  console.log("\n  ═══ Stripe pricing verification ═══\n");

  let exitCode = 0;

  // 1. Skyn Patch
  console.log("  Skyn Patch (.stripe-products.json)");
  const skynData = loadJson(SKYNPATCH.file);
  const skynResult = checkSkynPatch(skynData, verifyStripe);
  if (skynResult.errors.length) {
    exitCode = 1;
    skynResult.errors.forEach((e) => console.log("    ❌", e));
  } else {
    console.log("    ✓ 7 SKUs + starter_bundle present with correct amounts ($250 / $900)");
  }
  skynResult.warnings.forEach((w) => console.log("    ⚠", w));

  if (verifyStripe && skynData) {
    const stripeResults = await verifyStripePrices(skynData, "skynpatch");
    for (const r of stripeResults) {
      if (r.ok) console.log("    ✓ Stripe", r.key, r.msg);
      else {
        console.log("    ❌ Stripe", r.key, r.msg);
        exitCode = 1;
      }
    }
  }

  console.log("");

  // 2. BWS
  console.log("  BWS (.stripe-products-blackwallstreetopoly.json)");
  const bwsData = loadJson(BWS.file);
  const bwsResult = checkBWS(bwsData);
  if (bwsResult.errors.length) {
    exitCode = 1;
    bwsResult.errors.forEach((e) => console.log("    ❌", e));
  } else {
    console.log("    ✓ wholesale $300, wholesale_volume $200");
  }
  bwsResult.warnings.forEach((w) => console.log("    ⚠", w));

  if (verifyStripe && bwsData) {
    const stripeResults = await verifyStripePrices(bwsData, "bws");
    for (const r of stripeResults) {
      if (r.ok) console.log("    ✓ Stripe", r.key, r.msg);
      else {
        console.log("    ❌ Stripe", r.key, r.msg);
        exitCode = 1;
      }
    }
  }

  console.log("");

  // 3. Consumers
  console.log("  Codebase usage (emails use these products)");
  const consumerErrors = checkConsumers();
  if (consumerErrors.length) {
    exitCode = 1;
    consumerErrors.forEach((e) => console.log("    ❌", e));
  } else {
    console.log("    ✓ leadgen-agent, resend-converting-emails, daily-send-scheduler reference expected SKUs");
  }

  console.log("\n  ═══════════════════════════════════════\n");
  if (exitCode === 0) {
    console.log("  ✅ All checks passed. Pricing is correct and in use.\n");
  } else {
    console.log("  ❌ Some checks failed. Fix the issues above and re-run.\n");
  }
  process.exit(exitCode);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
