// agents/leadgen-agent.js
// Handles fetch_leads (Google Places) and send_email (Maileroo) task types.
//
// fetch_leads payload:
//   { brand_slug, category, location, radius_m: 50000, max_results: 60, plan_id, task_id }
//   category examples: "gym", "pharmacy", "spa", "health food store", "yoga studio"
//   location: "Phoenix, AZ" or "33.4484,-112.0740" (lat,lng)
//
// send_email payload:
//   { brand_slug, lead_id, template, subject, from_name, plan_id, task_id }
//   template: "skynpatch_b2b_intro" | "skynpatch_b2b_followup" | custom string
//
// CAN-SPAM: All outbound emails include physical address, unsubscribe instructions,
//           and are logged to email_sends for compliance.

"use strict";

const path   = require("path");
const fs     = require("fs");
const https  = require("https");
const pg     = require("../infra/postgres");
const { register } = require("./registry");
const { LEAD_CATEGORIES } = require("../config/lead-categories");
const { sendMaileroo } = require("../infra/send-email");
const { resolveBrandSender, enforceSender } = require("../infra/outbound-email-policy");

/** Canonical wholesale page (order form) — always link here for "Order bundle" / "Order any mix" in lead gen. */
const SKYNPATCH_WHOLESALE_PAGE_URL = process.env.SKYNPATCH_WHOLESALE_PAGE_URL || "https://skynpatch.com/wholesale";

function formatCents(cents) {
  if (cents == null) return "";
  return "$" + (Number(cents) / 100).toFixed(0);
}

/** Load Stripe product data for direct-sales emails. Prices in dollars (from cents). */
function getStripeProducts(brandSlug) {
  if (brandSlug === "skynpatch") {
    const file = path.join(__dirname, "..", ".stripe-products.json");
    if (fs.existsSync(file)) {
      try {
        const data = JSON.parse(fs.readFileSync(file, "utf8"));
        const bundle = data.starter_bundle;
        const singleCase = data.zzzzz || data.ignite || data.longevity || data.synergy;
        const skuKeys = ["zzzzz", "ignite", "longevity", "synergy", "pre_party", "lust", "grace"];
        const skus = skuKeys
          .filter((k) => data[k] && data[k].url)
          .map((k) => ({ name: data[k].name, price: formatCents(data[k].amount), url: data[k].url }));
        return {
          bundle: bundle ? { name: bundle.name, price: formatCents(bundle.amount), url: SKYNPATCH_WHOLESALE_PAGE_URL } : { name: "Starter Bundle — All 4 SKUs", price: "$900", url: SKYNPATCH_WHOLESALE_PAGE_URL },
          singleCasePrice: singleCase ? formatCents(singleCase.amount) : "$250",
          skus: skus.length ? skus : [{ name: "Single case (50 packs)", price: "$250", url: SKYNPATCH_WHOLESALE_PAGE_URL }],
          wholesaleUrl: SKYNPATCH_WHOLESALE_PAGE_URL,
        };
      } catch (_) {}
    }
    return { bundle: { name: "Starter Bundle — All 4 SKUs", price: "$900", url: SKYNPATCH_WHOLESALE_PAGE_URL }, singleCasePrice: "$250", skus: [], wholesaleUrl: SKYNPATCH_WHOLESALE_PAGE_URL };
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
          wholesaleUrl: standard?.url || "https://www.etsy.com/listing/4329026086/black-wall-street-history-game-tulsa",
        };
      } catch (_) {}
    }
    return {
      standard: { name: "Wholesale Case Pack (10 units)", price: "$300", url: "https://www.etsy.com/listing/4329026086/black-wall-street-history-game-tulsa" },
      volume: null,
      wholesaleUrl: "https://www.etsy.com/listing/4329026086/black-wall-street-history-game-tulsa",
    };
  }
  return null;
}

function getWholesaleUrl(brandSlug) {
  const products = getStripeProducts(brandSlug);
  if (products?.wholesaleUrl) return products.wholesaleUrl;
  if (brandSlug === "skynpatch") return SKYNPATCH_WHOLESALE_PAGE_URL;
  if (brandSlug === "blackwallstreetopoly") return "https://www.etsy.com/listing/4329026086/black-wall-street-history-game-tulsa";
  return null;
}

// ─── HTTP helpers ─────────────────────────────────────────────

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let raw = "";
      res.on("data", (d) => (raw += d));
      res.on("end", () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error(`JSON parse: ${raw.slice(0, 200)}`)); }
      });
    }).on("error", reject);
  });
}

