#!/usr/bin/env node
/**
 * adaptive-sender.js
 * Variant-aware outbound scheduler.
 *
 * What it does:
 * 1) Pulls unsent leads from Postgres
 * 2) Selects experiment variants via experiment-engine.js
 * 3) Sends personalized Maileroo emails
 * 4) Logs send + variant IDs for downstream revenue attribution
 *
 * Usage:
 *   node scripts/adaptive-sender.js
 *   node scripts/adaptive-sender.js --dry-run
 *   node scripts/adaptive-sender.js --status
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { sendMaileroo } = require("../infra/send-email");
const { getBrandSender, enforceSender } = require("../infra/outbound-email-policy");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

let selectVariantCombo = null;
let resolveVariantContent = null;
let logSend = null;
let experiment = null;
try {
  experiment = require("./experiment-engine");
  ({ selectVariantCombo, resolveVariantContent, logSend } = experiment);
} catch (e) {
  console.warn(`[adaptive-sender] experiment-engine unavailable: ${e.message}`);
}

const DRY_RUN = process.argv.includes("--dry-run");
const STATUS_ONLY = process.argv.includes("--status");

const STATE_FILE = path.join(__dirname, "../.adaptive-send-state.json");
const STRIPE_PRODUCTS_FILE = path.join(__dirname, "../.stripe-products.json");

const STRIPE_LINKS = fs.existsSync(STRIPE_PRODUCTS_FILE)
  ? JSON.parse(fs.readFileSync(STRIPE_PRODUCTS_FILE, "utf8"))
  : {};
const SKYNPATCH_WHOLESALE_PAGE_URL = process.env.SKYNPATCH_WHOLESALE_PAGE_URL || "https://skynpatch.com/wholesale";

const dbHost = process.env.POSTGRES_HOST || process.env.CLAW_DB_HOST;
const dbPort = parseInt(process.env.POSTGRES_PORT || process.env.CLAW_DB_PORT || "15432", 10);
const dbUser = process.env.POSTGRES_USER || process.env.CLAW_DB_USER || "claw";
const dbPass = process.env.POSTGRES_PASSWORD || process.env.CLAW_DB_PASSWORD;
const dbName = process.env.POSTGRES_DB || process.env.CLAW_DB_NAME || "claw_architect";

if (!dbHost || !dbPass) {
  throw new Error("Missing DB env vars. Set POSTGRES_* (preferred) or CLAW_DB_* including password.");
}

const pool = new Pool({
  host: dbHost,
  port: dbPort,
  user: dbUser,
  password: dbPass,
  database: dbName,
});

const RAMP_SCHEDULE = [
  [7, 20],
  [14, 50],
  [21, 100],
  [28, 200],
  [Infinity, 500],
];

function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
    catch { /* ignore */ }
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
  return Math.floor((now - first) / 86400000) + 1;
}

function getDailyLimit(dayNum) {
  for (const [maxDay, limit] of RAMP_SCHEDULE) {
    if (dayNum <= maxDay) return limit;
  }
  return 500;
}

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toSegment(lead) {
  const category = String(lead.category || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const state = String(lead.state || "na").toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return `${category}__${state}`;
}

function chooseOfferUrl(offerCode) {
  if (!offerCode) return SKYNPATCH_WHOLESALE_PAGE_URL;
  const keyByOffer = {
    offer_single_250: "zzzzz",
    offer_bundle_900: "starter_bundle",
    offer_bundle_799: "starter_bundle",
    offer_bundle_699: "starter_bundle",
    offer_free_ship: "starter_bundle",
  };
  const key = keyByOffer[offerCode] || "starter_bundle";
  return STRIPE_LINKS[key]?.url || SKYNPATCH_WHOLESALE_PAGE_URL;
}

function replaceVars(text, vars) {
  return String(text || "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, name) => {
    return vars[name] != null ? String(vars[name]) : "";
  });
}

