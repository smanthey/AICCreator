#!/usr/bin/env node
/**
 * resend-converting-emails.js
 * One-off: resend the converting (direct-sales, Stripe links) email to everyone
 * who already received the old intro email, so they get the buy link and product info.
 *
 * Usage:
 *   node scripts/resend-converting-emails.js              # resend to all
 *   node scripts/resend-converting-emails.js --dry-run     # show who would get it
 *   node scripts/resend-converting-emails.js --limit 50    # cap recipients
 *   node scripts/resend-converting-emails.js --brand skynpatch  # only Skyn Patch
 */
"use strict";

const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const pg = require("../infra/postgres");
const { sendMaileroo } = require("../infra/send-email");
const { resolveBrandSender, enforceSender } = require("../infra/outbound-email-policy");

const DRY_RUN = process.argv.includes("--dry-run");
const LIMIT = (() => {
  const i = process.argv.indexOf("--limit");
  return i >= 0 && process.argv[i + 1] ? Math.max(1, parseInt(process.argv[i + 1], 10)) : null;
})();
const BRAND_FILTER = (() => {
  const i = process.argv.indexOf("--brand");
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1].toLowerCase() : null;
})();

/** Canonical wholesale page — "Order bundle" / "Order any mix" link in SkynPatch emails. */
const SKYNPATCH_WHOLESALE_PAGE_URL = process.env.SKYNPATCH_WHOLESALE_PAGE_URL || "https://skynpatch.com/wholesale";

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function formatCents(cents) {
  if (cents == null) return "";
  return "$" + (Number(cents) / 100).toFixed(0);
}

function getStripeProducts(brandSlug) {
  if (brandSlug === "skynpatch") {
    const file = path.join(__dirname, "..", ".stripe-products.json");
    if (fs.existsSync(file)) {
      try {
        const data = JSON.parse(fs.readFileSync(file, "utf8"));
        const bundle = data.starter_bundle;
        const skuKeys = ["zzzzz", "ignite", "longevity", "synergy", "pre_party", "lust", "grace"];
        const skus = skuKeys
          .filter((k) => data[k] && data[k].url)
          .map((k) => ({ name: data[k].name, price: formatCents(data[k].amount), url: data[k].url }));
        return {
          bundle: bundle ? { name: bundle.name, price: formatCents(bundle.amount), url: SKYNPATCH_WHOLESALE_PAGE_URL } : { name: "Starter Bundle — All 4 SKUs", price: "$900", url: SKYNPATCH_WHOLESALE_PAGE_URL },
          skus: skus.length ? skus : [{ name: "Single case (50 packs)", price: "$250", url: SKYNPATCH_WHOLESALE_PAGE_URL }],
        };
      } catch (_) {}
    }
    return { bundle: { name: "Starter Bundle — All 4 SKUs", price: "$900", url: SKYNPATCH_WHOLESALE_PAGE_URL }, skus: [] };
  }
  if (brandSlug === "blackwallstreetopoly") {
    const file = path.join(__dirname, "..", ".stripe-products-blackwallstreetopoly.json");
    if (fs.existsSync(file)) {
      try {
        const data = JSON.parse(fs.readFileSync(file, "utf8"));
        const standard = data.wholesale;
        const volume = data.wholesale_volume;
        return {
          standard: standard ? { name: standard.name, price: formatCents(standard.amount), url: standard.url } : { name: "Wholesale Case Pack (10 units)", price: "$300", url: "https://www.etsy.com/listing/4329026086/black-wall-street-history-game-tulsa" },
          volume: volume ? { name: volume.name, price: formatCents(volume.amount), url: volume.url } : null,
        };
      } catch (_) {}
    }
    return {
      standard: { name: "Wholesale Case Pack (10 units)", price: "$300", url: "https://www.etsy.com/listing/4329026086/black-wall-street-history-game-tulsa" },
      volume: null,
    };
  }
  return null;
}