function httpPost(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const parsed = new URL(url);
    const opts = {
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method:   "POST",
      headers:  { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), ...headers },
    };
    const req = https.request(opts, (res) => {
      let raw = "";
      res.on("data", (d) => (raw += d));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch (e) { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// ─── Google Places API ────────────────────────────────────────

/** Geocode a text location to lat/lng using Google Geocoding API */
async function geocode(location, apiKey) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${apiKey}`;
  const res = await httpGet(url);
  if (res.status !== "OK" || !res.results?.[0]) {
    throw new Error(`Geocoding failed for "${location}": ${res.status}`);
  }
  const loc = res.results[0].geometry.location;
  return { lat: loc.lat, lng: loc.lng };
}

/** Fetch one page of Places Nearby results */
async function placesNearby(lat, lng, radius, keyword, apiKey) {
  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius}&keyword=${encodeURIComponent(keyword)}&key=${apiKey}`;
  return httpGet(url);
}

/** Get place details including phone, website */
async function placeDetails(placeId, apiKey) {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,formatted_address,formatted_phone_number,website,address_component&key=${apiKey}`;
  return httpGet(url);
}

// ─── fetch_leads handler ──────────────────────────────────────

register("fetch_leads", async (payload) => {
  const {
    brand_slug,
    category   = "health food store",
    location   = "Phoenix, AZ",
    radius_m   = 50000,
    max_results = 60,
    plan_id,
    task_id,
  } = payload;

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_PLACES_API_KEY not set");
  if (!brand_slug) throw new Error("fetch_leads requires brand_slug");
  if (!LEAD_CATEGORIES.includes(category.toLowerCase()) && !payload?.allow_custom_category) {
    console.warn(`[leadgen] category "${category}" not in curated list; continuing because custom categories are allowed when explicitly requested.`);
  }

  console.log(`[leadgen] fetch_leads brand=${brand_slug} category="${category}" location="${location}"`);

  // Resolve location to lat/lng
  let lat, lng;
  if (/^-?\d+\.\d+,-?\d+\.\d+$/.test(location)) {
    [lat, lng] = location.split(",").map(Number);
  } else {
    const geo = await geocode(location, apiKey);
    lat = geo.lat;
    lng = geo.lng;
  }

  // Paginate through Places results (each page = up to 20 results, 3 pages max)
  let allPlaces  = [];
  let nextToken  = null;
  let pages      = 0;

  do {
    let res;
    if (nextToken) {
      await new Promise((r) => setTimeout(r, 2000)); // Google requires delay before next_page_token
      const pageUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?pagetoken=${nextToken}&key=${apiKey}`;
      res = await httpGet(pageUrl);
    } else {
      res = await placesNearby(lat, lng, radius_m, category, apiKey);
    }

    if (res.status !== "OK" && res.status !== "ZERO_RESULTS") {
      throw new Error(`Google Places error: ${res.status} — ${res.error_message || ""}`);
    }

    allPlaces.push(...(res.results || []));
    nextToken = res.next_page_token || null;
    pages++;
  } while (nextToken && allPlaces.length < max_results && pages < 3);

  allPlaces = allPlaces.slice(0, max_results);

  // Enrich with details and store
  // Throttle: Google Places detail calls are billed per request (~$0.017 each)
  // and hitting the API too fast triggers OVER_QUERY_LIMIT errors.
  let stored = 0;
  for (const place of allPlaces) {
    let phone = null, website = null, city = null, state = null;

    // 200ms between detail calls to stay under rate limits
    await new Promise((r) => setTimeout(r, 200));

    try {
      const det = await placeDetails(place.place_id, apiKey);
      const r   = det.result || {};
      phone   = r.formatted_phone_number || null;
      website = r.website || null;

      // Parse address components
      for (const comp of r.address_components || []) {
        if (comp.types.includes("locality"))              city  = comp.long_name;
        if (comp.types.includes("administrative_area_level_1")) state = comp.short_name;
      }
    } catch (e) {
      console.warn(`[leadgen] details failed for ${place.place_id}: ${e.message}`);
    }

    try {
      await pg.query(
        `INSERT INTO leads (brand_slug, business_name, address, city, state, phone, website, category, place_id, raw_data, plan_id, task_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (place_id) DO UPDATE SET brand_slug=$1, phone=COALESCE(EXCLUDED.phone,leads.phone), website=COALESCE(EXCLUDED.website,leads.website)`,
        [
          brand_slug,
          place.name,
          place.vicinity || place.formatted_address || null,
          city, state,
          phone, website,
          category,
          place.place_id,
          JSON.stringify(place),
          plan_id, task_id,
        ]
      );
      stored++;
    } catch (e) {
      console.warn(`[leadgen] insert failed ${place.place_id}: ${e.message}`);
    }
  }

  console.log(`[leadgen] fetch_leads → ${allPlaces.length} found, ${stored} stored`);
  return {
    brand_slug,
    category,
    location,
    leads_found:  allPlaces.length,
    leads_stored: stored,
    cost_usd: 0,
    model_used: "n/a",
  };
});