function buildHtml(lead, parts) {
  const hook = parts.hook || "We help wellness-focused retailers add a low-footprint, high-margin product that sells through quickly.";
  const cta = parts.cta || "Reply YES and I will send the wholesale sheet.";
  const offer = parts.offerLabel || "Wholesale partner pricing available.";
  const offerUrl = parts.offerUrl;

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f7f7f7;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0;background:#f7f7f7;"><tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border:1px solid #e6e6e6;">
      <tr><td style="background:#000;padding:20px 28px;color:#fff;">
        <div style="font-family:Georgia,serif;font-size:28px;font-style:italic;font-weight:bold;">Skyn Patch</div>
        <div style="font-size:12px;color:#ccc;margin-top:4px;">Wear Your Wellness</div>
      </td></tr>
      <tr><td style="padding:24px 28px;color:#333;line-height:1.6;font-size:14px;">
        <p style="margin:0 0 12px;">Hi ${esc(lead.business_name || "there")},</p>
        <p style="margin:0 0 12px;">${esc(hook)}</p>
        <p style="margin:0 0 12px;">${esc(offer)}</p>
        <p style="margin:0 0 18px;">${esc(cta)}</p>
        <p style="margin:0 0 0;">
          <a href="${esc(offerUrl)}" style="display:inline-block;background:#000;color:#f0c040;text-decoration:none;padding:12px 20px;border-radius:4px;font-weight:bold;">
            View Wholesale Offer
          </a>
        </p>
      </td></tr>
      <tr><td style="background:#fafafa;padding:14px 28px;border-top:1px solid #eee;color:#888;font-size:11px;">
        Skyn Patch · Tempe, AZ · <a href="https://skynpatch.com" style="color:#888;">skynpatch.com</a>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

// Retry wrapper for transient Maileroo failures (5xx / network errors).
// 4xx = permanent failure (bad email, policy reject) — no retry.
async function mailerooSend(to, subject, html) {
  const apiKey = process.env.MAILEROO_API_KEY;
  if (!apiKey) return { status: 0, body: { skipped: true, reason: "MAILEROO_API_KEY missing" } };
  const sender = await getBrandSender("skynpatch");
  const fromName = sender.fromName || process.env.MAILEROO_FROM_NAME || "Scott";
  const fromEmail = sender.fromEmail || process.env.MAILEROO_FROM_EMAIL || "shop@skynpatch.com";
  enforceSender({ brandSlug: "skynpatch", fromEmail, provisioningStatus: sender.provisioningStatus });

  const MAX_ATTEMPTS = 3;
  const RETRY_MS     = [0, 2000, 5000];
  let lastResult;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (RETRY_MS[attempt] > 0) await new Promise(r => setTimeout(r, RETRY_MS[attempt]));
    try {
      lastResult = await sendMaileroo({
        to,
        subject,
        html,
        fromName,
        fromEmail,
        apiKey,
      });
      if (lastResult.status >= 200 && lastResult.status < 300) return lastResult;
      if (lastResult.status >= 400 && lastResult.status < 500) return lastResult; // permanent
      console.warn(`[adaptive-sender] Maileroo HTTP ${lastResult.status} attempt ${attempt + 1}/${MAX_ATTEMPTS}`);
    } catch (e) {
      lastResult = { status: 0, body: {}, _err: e };
      console.warn(`[adaptive-sender] Maileroo network error attempt ${attempt + 1}/${MAX_ATTEMPTS}: ${e.message}`);
    }
  }
  return lastResult;
}

