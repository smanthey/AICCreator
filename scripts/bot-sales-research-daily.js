#!/usr/bin/env node
"use strict";

require("dotenv").config({ override: true });

const fs = require("fs/promises");
const path = require("path");
const { Pool } = require("pg");
const { sendEmail } = require("../infra/send-email");

const ROOT = path.join(__dirname, "..");
const REPORT_DIR = path.join(ROOT, "reports");

function getPool() {
  return new Pool({
    host: process.env.POSTGRES_HOST || process.env.CLAW_DB_HOST,
    port: parseInt(process.env.POSTGRES_PORT || process.env.CLAW_DB_PORT || "15432", 10),
    user: process.env.POSTGRES_USER || process.env.CLAW_DB_USER || "claw",
    password: process.env.POSTGRES_PASSWORD || process.env.CLAW_DB_PASSWORD,
    database: process.env.POSTGRES_DB || process.env.CLAW_DB_NAME || "claw_architect",
    connectionTimeoutMillis: 5000,
  });
}

function asNumber(v) {
  return Number(v || 0);
}

function pick(rows, key) {
  return rows.find((r) => r.key === key)?.value || "0";
}

async function buildReport() {
  const pool = getPool();
  const now = new Date();
  const sinceHours = Math.max(1, Number(process.env.BOT_RESEARCH_WINDOW_HOURS || "24"));

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bot_outreach_attempts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bot_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      message_variant TEXT NOT NULL,
      message_content TEXT,
      status TEXT DEFAULT 'sent',
      metadata JSONB DEFAULT '{}'::jsonb,
      sent_at TIMESTAMPTZ DEFAULT NOW(),
      responded_at TIMESTAMPTZ,
      converted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  const totalsQ = await pool.query(
    `
    SELECT
      COUNT(*)::text AS attempts,
      COUNT(*) FILTER (WHERE status = 'sent')::text AS sent,
      COUNT(*) FILTER (WHERE status = 'rejected')::text AS rejected,
      COUNT(*) FILTER (WHERE status = 'responded')::text AS responded,
      COUNT(*) FILTER (WHERE status = 'converted')::text AS converted
    FROM bot_outreach_attempts
    WHERE sent_at >= NOW() - ($1 || ' hours')::interval
    `,
    [String(sinceHours)]
  );

  const byPlatformQ = await pool.query(
    `
    SELECT
      platform,
      COUNT(*)::int AS attempts,
      COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
      COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected,
      COUNT(*) FILTER (WHERE status = 'responded')::int AS responded,
      COUNT(*) FILTER (WHERE status = 'converted')::int AS converted
    FROM bot_outreach_attempts
    WHERE sent_at >= NOW() - ($1 || ' hours')::interval
    GROUP BY platform
    ORDER BY attempts DESC
    `,
    [String(sinceHours)]
  );

  const byVariantQ = await pool.query(
    `
    SELECT
      message_variant,
      COUNT(*)::int AS attempts,
      COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
      COUNT(*) FILTER (WHERE status = 'responded')::int AS responded,
      COUNT(*) FILTER (WHERE status = 'converted')::int AS converted,
      COUNT(*) FILTER (WHERE (metadata->>'payment_url_included')::boolean IS TRUE)::int AS with_payment_link
    FROM bot_outreach_attempts
    WHERE sent_at >= NOW() - ($1 || ' hours')::interval
    GROUP BY message_variant
    ORDER BY attempts DESC
    `,
    [String(sinceHours)]
  );

  const topErrorsQ = await pool.query(
    `
    SELECT
      COALESCE(metadata->>'error', 'unknown') AS error,
      COUNT(*)::int AS count
    FROM bot_outreach_attempts
    WHERE sent_at >= NOW() - ($1 || ' hours')::interval
      AND status = 'rejected'
    GROUP BY COALESCE(metadata->>'error', 'unknown')
    ORDER BY count DESC
    LIMIT 10
    `,
    [String(sinceHours)]
  );

  const suspiciousQ = await pool.query(
    `
    SELECT platform, bot_id, COALESCE(metadata->>'contact', '') AS contact_info, status, sent_at
    FROM bot_outreach_attempts
    WHERE sent_at >= NOW() - ($1 || ' hours')::interval
      AND (
        bot_id ~* '\\.(png|jpg|jpeg|gif|svg|webp)$'
        OR COALESCE(metadata->>'contact', '') ~* '\\.(png|jpg|jpeg|gif|svg|webp)$'
      )
    ORDER BY sent_at DESC
    LIMIT 20
    `,
    [String(sinceHours)]
  );

  const interestingQ = await pool.query(
    `
    SELECT
      platform,
      bot_id,
      status,
      COALESCE(metadata->>'response_excerpt', '') AS response_excerpt,
      sent_at,
      converted_at
    FROM bot_outreach_attempts
    WHERE sent_at >= NOW() - ($1 || ' hours')::interval
      AND (status IN ('responded', 'converted') OR COALESCE(metadata->>'response_excerpt', '') <> '')
    ORDER BY COALESCE(converted_at, sent_at) DESC
    LIMIT 25
    `,
    [String(sinceHours)]
  );

  const conversionsQ = await pool.query(
    `
    SELECT
      platform,
      COUNT(*)::int AS conversions,
      (COUNT(*) * COALESCE($2::numeric, 1))::numeric(10,2) AS revenue_usd
    FROM bot_outreach_attempts
    WHERE sent_at >= NOW() - ($1 || ' hours')::interval
      AND status = 'converted'
    GROUP BY platform
    ORDER BY conversions DESC
    `,
    [String(sinceHours), String(process.env.COMMERCE_PRICE_USD || "1")]
  );

  const totals = totalsQ.rows[0] || {
    attempts: "0",
    sent: "0",
    rejected: "0",
    responded: "0",
    converted: "0",
  };

  const attempts = asNumber(totals.attempts);
  const sent = asNumber(totals.sent);
  const rejected = asNumber(totals.rejected);
  const responded = asNumber(totals.responded);
  const converted = asNumber(totals.converted);
  const withPaymentLink = (byVariantQ.rows || []).reduce(
    (sum, row) => sum + asNumber(row.with_payment_link),
    0
  );

  const deliveryRate = attempts > 0 ? ((sent / attempts) * 100).toFixed(2) : "0.00";
  const responseRate = sent > 0 ? ((responded / sent) * 100).toFixed(2) : "0.00";
  const conversionRate = sent > 0 ? ((converted / sent) * 100).toFixed(2) : "0.00";
  const paymentLinkRate = sent > 0 ? ((withPaymentLink / sent) * 100).toFixed(2) : "0.00";

  const targets = {
    delivery_rate_pct: Number(process.env.MONETIZATION_TARGET_DELIVERY_RATE_PCT || "95"),
    response_rate_pct: Number(process.env.MONETIZATION_TARGET_RESPONSE_RATE_PCT || "3"),
    conversion_rate_pct: Number(process.env.MONETIZATION_TARGET_CONVERSION_RATE_PCT || "1"),
    payment_link_rate_pct: Number(process.env.MONETIZATION_TARGET_PAYMENT_LINK_RATE_PCT || "60"),
  };

  const current = {
    delivery_rate_pct: Number(deliveryRate),
    response_rate_pct: Number(responseRate),
    conversion_rate_pct: Number(conversionRate),
    payment_link_rate_pct: Number(paymentLinkRate),
  };

  const gaps = {
    delivery_rate_pct: Number((targets.delivery_rate_pct - current.delivery_rate_pct).toFixed(2)),
    response_rate_pct: Number((targets.response_rate_pct - current.response_rate_pct).toFixed(2)),
    conversion_rate_pct: Number((targets.conversion_rate_pct - current.conversion_rate_pct).toFixed(2)),
    payment_link_rate_pct: Number((targets.payment_link_rate_pct - current.payment_link_rate_pct).toFixed(2)),
  };

  const met = {
    delivery_rate_pct: current.delivery_rate_pct >= targets.delivery_rate_pct,
    response_rate_pct: current.response_rate_pct >= targets.response_rate_pct,
    conversion_rate_pct: current.conversion_rate_pct >= targets.conversion_rate_pct,
    payment_link_rate_pct: current.payment_link_rate_pct >= targets.payment_link_rate_pct,
  };

  const report = {
    generated_at: now.toISOString(),
    window_hours: sinceHours,
    summary: {
      attempts,
      sent,
      rejected,
      responded,
      converted,
      with_payment_link: withPaymentLink,
      delivery_rate_pct: Number(deliveryRate),
      response_rate_pct: Number(responseRate),
      conversion_rate_pct: Number(conversionRate),
      payment_link_rate_pct: Number(paymentLinkRate),
    },
    monetization_goals: {
      targets,
      current,
      gaps_to_target: gaps,
      met,
      all_met: Object.values(met).every(Boolean),
    },
    by_platform: byPlatformQ.rows,
    by_variant: byVariantQ.rows,
    top_errors: topErrorsQ.rows,
    suspicious_targets: suspiciousQ.rows,
    interesting_conversations_or_creations: interestingQ.rows,
    conversions: conversionsQ.rows,
  };

  await pool.end();
  return report;
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("# Bot-to-Bot Sales Research Daily");
  lines.push("");
  lines.push(`Generated: ${report.generated_at}`);
  lines.push(`Window: last ${report.window_hours}h`);
  lines.push("");
  lines.push("## Core Metrics");
  lines.push(`- Attempts: ${report.summary.attempts}`);
  lines.push(`- Sent: ${report.summary.sent}`);
  lines.push(`- Rejected: ${report.summary.rejected}`);
  lines.push(`- Responded: ${report.summary.responded}`);
  lines.push(`- Converted: ${report.summary.converted}`);
  lines.push(`- Delivery rate: ${report.summary.delivery_rate_pct}%`);
  lines.push(`- Response rate: ${report.summary.response_rate_pct}%`);
  lines.push(`- Conversion rate: ${report.summary.conversion_rate_pct}%`);
  lines.push(`- Payment-link rate: ${report.summary.payment_link_rate_pct}% (${report.summary.with_payment_link} with payment link)`);
  lines.push("");

  lines.push("## Monetization Goals");
  if (!report.monetization_goals) {
    lines.push("- No monetization goal object available.");
  } else {
    const mg = report.monetization_goals;
    lines.push(`- Delivery target: ${mg.targets.delivery_rate_pct}% (current ${mg.current.delivery_rate_pct}%, gap ${mg.gaps_to_target.delivery_rate_pct}%)`);
    lines.push(`- Response target: ${mg.targets.response_rate_pct}% (current ${mg.current.response_rate_pct}%, gap ${mg.gaps_to_target.response_rate_pct}%)`);
    lines.push(`- Conversion target: ${mg.targets.conversion_rate_pct}% (current ${mg.current.conversion_rate_pct}%, gap ${mg.gaps_to_target.conversion_rate_pct}%)`);
    lines.push(`- Payment-link target: ${mg.targets.payment_link_rate_pct}% (current ${mg.current.payment_link_rate_pct}%, gap ${mg.gaps_to_target.payment_link_rate_pct}%)`);
    lines.push(`- Goal status: ${mg.all_met ? "PASS" : "FAIL"}`);
  }
  lines.push("");

  lines.push("## A/B/C Variant Performance");
  if (!report.by_variant.length) {
    lines.push("- No outreach data in this window.");
  } else {
    for (const row of report.by_variant) {
      lines.push(
        `- Variant ${row.message_variant}: attempts=${row.attempts}, sent=${row.sent}, responded=${row.responded}, converted=${row.converted}, with_payment_link=${row.with_payment_link}`
      );
    }
  }
  lines.push("");

  lines.push("## Platform Performance");
  if (!report.by_platform.length) {
    lines.push("- No platform data in this window.");
  } else {
    for (const row of report.by_platform) {
      lines.push(
        `- ${row.platform}: attempts=${row.attempts}, sent=${row.sent}, rejected=${row.rejected}, responded=${row.responded}, converted=${row.converted}`
      );
    }
  }
  lines.push("");

  lines.push("## Outliers");
  if (!report.top_errors.length && !report.suspicious_targets.length) {
    lines.push("- No major outliers detected.");
  } else {
    if (report.top_errors.length) {
      lines.push("- Top rejection errors:");
      for (const err of report.top_errors) {
        lines.push(`  - ${err.count}x ${err.error}`);
      }
    }
    if (report.suspicious_targets.length) {
      lines.push("- Suspicious targets (likely non-contact artifacts):");
      for (const row of report.suspicious_targets.slice(0, 10)) {
        lines.push(`  - ${row.platform} ${row.bot_id} (${row.contact_info || "n/a"})`);
      }
    }
  }
  lines.push("");

  lines.push("## Interesting Conversations / Creations");
  if (!report.interesting_conversations_or_creations.length) {
    lines.push("- No responded/converted conversation excerpts captured in this window.");
  } else {
    for (const row of report.interesting_conversations_or_creations.slice(0, 15)) {
      const excerpt = (row.response_excerpt || "").replace(/\s+/g, " ").trim();
      lines.push(`- ${row.platform} ${row.bot_id} [${row.status}] ${excerpt ? `— ${excerpt}` : ""}`);
    }
  }
  lines.push("");

  lines.push("## Conversion Revenue");
  if (!report.conversions.length) {
    lines.push("- No conversions in this window.");
  } else {
    for (const row of report.conversions) {
      lines.push(`- ${row.platform}: conversions=${row.conversions}, revenue=$${row.revenue_usd}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

async function maybeSendEmail(markdown, report) {
  const to = String(process.env.BOT_RESEARCH_DAILY_EMAIL_TO || "").trim();
  if (!to) return { emailed: false };

  const subject = `Bot Sales Daily: ${report.summary.converted} conversions, ${report.summary.sent} sends`;
  const html = `<pre style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; white-space: pre-wrap;">${markdown
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")}</pre>`;

  const result = await sendEmail({
    to,
    subject,
    html,
    fromName: process.env.MAILEROO_FROM_NAME || "OpenClaw Research",
    fromEmail: process.env.MAILEROO_FROM_EMAIL || "hello@openclaw.io",
    provider: process.env.BOT_RESEARCH_EMAIL_PROVIDER || undefined,
  });

  return { emailed: true, email_result: result };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const report = await buildReport();
  const markdown = renderMarkdown(report);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join(REPORT_DIR, `${stamp}-bot-sales-research-daily.json`);
  const mdPath = path.join(REPORT_DIR, `${stamp}-bot-sales-research-daily.md`);
  const latestJson = path.join(REPORT_DIR, "bot-sales-research-daily-latest.json");
  const latestMd = path.join(REPORT_DIR, "bot-sales-research-daily-latest.md");

  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(mdPath, markdown);
  await fs.writeFile(latestJson, `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(latestMd, markdown);

  let email = { emailed: false };
  try {
    email = await maybeSendEmail(markdown, report);
  } catch (err) {
    email = { emailed: false, error: err.message };
  }

  console.log(JSON.stringify({ ok: true, jsonPath, mdPath, latestJson, latestMd, email }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
    process.exit(1);
  });
}

module.exports = { buildReport, renderMarkdown };