function buildSkynConverting(toName, products) {
  const bundle = products?.bundle || { name: "Starter Bundle — All 4 SKUs", price: "$900", url: SKYNPATCH_WHOLESALE_PAGE_URL };
  const skus = products?.skus || [];
  const skuRows = skus.map((s) => `<tr><td style="padding:6px 0;border-bottom:1px solid #eee;font-size:13px;">${esc(s.name)}</td><td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right;font-weight:bold;">${esc(s.price)}</td><td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right;"><a href="${esc(s.url)}" style="color:#f0c040;font-weight:bold;text-decoration:none;">Order →</a></td></tr>`).join("");
  const skuTable = skuRows ? `<p style="margin:12px 0 8px;font-size:12px;font-weight:bold;">Individual SKUs — each link goes to Stripe checkout:</p><table width="100%" cellpadding="0" cellspacing="0" style="font-size:12px;margin-bottom:16px;"><tr><td style="border-bottom:1px solid #ddd;padding:4px 0;">SKU</td><td style="border-bottom:1px solid #ddd;text-align:right;">Price</td><td style="border-bottom:1px solid #ddd;text-align:right;"></td></tr>${skuRows}</table>` : "";
  const name = esc(toName || "there");
  return {
    subject: `~58% margin · Skyn Patch wholesale — order any mix`,
    html: `<p>Hi ${name},</p>
<p><strong>~58% retail margin</strong> on 7 transdermal wellness patches — Sleep, Energy, Vitality, Immunity, Recovery, Lust, Grace. Shelf-ready, GS1 barcodes. Shipping: $5 first case + $1 per additional.</p>
<p><strong>Order any mix of 7 SKUs:</strong> one form, set quantity per SKU.</p>
<p><a href="${esc(bundle.url)}" style="display:inline-block;background:#111;color:#f0c040;padding:10px 24px;text-decoration:none;font-weight:bold;border-radius:3px;">Build your order →</a></p>
<p>Starter Bundle (all 4 core): <strong>${esc(bundle.price)}</strong> — <a href="${esc(bundle.url)}" style="font-weight:bold;color:#f0c040;">Order bundle →</a></p>
${skuTable}
<p>— Scott<br>shop@skynpatch.com</p>
<hr>
<p style="font-size:11px;color:#999;">Skyn Patch · Tempe, AZ · <a href="https://skynpatch.com">skynpatch.com</a><br>To unsubscribe reply UNSUBSCRIBE or email <a href="mailto:unsubscribe@skynpatch.com">unsubscribe@skynpatch.com</a>.</p>`,
  };
}