async function main() {
  const state = loadState();
  const today = todayStr();
  const dayNum = getDayNumber(state);
  const limit = getDailyLimit(dayNum);
  const sentToday = state.daySends[today] || 0;
  const remaining = Math.max(0, limit - sentToday);

  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║             SKYNPATCH ADAPTIVE SENDER                      ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");
  console.log(`  Day ${dayNum}  limit=${limit}  sent_today=${sentToday}  remaining=${remaining}`);

  if (STATUS_ONLY) {
    await pool.end();
    return;
  }

  if (remaining <= 0) {
    console.log("  Daily limit reached.");
    await pool.end();
    return;
  }

  const { rows: leads } = await pool.query(
    `SELECT l.id, l.brand_slug, l.business_name, l.email, l.category, l.state
       FROM leads l
      WHERE l.email IS NOT NULL
        AND l.email != ''
        AND l.status != 'unsubscribed'
        AND l.status != 'bounced'
        AND NOT EXISTS (
          SELECT 1 FROM email_sends es
          WHERE es.lead_id = l.id
            AND es.template = 'skynpatch_adaptive_v1'
        )
      ORDER BY l.id ASC
      LIMIT $1`,
    [remaining]
  );

  console.log(`  Leads queued: ${leads.length}${DRY_RUN ? " (dry-run)" : ""}\n`);

  let sent = 0;
  let failed = 0;

  for (const lead of leads) {
    const segment = toSegment(lead);

    // Await the async selectVariantCombo — returns { subject, hook, cta, image, offer, is_explore }
    const combo = typeof selectVariantCombo === "function"
      ? await selectVariantCombo(segment).catch(() => ({ subject: null, hook: null, cta: null, image: null, offer: null, is_explore: false }))
      : { subject: null, hook: null, cta: null, image: null, offer: null, is_explore: false };

    // Resolve variant IDs → content strings (same pattern as daily-send-scheduler.js)
    const content = typeof resolveVariantContent === "function"
      ? await resolveVariantContent(combo).catch(() => ({}))
      : {};

    const offerUrl = chooseOfferUrl(combo.offer);

    const vars = {
      store_name: lead.business_name || "your store",
      sales_sheet_url: SKYNPATCH_WHOLESALE_PAGE_URL,
      starter_qty: "50",
      checkout_url: offerUrl,
    };

    const subject = replaceVars(
      content.subject || `Wholesale opportunity for ${lead.business_name || "your store"}`,
      vars
    );
    const hook = replaceVars(content.hook || "", vars);
    const cta  = replaceVars(content.cta  || "", vars);

    const html = buildHtml(lead, {
      hook,
      cta,
      offerLabel: content.offer || "Wholesale bundle pricing available",
      offerUrl,
    });

    process.stdout.write(`  → ${String(lead.business_name || "(unknown)").slice(0, 32).padEnd(33)} ${String(lead.email).slice(0, 34).padEnd(35)}`);

    if (DRY_RUN) {
      process.stdout.write(` [DRY] ${subject.slice(0, 38)}\n`);
      sent++;
      continue;
    }

    try {
      // Atomic dedup guard: claim this lead slot before calling Maileroo.
      // ON CONFLICT DO NOTHING prevents duplicate sends even under concurrent runs.
      const dedup = await pool.query(
        `INSERT INTO email_sends (lead_id, brand_slug, to_email, to_name, subject, template, status, attempt_at)
         VALUES ($1,$2,$3,$4,$5,$6,'pending',NOW())
         ON CONFLICT (lead_id, template) DO NOTHING`,
        [lead.id, lead.brand_slug, lead.email, lead.business_name, subject, "skynpatch_adaptive_v1"]
      );
      if (dedup.rowCount === 0) {
        // Another process already claimed this lead — skip silently
        process.stdout.write(` ⟳ (already claimed)\n`);
        continue;
      }

      const result = await mailerooSend(lead.email, subject, html);
      if (result.status === 200 || result.status === 201) {
        // Correct Maileroo response path: body.data.message_id (with legacy fallbacks)
        const mailerooId = result.body?.data?.message_id
          || result.body?.data?.id
          || result.body?.id
          || result.body?.message_id
          || null;

        await pool.query(
          `UPDATE email_sends
              SET status='sent', sent_at=NOW(), maileroo_id=$2
            WHERE lead_id=$1 AND template='skynpatch_adaptive_v1'`,
          [lead.id, mailerooId]
        );

        await pool.query(
          `UPDATE leads SET status='emailed' WHERE id=$1 AND status='new'`,
          [lead.id]
        );

        if (typeof logSend === "function") {
          try { await logSend(lead.id, combo, segment); }
          catch (e) { console.warn(`[adaptive-sender] logSend failed for lead ${lead.id}: ${e.message}`); }
        }

        process.stdout.write(" ✓\n");
        sent++;
      } else {
        // Mark the pending row as failed so it can be retried next run
        await pool.query(
          `UPDATE email_sends SET status='failed' WHERE lead_id=$1 AND template='skynpatch_adaptive_v1'`,
          [lead.id]
        );
        // Delete the row so the dedup guard doesn't permanently block this lead on retry
        await pool.query(
          `DELETE FROM email_sends WHERE lead_id=$1 AND template='skynpatch_adaptive_v1' AND status='failed'`,
          [lead.id]
        );
        process.stdout.write(` ✗ HTTP ${result.status}\n`);
        failed++;
      }
    } catch (e) {
      process.stdout.write(` ✗ ${String(e.message || e).slice(0, 40)}\n`);
      // Clean up the pending row so the lead is retried next run
      try {
        await pool.query(
          `DELETE FROM email_sends WHERE lead_id=$1 AND template='skynpatch_adaptive_v1' AND status='pending'`,
          [lead.id]
        );
      } catch { /* noop */ }
      failed++;
    }
  }

  if (!DRY_RUN && sent > 0) {
    if (!state.firstSendDate) state.firstSendDate = today;
    state.daySends[today] = (state.daySends[today] || 0) + sent;
    state.totalSent = (state.totalSent || 0) + sent;
    saveState(state);
  }

  console.log(`\n  Sent=${sent}  Failed=${failed}`);
  console.log(`  Total sent ever=${(state.totalSent || 0) + (DRY_RUN ? 0 : sent)}\n`);

  await pool.end();
  if (experiment?.closePool) await experiment.closePool().catch(() => {});
}

main().catch(async (e) => {
  console.error(e);
  try { await pool.end(); } catch { /* noop */ }
  if (experiment?.closePool) await experiment.closePool().catch(() => {});
  process.exit(1);
});
