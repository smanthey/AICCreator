#!/usr/bin/env node
/**
 * stripe-bws-update-products.js
 * BWS (Black Wall Street Monopoly) uses a different Stripe account.
 * Creates Payment Links for the BWS wholesale product/prices and updates
 * .stripe-products-blackwallstreetopoly.json.
 *
 * Optional: set BWS_RETAIL_PRODUCT_IMAGE_URL in .env to the same image as the
 * retail listing (e.g. from Etsy: right-click main product image → Copy image address).
 * The script will set that image on the wholesale product so checkout shows the same art.
 *
 * Set STRIPE_SECRET_KEY_BWS in .env, then:
 *   node scripts/stripe-bws-update-products.js
 */
"use strict";

const path = require("path");
const fs = require("fs");
const https = require("https");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const BWS_STRIPE_KEY = process.env.STRIPE_SECRET_KEY_BWS;
const BWS_RETAIL_IMAGE_URL = process.env.BWS_RETAIL_PRODUCT_IMAGE_URL || null;
const PRODUCTS_FILE = path.join(__dirname, "../.stripe-products-blackwallstreetopoly.json");

// BWS Wholesale 10 pack — product and prices from BWS Stripe account
const BWS_WHOLESALE = {
  productId: "prod_U4R6JViNFVFT7O",
  priceId: "price_1T6IEJ62nWUM9lmRokS5ntwY",
  name: "Black Wall Street Monopoly — Wholesale Case Pack (10 units)",
};
const BWS_VOLUME_PRICE_ID = "price_1T6IEJ62nWUM9lmRKmbKsvC2";

// Shipping: 10-pack = $30 large box; 100+ volume = $300
const BWS_SHIPPING_WHOLESALE_CENTS = 3000;   // $30 — 10-pack
const BWS_SHIPPING_VOLUME_CENTS = 30000;     // $300 — 100 boxes