// ─── HTML escape helper (prevent XSS from Google Places data) ──
function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

// ─── Email templates ──────────────────────────────────────────
// IMPORTANT: ALL user-supplied data (business_name, from_name, etc.)
// MUST be wrapped in esc() to prevent HTML injection from Google Places.

const TEMPLATES = {
  skynpatch_b2b_intro: (lead, brand) => {
    const products = brand.stripe_products || getStripeProducts("skynpatch");
    const bundle = products?.bundle || { name: "Starter Bundle — All 4 SKUs", price: "$900", url: SKYNPATCH_WHOLESALE_PAGE_URL };
    const skus = products?.skus || [];
    const skuRows = skus.map((s) => `<tr><td style="padding:6px 0;border-bottom:1px solid #eee;font-size:13px;">${esc(s.name)}</td><td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right;font-weight:bold;">${esc(s.price)}</td><td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right;"><a href="${esc(s.url)}" style="color:#f0c040;font-weight:bold;text-decoration:none;">Order →</a></td></tr>`).join("");
    const skuTable = skuRows ? `<p style="margin:12px 0 8px;font-size:12px;font-weight:bold;">Individual SKUs — each link goes to Stripe checkout:</p><table width="100%" cellpadding="0" cellspacing="0" style="font-size:12px;margin-bottom:16px;"><tr><td style="border-bottom:1px solid #ddd;padding:4px 0;">SKU</td><td style="border-bottom:1px solid #ddd;text-align:right;">Price</td><td style="border-bottom:1px solid #ddd;text-align:right;"></td></tr>${skuRows}</table>` : "";
    return {
      subject: `~58% margin · Skyn Patch wholesale — ${esc(lead.business_name)}`,
      html: `<p>Hi ${esc(lead.business_name)},</p>
<p><strong>~58% retail margin</strong> on 7 transdermal wellness patches — Sleep, Energy, Vitality, Immunity, Recovery, Lust, Grace. Shelf-ready, GS1 barcodes, one-case MOQ. Shipping: $5 first case + $1 per additional.</p>
<p><strong>Order any mix of 7 SKUs:</strong> one form, set quantity per SKU, we calculate shipping.</p>
<p><a href="${esc(bundle.url)}" style="display:inline-block;background:#111;color:#f0c040;padding:10px 24px;text-decoration:none;font-weight:bold;border-radius:3px;">Build your order →</a></p>
<p>Starter Bundle (all 4 core): <strong>${esc(bundle.price)}</strong> — <a href="${esc(bundle.url)}" style="font-weight:bold;color:#f0c040;">Order bundle →</a></p>
${skuTable}
<p>— ${esc(brand.from_name || "Team")}<br>${esc(brand.brand_email || "shop@skynpatch.com")}</p>
<hr>
<p style="font-size:11px;color:#999;">Skyn Patch · City, ST · <a href="https://skynpatch.com">skynpatch.com</a><br>To unsubscribe reply UNSUBSCRIBE or email <a href="mailto:unsubscribe@skynpatch.com">unsubscribe@skynpatch.com</a>.</p>`,
    };
  },

  skynpatch_b2b_followup: (lead, brand) => {
    const products = brand.stripe_products || getStripeProducts("skynpatch");
    const bundle = products?.bundle || { name: "Starter Bundle — All 4 SKUs", price: "$900", url: SKYNPATCH_WHOLESALE_PAGE_URL };
    return {
      subject: `~58% margin · ${esc(bundle.price)} Skyn Patch — order any mix`,
      html: `<p>Hi ${esc(lead.business_name)},</p>
<p><strong>~58% margin</strong> — 7 SKUs, one order form. Shipping: $5 first case + $1 per additional.</p>
<p><a href="${esc(bundle.url)}" style="display:inline-block;background:#111;color:#f0c040;padding:10px 24px;text-decoration:none;font-weight:bold;border-radius:3px;">Build your order →</a></p>
<p>— ${esc(brand.from_name || "Team")}<br>${esc(brand.brand_email || "shop@skynpatch.com")}</p>
<hr>
<p style="font-size:11px;color:#999;">Skyn Patch · <a href="https://skynpatch.com">skynpatch.com</a><br>Reply UNSUBSCRIBE to opt out.</p>`,
    };
  },

  plushtrap_collab_intro: (lead, brand) => ({
    subject: `Collab / Wholesale — Plush Trap × ${esc(lead.business_name)}`,
    html: `<p>Hey ${esc(lead.business_name)},</p>
<p>I'm ${esc(brand.from_name || "Team")} from <strong>Plush Trap</strong> — we make retro-urban streetwear accessories and limited-edition collectibles (plushies, hats, masks) inspired by gaming and skate culture.</p>
<p>I wanted to reach out about a potential wholesale or collab opportunity. Our drops sell fast and our community is passionate. If you carry accessories or collectibles, we'd love to explore being on your shelves or featured in your space.</p>
<p>Check us out: <a href="https://examplebrand.com">examplebrand.com</a></p>
<p>&mdash;${esc(brand.from_name || "Team")}<br>${esc(brand.brand_email || "hello@examplebrand.com")}</p>
<hr>
<p style="font-size:11px;color:#999;">
  Plush Trap &middot; City, ST &middot; <a href="https://examplebrand.com">examplebrand.com</a><br>
  Reply UNSUBSCRIBE to opt out.
</p>`,
  }),

  blackwallstreetopoly_wholesale_intro: (lead, brand) => {
    const products = brand.stripe_products || getStripeProducts("blackwallstreetopoly");
    const standard = products?.standard || { name: "Wholesale Case Pack (10 units)", price: "$300", url: "https://www.etsy.com/listing/4329026086/black-wall-street-history-game-tulsa" };
    const volume = products?.volume;
    const fromName = esc(brand.from_name || "Team");
    const fromEmail = esc(brand.brand_email || "hello@blackwallstreetopoly.com");
    const volumeRow = volume
      ? `<tr><td style="padding:12px 16px;border-top:1px solid #2a2a2a;"><span style="font-size:13px;font-weight:bold;color:#fff;">${esc(volume.name)}</span><br><span style="font-size:12px;color:#aaa;">${esc(volume.price)}/case · $300 shipping at checkout · Best per-unit</span></td><td style="padding:12px 16px;border-top:1px solid #2a2a2a;text-align:right;"><a href="${esc(volume.url)}" style="display:inline-block;background:#d4a843;color:#111;font-size:12px;font-weight:bold;text-decoration:none;padding:8px 16px;border-radius:2px;">Checkout →</a></td></tr>`
      : "";
    return {
      subject: `Black Wall Street Monopoly wholesale — ${esc(standard.price)}/case, $30/unit margin · ${esc(lead.business_name)}`,
      html: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#1a1a1a;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1a1a;padding:20px 0;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#111;border-radius:4px;overflow:hidden;">
<tr><td style="background:#1a1a1a;padding:20px 24px;border-bottom:3px solid #d4a843;">
<div style="font-family:Georgia,serif;font-size:20px;color:#d4a843;font-weight:bold;">Black Wall Street Monopoly</div>
<div style="font-size:11px;color:#888;margin-top:4px;">WHOLESALE PARTNER OFFER</div>
</td></tr>
<tr><td style="padding:22px 24px;">
<p style="margin:0 0 14px;font-size:14px;color:#ddd;">Hi ${esc(lead.business_name)},</p>
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
<p style="margin:18px 0 0;font-size:13px;color:#ccc;">— ${fromName}<br><span style="font-size:11px;color:#777;">${fromEmail}</span></p>
</td></tr>
<tr><td style="background:#0d0d0d;padding:12px 24px;border-top:1px solid #2a2a2a;"><p style="margin:0;font-size:10px;color:#555;text-align:center;">Black Wall Street Monopoly · <a href="https://www.etsy.com/shop/BlackWallStreetopoly" style="color:#555;">etsy.com/shop/BlackWallStreetopoly</a><br>Reply UNSUBSCRIBE to opt out.</p></td></tr>
</table></td></tr></table></body></html>`,
    };
  },
};

// ─── send_email handler ───────────────────────────────────────

register("send_email", async (payload) => {
  const {
    brand_slug,
    lead_id,
    template   = "skynpatch_b2b_intro",
    subject: subjectOverride,
    from_name: fromNameOverride,
    plan_id,
    task_id,
  } = payload;

  const apiKey = process.env.MAILEROO_API_KEY;
  const sender = await resolveBrandSender(
    brand_slug,
    fromNameOverride || process.env.MAILEROO_FROM_NAME || "Team",
    process.env.MAILEROO_FROM_EMAIL
  );
  const fromEmail = sender.fromEmail;
  const fromName = sender.fromName;
  if (!apiKey)     throw new Error("MAILEROO_API_KEY not set");
  if (!fromEmail)  throw new Error("MAILEROO_FROM_EMAIL not set");
  if (!brand_slug) throw new Error("send_email requires brand_slug");
  if (!lead_id)    throw new Error("send_email requires lead_id");
  enforceSender({ brandSlug: brand_slug, fromEmail, provisioningStatus: sender.provisioningStatus });

  // Fetch lead
  const leadRes = await pg.query("SELECT * FROM leads WHERE id = $1", [lead_id]);
  const lead    = leadRes.rows[0];
  if (!lead) throw new Error(`Lead not found: ${lead_id}`);

  // Soft skip — Google Places doesn't return emails, so missing email is common
  if (!lead.email) {
    console.warn(`[leadgen] skip send_email: lead ${lead_id} (${lead.business_name}) has no email address`);
    return { skipped: true, reason: "no_email", lead_id, business_name: lead.business_name };
  }

  // Basic email format guard
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) {
    console.warn(`[leadgen] skip send_email: invalid email format "${lead.email}" for lead ${lead_id}`);
    return { skipped: true, reason: "invalid_email_format", lead_id, email: lead.email };
  }

  // Unknown template guard — never send a blank fallback email silently
  if (template && !TEMPLATES[template]) {
    throw new Error(`Unknown email template: "${template}". Valid: ${Object.keys(TEMPLATES).join(", ")}`);
  }

  // Build email from template first (so we have the subject before INSERT)
  const stripeProducts = getStripeProducts(brand_slug);
  const brandMeta = {
    from_name: fromName,
    brand_email: fromEmail,
    wholesale_url: getWholesaleUrl(brand_slug),
    stripe_products: stripeProducts,
  };
  const tmplFn = TEMPLATES[template];
  const tmplOut   = tmplFn ? tmplFn(lead, brandMeta) : { subject: template, html: "<p>Hello</p>" };
  const subject   = subjectOverride || tmplOut.subject;
  const html      = tmplOut.html;

  // Atomic dedup guard (CAN-SPAM: no duplicate sends).
  // INSERT ... ON CONFLICT DO NOTHING is safe under concurrent agents —
  // the unique constraint uq_email_sends_lead_template guarantees only one send.
  const dedup = await pg.query(
    `INSERT INTO email_sends (lead_id, brand_slug, to_email, to_name, subject, template, status, attempt_at, plan_id, task_id)
     VALUES ($1,$2,$3,$4,$5,$6,'pending',NOW(),$7,$8)
     ON CONFLICT (lead_id, template) DO NOTHING`,
    [lead_id, brand_slug, lead.email, lead.business_name, subject, template, plan_id, task_id]
  );
  if (dedup.rowCount === 0) {
    console.warn(`[leadgen] skip: already sent template=${template} to lead ${lead_id}`);
    return { skipped: true, reason: "already_sent", lead_id };
  }

  console.log(`[leadgen] send_email → ${lead.email} via Maileroo template=${template}`);

  // Maileroo API send (REST endpoint)
  const result = await sendMaileroo({
    to: lead.email,
    subject,
    html,
    fromName,
    fromEmail,
    apiKey,
  });

  // Correct Maileroo response path: body.data.message_id (with legacy fallbacks)
  const mailerooId = result.body?.data?.message_id
    || result.body?.data?.id
    || result.body?.id
    || result.body?.message_id
    || null;
  const sendStatus = result.status === 200 || result.status === 201 ? "sent" : "failed";

  if (sendStatus === "failed") {
    // Roll back the pending row so the lead can be retried
    await pg.query(
      `DELETE FROM email_sends WHERE lead_id=$1 AND template=$2 AND status='pending'`,
      [lead_id, template]
    );
    throw new Error(`Maileroo send failed (HTTP ${result.status}): ${JSON.stringify(result.body).slice(0, 200)}`);
  }

  // Update the pending row to sent
  await pg.query(
    `UPDATE email_sends
        SET status='sent', sent_at=NOW(), maileroo_id=$3
      WHERE lead_id=$1 AND template=$2`,
    [lead_id, template, mailerooId]
  );

  // Update lead status
  await pg.query("UPDATE leads SET status = 'emailed' WHERE id = $1 AND status = 'new'", [lead_id]);

  return {
    lead_id,
    to_email:     lead.email,
    template,
    maileroo_id:  mailerooId,
    status:       sendStatus,
    cost_usd:     0,
    model_used:   "n/a",
  };
});
