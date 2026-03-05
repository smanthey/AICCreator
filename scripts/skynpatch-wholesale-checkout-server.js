#!/usr/bin/env node
/**
 * skynpatch-wholesale-checkout-server.js
 * Serves a wholesale order form and creates Stripe Checkout Sessions with
 * shipping auto-calculated: $5 first case + $1 per additional case.
 * No customer dropdown — shipping is computed from cart total.
 *
 * Usage: node scripts/skynpatch-wholesale-checkout-server.js
 *   SKYNPATCH_CHECKOUT_PORT=3344 (default)
 *   Base URL for redirects: SKYNPATCH_CHECKOUT_BASE_URL (e.g. https://skynpatch.com/wholesale)
 *
 * GET /  → form with SKU quantity inputs
 * POST /checkout  → JSON body { zzzzz: 1, ignite: 2, ... } → 302 redirect to Stripe Checkout
 */
"use strict";

const http = require("http");
const path = require("path");
const fs = require("fs");
const url = require("url");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const Stripe = require("stripe");
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY_SP || process.env.STRIPE_SECRET_KEY;
const PORT = parseInt(process.env.SKYNPATCH_CHECKOUT_PORT || "3344", 10);
const HOST = process.env.SKYNPATCH_CHECKOUT_HOST || "127.0.0.1";
const BASE_URL = process.env.SKYNPATCH_CHECKOUT_BASE_URL || `http://127.0.0.1:${PORT}`;
const SUCCESS_URL = process.env.SKYNPATCH_CHECKOUT_SUCCESS_URL || "https://skynpatch.com/wholesale/thank-you";
const PRODUCTS_FILE = path.join(__dirname, "../.stripe-products.json");

const SKU_KEYS = ["zzzzz", "ignite", "longevity", "synergy", "pre_party", "lust", "grace", "crave"];
const SHIPPING_FIRST_CENTS = 500;   // $5 first case
const SHIPPING_EXTRA_CENTS = 100;   // $1 per additional case

function loadProducts() {
  const raw = fs.readFileSync(PRODUCTS_FILE, "utf8");
  const data = JSON.parse(raw);
  return SKU_KEYS.map((key) => ({ key, ...data[key] })).filter((p) => p.priceId);
}

function getFormHtml(products) {
  const rows = products
    .map(
      (p) =>
        `<tr><td><label for="q-${p.key}">${escapeHtml(p.name)}</label></td><td><input type="number" id="q-${p.key}" name="${p.key}" min="0" max="50" value="0" style="width:4em"></td><td>$${(p.amount / 100).toFixed(0)}/case</td></tr>`
    )
    .join("");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Skyn Patch Wholesale — Order</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 520px; margin: 2rem auto; padding: 0 1rem; }
    table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
    th, td { padding: 8px 6px; text-align: left; border-bottom: 1px solid #eee; }
    th { font-size: 11px; text-transform: uppercase; color: #666; }
    input[type=number] { font-size: 16px; }
    .note { font-size: 12px; color: #666; margin: 1rem 0; }
    button { background: #111; color: #f0c040; border: none; padding: 12px 24px; font-size: 16px; font-weight: bold; cursor: pointer; border-radius: 3px; }
    button:hover { opacity: 0.9; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    h1 { font-size: 1.4rem; }
  </style>
</head>
<body>
  <h1>Skyn Patch Wholesale</h1>
  <p class="note">~58% margin · Set quantity per SKU (0 = skip). Shipping is auto-calculated: $5 first case + $1 each additional.</p>
  <form id="form" action="checkout" method="post">
    <table>
      <thead><tr><th>Product</th><th>Qty (cases)</th><th>Price</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="note" id="shipping-preview">Shipping: —</p>
    <button type="submit" id="btn">Checkout</button>
  </form>
  <script>
    const form = document.getElementById('form');
    const btn = document.getElementById('btn');
    const preview = document.getElementById('shipping-preview');
    function totalCases() {
      let n = 0;
      ${SKU_KEYS.map((k) => `n += parseInt(document.getElementById('q-${k}')?.value || 0, 10);`).join(" ")}
      return n;
    }
    function shippingCents(cases) {
      if (cases < 1) return 0;
      return 500 + (cases - 1) * 100;
    }
    function updatePreview() {
      const cases = totalCases();
      const cents = shippingCents(cases);
      preview.textContent = cases < 1 ? 'Shipping: — (add at least 1 case)' : 'Shipping: $' + (cents/100).toFixed(0) + ' (auto)';
      btn.disabled = cases < 1;
    }
    ${SKU_KEYS.map((k) => `document.getElementById('q-${k}').addEventListener('change', updatePreview);`).join(" ")}
    updatePreview();
    form.addEventListener('submit', function(e) {
      e.preventDefault();
      btn.disabled = true;
      const body = {};
      ${SKU_KEYS.map((k) => `body['${k}'] = parseInt(document.getElementById('q-${k}').value || 0, 10);`).join(" ")}
      fetch('checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(r => r.json())
        .then(d => { if (d.url) window.location = d.url; else alert(d.error || 'Checkout failed'); btn.disabled = false; })
        .catch(err => { alert(err.message); btn.disabled = false; });
    });
  </script>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function createCheckoutSession(cart, products) {
  const stripe = new Stripe(STRIPE_KEY, { apiVersion: "2024-06-20" });
  const lineItems = [];
  let totalCases = 0;
  for (const p of products) {
    const qty = Math.max(0, parseInt(cart[p.key], 10) || 0);
    if (qty > 0) {
      lineItems.push({ price: p.priceId, quantity: qty });
      totalCases += qty;
    }
  }
  if (totalCases === 0) return { error: "Add at least 1 case." };
  const shippingCents = SHIPPING_FIRST_CENTS + (totalCases - 1) * SHIPPING_EXTRA_CENTS;
  lineItems.push({
    price_data: {
      currency: "usd",
      unit_amount: shippingCents,
      product_data: {
        name: `Shipping — ${totalCases} case${totalCases > 1 ? "s" : ""} ($${(shippingCents / 100).toFixed(0)})`,
        description: "$5 first case, $1 per additional. Auto-calculated from your order.",
      },
    },
    quantity: 1,
  });

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: lineItems,
    success_url: `${SUCCESS_URL}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: BASE_URL + "/",
    billing_address_collection: "required",
    shipping_address_collection: { allowed_countries: ["US"] },
    metadata: { brand: "skynpatch", type: "wholesale_calculated_shipping" },
    custom_fields: [
      {
        key: "business_name",
        label: { type: "custom", custom: "Business / Store Name" },
        type: "text",
      },
    ],
  });
  return { url: session.url };
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  if (pathname === "/" || pathname === "") {
    const products = loadProducts();
    const html = getFormHtml(products);
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
    return;
  }

  if (pathname === "/checkout" && req.method === "POST") {
    let body = "";
    for await (const chunk of req) body += chunk;
    let cart;
    try {
      cart = JSON.parse(body);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }
    const products = loadProducts();
    const result = await createCheckoutSession(cart, products);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

if (!STRIPE_KEY) {
  console.error("STRIPE_SECRET_KEY_SP or STRIPE_SECRET_KEY not set.");
  process.exit(1);
}

server.listen(PORT, HOST, () => {
  console.log(`Skyn Patch wholesale checkout: http://127.0.0.1:${PORT}`);
  console.log("Shipping: $5 first case + $1 each additional (auto-calculated).");
});