function stripeGet(secretKey, pathSeg) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: "api.stripe.com",
      path: pathSeg,
      method: "GET",
      headers: {
        Authorization: `Bearer ${secretKey}`,
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

function stripePost(secretKey, endpoint, params) {
  const body = new URLSearchParams(params).toString();
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: "api.stripe.com",
      path: endpoint,
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
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

async function createShippingRate(secretKey, displayName, amountCents) {
  const params = {
    display_name: displayName,
    type: "fixed_amount",
    "fixed_amount[amount]": String(amountCents),
    "fixed_amount[currency]": "usd",
  };
  const res = await stripePost(secretKey, "/v1/shipping_rates", params);
  if (res.status !== 200) throw new Error(JSON.stringify(res.data));
  return res.data.id;
}

async function createPaymentLink(secretKey, priceId, shippingRateId, metadata = {}) {
  const params = {
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    allow_promotion_codes: "true",
    billing_address_collection: "required",
    "shipping_address_collection[allowed_countries][0]": "US",
    "shipping_options[0][shipping_rate]": shippingRateId,
    "after_completion[type]": "redirect",
    "after_completion[redirect][url]":
      "https://www.etsy.com/shop/BlackWallStreetopoly?order_complete=1",
    "metadata[brand]": "blackwallstreetopoly",
    "custom_fields[0][key]": "business_name",
    "custom_fields[0][label][type]": "custom",
    "custom_fields[0][label][custom]": "Business / Store Name",
    "custom_fields[0][type]": "text",
    "custom_fields[0][optional]": "false",
  };
  Object.entries(metadata).forEach(([k, v]) => {
    params[`metadata[${k}]`] = String(v);
  });
  const res = await stripePost(secretKey, "/v1/payment_links", params);
  if (res.status !== 200) throw new Error(JSON.stringify(res.data));
  return { id: res.data.id, url: res.data.url };
}

async function getPrice(secretKey, priceId) {
  const res = await stripeGet(secretKey, `/v1/prices/${priceId}`);
  if (res.status !== 200) return null;
  return res.data;
}

async function updateProductImages(secretKey, productId, imageUrls) {
  if (!imageUrls || imageUrls.length === 0) return;
  const params = {};
  imageUrls.forEach((url, i) => {
    params[`images[${i}]`] = url;
  });
  const res = await stripePost(secretKey, `/v1/products/${productId}`, params);
  if (res.status !== 200) throw new Error(JSON.stringify(res.data));
}

async function main() {
  if (!BWS_STRIPE_KEY) {
    console.error("STRIPE_SECRET_KEY_BWS not set in .env. Add the BWS Stripe account secret key.");
    process.exit(1);
  }

  if (BWS_RETAIL_IMAGE_URL) {
    console.log("Setting wholesale product image to retail image:", BWS_RETAIL_IMAGE_URL);
    await updateProductImages(BWS_STRIPE_KEY, BWS_WHOLESALE.productId, [BWS_RETAIL_IMAGE_URL]);
    console.log("  Product image updated.");
  }

  const out = {};

  // Shipping: $30 for 10-pack, $300 for 100-box volume
  console.log("Creating shipping rate: 10-pack — $30...");
  const shippingRateWholesale = await createShippingRate(
    BWS_STRIPE_KEY,
    "Large box (10-pack) — $30",
    BWS_SHIPPING_WHOLESALE_CENTS
  );
  console.log("Creating shipping rate: 100 boxes — $300...");
  const shippingRateVolume = await createShippingRate(
    BWS_STRIPE_KEY,
    "Volume (100 boxes) — $300",
    BWS_SHIPPING_VOLUME_CENTS
  );

  // Wholesale 10 pack (+ $30 shipping)
  console.log("Creating Payment Link for BWS Wholesale 10 pack...");
  const priceWholesale = await getPrice(BWS_STRIPE_KEY, BWS_WHOLESALE.priceId);
  const amountWholesale = priceWholesale?.unit_amount ?? 30000;
  const linkWholesale = await createPaymentLink(
    BWS_STRIPE_KEY,
    BWS_WHOLESALE.priceId,
    shippingRateWholesale,
    { product_key: "wholesale" }
  );
  out.wholesale = {
    productId: BWS_WHOLESALE.productId,
    priceId: BWS_WHOLESALE.priceId,
    paymentLinkId: linkWholesale.id,
    url: linkWholesale.url,
    name: BWS_WHOLESALE.name,
    amount: amountWholesale,
  };
  console.log("  ", linkWholesale.url);

  // Volume price (second price ID — adjust name if needed)
  console.log("Creating Payment Link for BWS Volume...");
  const priceVolume = await getPrice(BWS_STRIPE_KEY, BWS_VOLUME_PRICE_ID);
  const amountVolume = priceVolume?.unit_amount ?? 20000;
  const nameVolume =
    priceVolume?.product?.name ||
    "Black Wall Street Monopoly — Volume Order (100+ units)";
  const linkVolume = await createPaymentLink(
    BWS_STRIPE_KEY,
    BWS_VOLUME_PRICE_ID,
    shippingRateVolume,
    { product_key: "wholesale_volume" }
  );
  const volumeProductId =
    typeof priceVolume?.product === "string"
      ? priceVolume.product
      : priceVolume?.product?.id ?? BWS_WHOLESALE.productId;
  out.wholesale_volume = {
    productId: volumeProductId,
    priceId: BWS_VOLUME_PRICE_ID,
    paymentLinkId: linkVolume.id,
    url: linkVolume.url,
    name: typeof nameVolume === "string" ? nameVolume : "Black Wall Street Monopoly — Volume Order (100+ units)",
    amount: amountVolume,
  };
  console.log("  ", linkVolume.url);

  out.updatedAt = new Date().toISOString();
  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(out, null, 2));
  console.log("\nUpdated .stripe-products-blackwallstreetopoly.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
