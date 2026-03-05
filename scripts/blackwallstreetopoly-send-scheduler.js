#!/usr/bin/env node
/**
 * blackwallstreetopoly-send-scheduler.js
 * ─────────────────────────────────────────────────────────────────────────
 * Black Wall Street Monopoly wholesale email scheduler.
 * Same ramp as daily-send-scheduler; separate state file.
 *
 * Usage:
 *   node scripts/blackwallstreetopoly-send-scheduler.js
 *   node scripts/blackwallstreetopoly-send-scheduler.js --dry-run
 *   node scripts/blackwallstreetopoly-send-scheduler.js --status
 *   node scripts/blackwallstreetopoly-send-scheduler.js --max-sends 25
 */
"use strict";

const path = require("path");
const fs = require("fs");
const { Pool } = require("pg");
const { sendMaileroo } = require("../infra/send-email");
const { resolveBrandSender, enforceSender } = require("../infra/outbound-email-policy");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const BRAND_SLUG = "blackwallstreetopoly";
const TEMPLATE = "blackwallstreetopoly_wholesale_intro";

// Stripe products created for these emails — use both standard + volume
const STRIPE_FILE = path.join(__dirname, "../.stripe-products-blackwallstreetopoly.json");
const STRIPE_LINKS = fs.existsSync(STRIPE_FILE)
  ? JSON.parse(fs.readFileSync(STRIPE_FILE, "utf8"))
  : {};
function formatCents(cents) {
  return cents != null ? "$" + (Number(cents) / 100) : "";
}
const PRODUCT_STANDARD = STRIPE_LINKS.wholesale
  ? { name: STRIPE_LINKS.wholesale.name, price: formatCents(STRIPE_LINKS.wholesale.amount), url: STRIPE_LINKS.wholesale.url }
  : { name: "Wholesale Case Pack (10 units)", price: "$300", url: "https://www.etsy.com/listing/4329026086/black-wall-street-history-game-tulsa" };
const PRODUCT_VOLUME = STRIPE_LINKS.wholesale_volume
  ? { name: STRIPE_LINKS.wholesale_volume.name, price: formatCents(STRIPE_LINKS.wholesale_volume.amount), url: STRIPE_LINKS.wholesale_volume.url }
  : null;

const dbHost = process.env.POSTGRES_HOST || process.env.CLAW_DB_HOST;
const dbPort = parseInt(process.env.POSTGRES_PORT || process.env.CLAW_DB_PORT || "15432", 10);
const dbUser = process.env.POSTGRES_USER || process.env.CLAW_DB_USER || "claw";
const dbPass = process.env.POSTGRES_PASSWORD || process.env.CLAW_DB_PASSWORD;
const dbName = process.env.POSTGRES_DB || process.env.CLAW_DB_NAME || "claw_architect";

if (!dbHost || !dbPass) {
  throw new Error("Missing DB env vars. Set POSTGRES_* or CLAW_DB_* including password.");
}

const pool = new Pool({
  host: dbHost,
  port: dbPort,
  user: dbUser,
  password: dbPass,
  database: dbName,
});

const DRY_RUN = process.argv.includes("--dry-run");
const STATUS_ONLY = process.argv.includes("--status");
const MAX_SENDS = Math.max(1, parseInt((() => {
  const i = process.argv.indexOf("--max-sends");
  return i >= 0 ? process.argv[i + 1] : "999999";
})(), 10) || 999999);
const FORCED_EMAIL = (() => {
  const i = process.argv.indexOf("--to-email");
  return i >= 0 ? String(process.argv[i + 1] || "").trim() : "";
})();
const FORCED_NAME = (() => {
  const i = process.argv.indexOf("--to-name");
  return i >= 0 ? String(process.argv[i + 1] || "").trim() : "Store Team";
})();

const RAMP_SCHEDULE = [
  [7, 20],
  [14, 50],
  [21, 100],
  [28, 200],
  [Infinity, 500],
];
const STATE_FILE = process.env.BWS_SCHEDULER_STATE_FILE
  ? path.resolve(process.env.BWS_SCHEDULER_STATE_FILE)
  : path.join(__dirname, "../.leadgen-state-blackwallstreetopoly.json");