function buildBWSConverting(toName, products) {
  const standard = products?.standard || { name: "Wholesale Case Pack (10 units)", price: "$300", url: "https://www.etsy.com/listing/4329026086/black-wall-street-history-game-tulsa" };
  const volume = products?.volume;
  const name = esc(toName || "there");
  const volumeRow = volume
    ? `<tr><td style="padding:12px 16px;border-top:1px solid #2a2a2a;"><span style="font-size:13px;font-weight:bold;color:#fff;">${esc(volume.name)}</span><br><span style="font-size:12px;color:#aaa;">${esc(volume.price)}/case · $300 shipping at checkout · Best per-unit</span></td><td style="padding:12px 16px;border-top:1px solid #2a2a2a;text-align:right;"><a href="${esc(volume.url)}" style="display:inline-block;background:#d4a843;color:#111;font-size:12px;font-weight:bold;text-decoration:none;padding:8px 16px;border-radius:2px;">Checkout →</a></td></tr>`
    : "";
  return {
    subject: `Black Wall Street Monopoly wholesale — ${standard.price}/case, $30/unit margin`,
    html: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#1a1a1a;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1a1a;padding:20px 0;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#111;border-radius:4px;overflow:hidden;">
<tr><td style="background:#1a1a1a;padding:20px 24px;border-bottom:3px solid #d4a843;">
<div style="font-family:Georgia,serif;font-size:20px;color:#d4a843;font-weight:bold;">Black Wall Street Monopoly</div>
<div style="font-size:11px;color:#888;margin-top:4px;">WHOLESALE PARTNER OFFER</div>
</td></tr>
<tr><td style="padding:22px 24px;">
<p style="margin:0 0 14px;font-size:14px;color:#ddd;">Hi ${name},</p>
<p style="margin:0 0 14px;font-family:Georgia,serif;font-size:14px;color:#fff;font-style:italic;">"Greenwood, Tulsa, 1921 — the wealthiest Black community in America. They called it Black Wall Street."</p>
<p style="margin:0 0 16px;font-size:14px;color:#ccc;line-height:1.6;"><strong style="color:#fff;">Black Wall Street Monopoly</strong> brings that history to life: Black economic history, financial literacy, and the legacy of Greenwood. Built for Black-owned boutiques, HBCU campus stores, toy stores, and gift shops.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border-left:3px solid #d4a843;border-radius:2px;margin:0 0 16px;"><tr><td style="padding:12px 14px;">
<div style="font-size:11px;font-weight:bold;color:#d4a843;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Your margin</div>
<div style="font-size:13px;color:#ddd;"><strong style="color:#fff;">${esc(standard.price)}</strong> per case (10 units) = <strong style="color:#d4a843;">$30/unit</strong>. Retail at $49.99+ — strong margin.</div>
</td></tr></table>
<p style="margin:0 0 12px;font-size:14px;color:#ccc;">Everything in this email. Checkout opens Stripe — choose 10-pack or volume below.</p>
<p style="margin:0 0 14px;font-size:12px;color:#aaa;"><strong style="color:#d4a843;">Shipping:</strong> 10-pack = $30 at checkout. Volume (100+) = $300 at checkout.</p>
<div style="font-size:11px;font-weight:bold;color:#d4a843;text-transform:uppercase;margin-bottom:10px;">Checkout — opens Stripe</div>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:3px;">
<tr><td style="padding:14px 18px;"><span style="font-size:14px;font-weight:bold;color:#fff;">${esc(standard.name)}</span><br><span style="font-size:12px;color:#aaa;">10 units · $30 shipping at checkout · Ships 2–3 days</span></td><td style="padding:14px 18px;text-align:right;"><span style="font-size:18px;font-weight:bold;color:#d4a843;">${esc(standard.price)}</span><br><a href="${esc(standard.url)}" style="display:inline-block;margin-top:6px;background:#d4a843;color:#111;font-size:12px;font-weight:bold;text-decoration:none;padding:8px 16px;border-radius:2px;">Checkout →</a></td></tr>${volumeRow}
</table>
<p style="margin:14px 0 0;font-size:12px;color:#aaa;">📦 In stock — limited run. Ships 2–3 business days. Stock up for Juneteenth and back-to-school.</p>
<p style="margin:18px 0 0;font-size:13px;color:#ccc;">— Scott<br><span style="font-size:11px;color:#777;">hello@blackwallstreetopoly.com</span></p>
</td></tr>
<tr><td style="background:#0d0d0d;padding:12px 24px;border-top:1px solid #2a2a2a;"><p style="margin:0;font-size:10px;color:#555;text-align:center;">Black Wall Street Monopoly · <a href="https://www.etsy.com/shop/BlackWallStreetopoly" style="color:#555;">etsy.com/shop/BlackWallStreetopoly</a><br>Reply UNSUBSCRIBE to opt out.</p></td></tr>
</table></td></tr></table></body></html>`,
  };
}

async function main() {
  const apiKey = process.env.MAILEROO_API_KEY;
  if (!apiKey && !DRY_RUN) {
    console.error("MAILEROO_API_KEY not set");
    process.exit(1);
  }

  const templates = ["skynpatch_b2b_intro", "blackwallstreetopoly_wholesale_intro"];
  let sql = `
    SELECT DISTINCT ON (LOWER(TRIM(to_email)), brand_slug)
           to_email, to_name, brand_slug
    FROM email_sends
    WHERE status = 'sent'
      AND template = ANY($1::text[])
      AND to_email IS NOT NULL AND TRIM(to_email) != ''
  `;
  const params = [templates];
  if (BRAND_FILTER) {
    const slug = BRAND_FILTER === "skynpatch" ? "skynpatch" : "blackwallstreetopoly";
    sql += ` AND brand_slug = $2`;
    params.push(slug);
  }
  sql += ` ORDER BY LOWER(TRIM(to_email)), brand_slug, sent_at DESC`;
  if (LIMIT) {
    sql += ` LIMIT ${Math.max(1, LIMIT)}`;
  }

  const { rows } = await pg.query(sql, params);
  console.log(`[resend-converting] Found ${rows.length} recipients (brand filter: ${BRAND_FILTER || "all"}, limit: ${LIMIT || "none"})\n`);
  if (rows.length === 0) {
    await pg.end();
    return;
  }

  if (DRY_RUN) {
    rows.forEach((r, i) => console.log(`  ${i + 1}. ${r.to_email} (${r.to_name || "—"}) [${r.brand_slug}]`));
    console.log("\n[DRY RUN] No emails sent. Run without --dry-run to send.");
    await pg.end();
    return;
  }

  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    const { to_email, to_name, brand_slug } = row;
    const sender = await resolveBrandSender(
      brand_slug,
      "Scott",
      process.env.MAILEROO_FROM_EMAIL
    );
    enforceSender({ brandSlug: brand_slug, fromEmail: sender.fromEmail, provisioningStatus: sender.provisioningStatus });

    const products = getStripeProducts(brand_slug);
    let subject, html;
    if (brand_slug === "skynpatch") {
      const out = buildSkynConverting(to_name, products);
      subject = out.subject;
      html = out.html;
    } else {
      const out = buildBWSConverting(to_name, products);
      subject = out.subject;
      html = out.html;
    }

    try {
      const result = await sendMaileroo({
        to: to_email.trim(),
        subject,
        html,
        fromName: sender.fromName,
        fromEmail: sender.fromEmail,
        apiKey,
      });
      if (result.status >= 200 && result.status < 300) {
        console.log(`  ✓ ${to_email} [${brand_slug}]`);
        sent++;
      } else {
        console.log(`  ✗ ${to_email} [${brand_slug}] HTTP ${result.status}`);
        failed++;
      }
    } catch (e) {
      console.log(`  ✗ ${to_email} [${brand_slug}] ${e.message}`);
      failed++;
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  console.log(`\nDone: ${sent} sent, ${failed} failed`);
  await pg.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