function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
    catch { /* fall through */ }
  }
  return { firstSendDate: null, totalSent: 0, daySends: {} };
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function getDayNumber(state) {
  if (!state.firstSendDate) return 1;
  const first = new Date(state.firstSendDate);
  const now = new Date();
  const diff = Math.floor((now - first) / (1000 * 60 * 60 * 24));
  return diff + 1;
}

function getDailyLimit(dayNumber) {
  for (const [maxDay, limit] of RAMP_SCHEDULE) {
    if (dayNumber <= maxDay) return limit;
  }
  return 500;
}

async function getDbSendsToday(brandSlug, template, tz = process.env.TZ || "America/Phoenix") {
  const { rows } = await pool.query(
    `WITH bounds AS (
       SELECT
         date_trunc('day', NOW() AT TIME ZONE $3) AT TIME ZONE $3 AS day_start,
         (date_trunc('day', NOW() AT TIME ZONE $3) + INTERVAL '1 day') AT TIME ZONE $3 AS day_end
     )
     SELECT COUNT(*)::int AS sends_today
     FROM email_sends es
     CROSS JOIN bounds b
     WHERE es.brand_slug = $1
       AND es.template = $2
       AND es.sent_at >= b.day_start
       AND es.sent_at < b.day_end`,
    [brandSlug, template, tz]
  );
  return Number(rows?.[0]?.sends_today || 0);
}

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildEmail(lead, brandMeta) {
  const bizName = esc(lead.business_name);
  const fromName = esc(brandMeta.from_name || "Scott");
  const fromEmail = esc(brandMeta.brand_email || "hello@blackwallstreetopoly.com");

  const subject = `Stock Black Wall Street Monopoly — wholesale ${PRODUCT_STANDARD.price}/case, ships fast`;

  // Volume block — only rendered if Stripe volume product exists
  const volumeCta = PRODUCT_VOLUME
    ? `
      <tr>
        <td style="padding:14px 20px;border-top:1px solid #2a2a2a;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="vertical-align:top;">
                <div style="font-family:Arial,sans-serif;font-size:13px;font-weight:bold;color:#d4a843;">
                  Volume Order — 100+ units
                </div>
                <div style="font-family:Arial,sans-serif;font-size:12px;color:#aaaaaa;margin-top:3px;">
                  ${PRODUCT_VOLUME.price}/case · $300 shipping at checkout · Best per-unit for 100+ units
                </div>
              </td>
              <td style="text-align:right;vertical-align:top;white-space:nowrap;padding-left:12px;">
                <a href="${esc(PRODUCT_VOLUME.url)}"
                   style="display:inline-block;background:#d4a843;color:#111111;
                          font-family:Arial,sans-serif;font-size:12px;font-weight:bold;
                          text-decoration:none;padding:9px 18px;border-radius:2px;">
                  Checkout →
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Black Wall Street Monopoly Wholesale</title>
</head>
<body style="margin:0;padding:0;background:#1a1a1a;font-family:Arial,sans-serif;">

<!-- Preview text: everything in email, checkout opens Stripe -->
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;color:#1a1a1a;">
Everything in this email. Checkout opens Stripe — 10-pack or volume. $30/unit margin. In stock, ships fast.
</div>

<table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1a1a;padding:24px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0"
       style="background:#111111;max-width:600px;border-radius:4px;overflow:hidden;">

  <!-- Header -->
  <tr>
    <td style="background:#1a1a1a;padding:28px 28px 20px;border-bottom:3px solid #d4a843;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td>
            <div style="font-family:Georgia,serif;font-size:22px;color:#d4a843;
                        font-weight:bold;letter-spacing:0.5px;line-height:1.2;">
              Black Wall Street<br>Monopoly
            </div>
            <div style="font-family:Arial,sans-serif;font-size:11px;color:#888888;
                        margin-top:5px;letter-spacing:0.5px;">
              WHOLESALE PARTNER OFFER
            </div>
          </td>
          <td align="right" style="vertical-align:bottom;">
            <div style="font-family:Arial,sans-serif;font-size:11px;color:#777777;line-height:1.8;">
              <a href="https://www.etsy.com/shop/BlackWallStreetopoly"
                 style="color:#d4a843;text-decoration:none;">
                BlackWallStreetopoly
              </a><br>
              ${fromEmail}
            </div>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Product photo (set BWS_PRODUCT_IMAGE_URL in .env to your game box / product image URL) -->
${(process.env.BWS_PRODUCT_IMAGE_URL || "").trim()
  ? `  <tr>
    <td style="padding:0 28px 20px;">
      <img src="${esc(process.env.BWS_PRODUCT_IMAGE_URL.trim())}" alt="Black Wall Street Monopoly game" width="544" height="300" style="display:block;width:100%;max-width:544px;height:auto;border-radius:4px;border:1px solid #2a2a2a;" />
    </td>
  </tr>
`
  : ""}

  <!-- Body -->
  <tr>
    <td style="padding:26px 28px 16px;">

      <p style="margin:0 0 16px;font-family:Arial,sans-serif;font-size:14px;
                color:#dddddd;line-height:1.5;">
        Hi ${bizName},
      </p>

      <!-- Cultural hook -->
      <p style="margin:0 0 18px;font-family:Georgia,serif;font-size:15px;
                color:#ffffff;line-height:1.75;font-style:italic;">
        "Greenwood, Tulsa, 1921 — the wealthiest Black community in America. They called it Black Wall Street."
      </p>

      <p style="margin:0 0 18px;font-family:Arial,sans-serif;font-size:14px;
                color:#cccccc;line-height:1.75;">
        <strong style="color:#ffffff;">Black Wall Street Monopoly</strong> brings that history to life.
        It's a board game built around Black economic history, financial literacy, and the legacy of
        the Greenwood District — a story your customers already know and want to own.
      </p>

      <!-- Why it sells in YOUR store -->
      <table width="100%" cellpadding="0" cellspacing="0"
             style="background:#1a1a1a;border-left:3px solid #d4a843;border-radius:2px;margin:0 0 22px;">
        <tr>
          <td style="padding:14px 18px;">
            <div style="font-family:Arial,sans-serif;font-size:11px;font-weight:bold;
                        color:#d4a843;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;">
              Why it moves in your store
            </div>
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="font-family:Arial,sans-serif;font-size:13px;color:#cccccc;
                           padding:4px 0;vertical-align:top;">
                  <span style="color:#d4a843;font-weight:bold;margin-right:8px;">✓</span>
                  <strong style="color:#ffffff;">Black-owned boutiques</strong> — community pride purchase, gifts themselves
                </td>
              </tr>
              <tr>
                <td style="font-family:Arial,sans-serif;font-size:13px;color:#cccccc;
                           padding:4px 0;vertical-align:top;">
                  <span style="color:#d4a843;font-weight:bold;margin-right:8px;">✓</span>
                  <strong style="color:#ffffff;">HBCU campus stores &amp; bookstores</strong> — educational + cultural, built-in audience
                </td>
              </tr>
              <tr>
                <td style="font-family:Arial,sans-serif;font-size:13px;color:#cccccc;
                           padding:4px 0;vertical-align:top;">
                  <span style="color:#d4a843;font-weight:bold;margin-right:8px;">✓</span>
                  <strong style="color:#ffffff;">Toy stores &amp; gift shops</strong> — stands out in any game section, tells a story
                </td>
              </tr>
              <tr>
                <td style="font-family:Arial,sans-serif;font-size:13px;color:#cccccc;
                           padding:4px 0;vertical-align:top;">
                  <span style="color:#d4a843;font-weight:bold;margin-right:8px;">✓</span>
                  <strong style="color:#ffffff;">Holiday &amp; Juneteenth gift sets</strong> — moves in seasonal displays year-round
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <!-- Margin callout -->
      <table width="100%" cellpadding="0" cellspacing="0"
             style="background:linear-gradient(135deg,#1e2a1a 0%,#1a1a1a 100%);border:1px solid #2d4a2a;border-radius:3px;margin:0 0 20px;">
        <tr>
          <td style="padding:14px 18px;">
            <div style="font-family:Arial,sans-serif;font-size:11px;font-weight:bold;
                        color:#d4a843;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">
              Your margin
            </div>
            <div style="font-family:Arial,sans-serif;font-size:14px;color:#dddddd;line-height:1.5;">
              <strong style="color:#ffffff;">${PRODUCT_STANDARD.price}</strong> per case (10 units) = <strong style="color:#d4a843;">$30/unit</strong> cost.
              Retail at $49.99+ — strong margin for boutiques, HBCU stores, and gift shops.
            </div>
          </td>
        </tr>
      </table>

      <p style="margin:0 0 12px;font-family:Arial,sans-serif;font-size:14px;
                color:#cccccc;line-height:1.6;">
        Everything you need is in this email. When you're ready to pay, the buttons below open Stripe checkout — no forms to fill here.
      </p>
      <p style="margin:0 0 20px;font-family:Arial,sans-serif;font-size:12px;
                color:#aaaaaa;line-height:1.5;">
        <strong style="color:#d4a843;">Shipping:</strong> 10-pack = $30. Volume (100+ units) = $300. Added at checkout.
      </p>

    </td>
  </tr>

  <!-- Checkout: Stripe only (same pattern as SkynPatch — full offer in email, checkout opens Stripe) -->
  <tr>
    <td style="padding:0 28px 24px;">

      <div style="font-family:Arial,sans-serif;font-size:11px;font-weight:bold;
                  color:#d4a843;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">
        Checkout — opens Stripe (secure)
      </div>

      <table width="100%" cellpadding="0" cellspacing="0"
             style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:3px;overflow:hidden;">

        <!-- Standard case pack -->
        <tr>
          <td style="padding:16px 20px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="vertical-align:top;">
                  <div style="font-family:Arial,sans-serif;font-size:14px;font-weight:bold;
                              color:#ffffff;">
                    ${esc(PRODUCT_STANDARD.name)}
                  </div>
                  <div style="font-family:Arial,sans-serif;font-size:12px;color:#aaaaaa;margin-top:4px;">
                    10 units per case &nbsp;·&nbsp; $30 shipping at checkout &nbsp;·&nbsp; In stock &nbsp;·&nbsp; Ships 2–3 days
                  </div>
                </td>
                <td style="text-align:right;vertical-align:top;white-space:nowrap;padding-left:12px;">
                  <div style="font-family:Arial,sans-serif;font-size:20px;font-weight:bold;
                              color:#d4a843;">
                    ${PRODUCT_STANDARD.price}
                  </div>
                  <a href="${esc(PRODUCT_STANDARD.url)}"
                     style="display:inline-block;margin-top:8px;background:#d4a843;color:#111111;
                            font-family:Arial,sans-serif;font-size:13px;font-weight:bold;
                            text-decoration:none;padding:10px 20px;border-radius:2px;">
                    Checkout →
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        ${volumeCta}

      </table>
    </td>
  </tr>

  <!-- Urgency + social proof -->
  <tr>
    <td style="padding:0 28px 24px;">
      <table width="100%" cellpadding="0" cellspacing="0"
             style="background:#1a1a1a;border-left:3px solid #d4a843;border-radius:2px;">
        <tr>
          <td style="padding:12px 16px;font-family:Arial,sans-serif;font-size:12px;
                     color:#aaaaaa;line-height:1.7;">
            📦 <strong style="color:#ffffff;">In stock now — limited run.</strong>
            We ship within 2–3 business days. Don't miss Juneteenth and back-to-school; stock up this week.
            Also on Etsy —
            <a href="https://www.etsy.com/listing/4329026086/black-wall-street-history-game-tulsa"
               style="color:#d4a843;">retail listing</a>
            for end-buyer positioning.
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Sign-off -->
  <tr>
    <td style="padding:0 28px 28px;">
      <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;
                color:#cccccc;line-height:1.6;">
        — ${fromName}<br>
        <span style="color:#777777;font-size:11px;">
          Black Wall Street Monopoly &nbsp;·&nbsp;
          <a href="mailto:${fromEmail}" style="color:#777777;">${fromEmail}</a>
        </span>
      </p>
    </td>
  </tr>

  <!-- CAN-SPAM footer -->
  <tr>
    <td style="background:#0d0d0d;padding:14px 28px;border-top:1px solid #2a2a2a;">
      <p style="margin:0;font-family:Arial,sans-serif;font-size:10px;color:#555555;
                line-height:1.6;text-align:center;">
        Black Wall Street Monopoly &nbsp;·&nbsp;
        <a href="https://www.etsy.com/shop/BlackWallStreetopoly"
           style="color:#555555;">etsy.com/shop/BlackWallStreetopoly</a><br>
        You received this because your store may carry cultural, educational, or gift products.<br>
        Reply UNSUBSCRIBE or email
        <a href="mailto:unsubscribe@blackwallstreetopoly.com"
           style="color:#555555;">unsubscribe@blackwallstreetopoly.com</a> to opt out.
      </p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;

  return { subject, html };
}

async function mailerooSend(to, toName, subject, html, sender) {
  const MAX_ATTEMPTS = 3;
  const RETRY_MS = [0, 2000, 5000];
  let lastResult;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (RETRY_MS[attempt] > 0) await new Promise((r) => setTimeout(r, RETRY_MS[attempt]));
    try {
      const result = await sendMaileroo({
        to,
        subject,
        html,
        fromName: sender.fromName,
        fromEmail: sender.fromEmail,
        apiKey: process.env.BREVO_API_KEY || process.env.MAILEROO_API_KEY,
        provider: "brevo", // BWS uses 3D Game Art Academy (Brevo + 3dgameartacademy.com)
      });
      if (result.status >= 200 && result.status < 300) return result;
      if (result.status >= 400 && result.status < 500) return result;
      lastResult = result;
      console.warn(`  [maileroo] HTTP ${result.status} attempt ${attempt + 1}/${MAX_ATTEMPTS}`);
    } catch (e) {
      lastResult = { status: 0, body: {} };
      console.warn(`  [maileroo] error attempt ${attempt + 1}/${MAX_ATTEMPTS}: ${e.message}`);
    }
  }
  return lastResult;
}

function sanitizeEmail(raw) {
  if (!raw) return null;
  let email = String(raw).trim().replace(/^mailto:/i, "").replace(/["'<>]/g, "").replace(/\s+/g, "");
  if (email.includes(",")) email = email.split(",")[0].trim();
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/i.test(email) ? email.toLowerCase() : null;
}

async function main() {
  const state = loadState();
  const today = todayStr();
  const dayNum = getDayNumber(state);
  const limit = getDailyLimit(dayNum);
  const dbSentToday = await getDbSendsToday(BRAND_SLUG, TEMPLATE);
  const fileSentToday = Number(state.daySends[today] || 0);
  const sentToday = dbSentToday;
  const remaining = Math.max(0, limit - sentToday);

  if (fileSentToday !== dbSentToday) {
    state.daySends[today] = dbSentToday;
    saveState(state);
    console.log(`  ↺ Synced state day count from DB (${fileSentToday} -> ${dbSentToday})`);
  }

  console.log("\n");
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║     BLACK WALL STREET MONOPOLY — WHOLESALE EMAIL SCHEDULER    ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");
  console.log(`  📅 Today           : ${today}`);
  console.log(`  📈 Ramp day        : ${dayNum}`);
  console.log(`  📊 Daily limit     : ${limit}`);
  console.log(`  ✉️  Sent today      : ${sentToday}`);
  console.log(`  🔄 Remaining today : ${remaining}\n`);

  if (STATUS_ONLY) {
    await pool.end();
    return;
  }

  if (remaining <= 0 && !FORCED_EMAIL) {
    console.log(`  ✅ Daily limit (${limit}) already reached for today.\n`);
    await pool.end();
    return;
  }
  if (FORCED_EMAIL) console.log("  📤 Forced recipient — sending regardless of daily limit.\n");

  if (DRY_RUN) console.log("  ⚠️  DRY RUN — no actual sends\n");

  const sender = await resolveBrandSender(
    BRAND_SLUG,
    process.env.BLACKWALLSTREETOPOLY_FROM_NAME || process.env.MAILEROO_FROM_NAME || "Scott",
    process.env.BLACKWALLSTREETOPOLY_FROM_EMAIL || process.env.MAILEROO_FROM_EMAIL
  );
  const fromName = sender.fromName;
  const fromEmail = sender.fromEmail;
  enforceSender({ brandSlug: BRAND_SLUG, fromEmail, provisioningStatus: sender.provisioningStatus });

  const runLimit = Math.max(0, Math.min(remaining, MAX_SENDS));
  const { rows: queriedLeads } = await pool.query(`
    SELECT l.*, b.from_name, b.brand_email
    FROM leads l
    LEFT JOIN brands b ON b.slug = l.brand_slug
    WHERE l.brand_slug = $1
      AND l.email IS NOT NULL AND l.email != ''
      AND l.status != 'unsubscribed' AND l.status != 'bounced'
      AND NOT EXISTS (
        SELECT 1 FROM email_sends es
        WHERE es.lead_id = l.id AND es.template = $2
      )
    ORDER BY
      CASE WHEN l.contact_title IS NOT NULL AND (
        l.contact_title ILIKE '%buyer%' OR l.contact_title ILIKE '%purchasing%'
        OR l.contact_title ILIKE '%wholesale%' OR l.contact_title ILIKE '%merchandise%'
      ) THEN 0 ELSE 1 END,
      CASE l.category
        WHEN 'toy store'      THEN 1
        WHEN 'black owned boutique' THEN 1
        WHEN 'hbcu shop'      THEN 1
        WHEN 'hbcu bookstore' THEN 2
        WHEN 'campus store'   THEN 2
        ELSE 3
      END,
      l.id ASC
    LIMIT $3
  `, [BRAND_SLUG, TEMPLATE, runLimit]);

  const leads = FORCED_EMAIL
    ? [{ id: null, brand_slug: BRAND_SLUG, business_name: FORCED_NAME, email: FORCED_EMAIL, from_name: fromName }]
    : queriedLeads;

  const brandMeta = { from_name: fromName, brand_email: fromEmail };
  console.log(`  📋 Ready to send : ${leads.length} leads\n`);

  let sent = 0, failed = 0, skipped = 0;

  for (const lead of leads) {
    const cleanEmail = sanitizeEmail(lead.email);
    if (!cleanEmail) {
      process.stdout.write(`  → ${(lead.business_name || "").slice(0, 40).padEnd(41)} ${String(lead.email || "").slice(0, 35).padEnd(36)} [invalid, skipped]\n`);
      failed++;
      continue;
    }

    const { subject, html } = buildEmail(lead, { ...brandMeta, from_name: lead.from_name || fromName, brand_email: fromEmail });
    process.stdout.write(`  → ${(lead.business_name || "").slice(0, 40).padEnd(41)} ${cleanEmail.slice(0, 35).padEnd(36)}`);

    if (DRY_RUN) {
      process.stdout.write(" [DRY RUN]\n");
      sent++;
      continue;
    }

    if (!FORCED_EMAIL) {
      const claimRes = await pool.query(
        `INSERT INTO email_sends (lead_id, brand_slug, to_email, to_name, subject, template, status, sent_at)
         VALUES ($1,$2,$3,$4,$5,$6,'sending',NOW())
         ON CONFLICT (lead_id, template) DO NOTHING RETURNING id`,
        [lead.id, BRAND_SLUG, cleanEmail, lead.business_name, subject, TEMPLATE]
      );
      if (claimRes.rowCount === 0) {
        process.stdout.write(" [already claimed]\n");
        skipped++;
        continue;
      }
    }

    const result = await mailerooSend(cleanEmail, lead.business_name, subject, html, { fromName, fromEmail });

    if (result.status === 200 || result.status === 201) {
      const mailerooId = result.body?.data?.message_id || result.body?.data?.id || null;
      if (!FORCED_EMAIL) {
        await pool.query(
          `UPDATE email_sends SET status = 'sent', maileroo_id = $1 WHERE lead_id = $2 AND template = $3`,
          [mailerooId, lead.id, TEMPLATE]
        );
      }
      process.stdout.write(" ✓ sent\n");
      sent++;
      if (!FORCED_EMAIL) {
        state.totalSent = (state.totalSent || 0) + 1;
        state.daySends[today] = (state.daySends[today] || 0) + 1;
        if (!state.firstSendDate) state.firstSendDate = today;
        saveState(state);
      }
    } else {
      process.stdout.write(` ✗ failed (${result.status})\n`);
      if (!FORCED_EMAIL) {
        await pool.query(
          `UPDATE email_sends SET status = 'failed' WHERE lead_id = $1 AND template = $2`,
          [lead.id, TEMPLATE]
        ).catch(() => {});
      }
      failed++;
    }
  }

  console.log(`\n  Done: ${sent} sent, ${failed} failed, ${skipped} skipped\n`);
  await pool.end();
}

main().catch((err) => {
  console.error("[bws-scheduler] fatal:", err.message);
  process.exit(1);
});
