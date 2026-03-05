#!/usr/bin/env node
"use strict";

require("dotenv").config();

const { spawnSync } = require("child_process");
const pg = require("../infra/postgres");

const args = process.argv.slice(2);
const hasFlag = (f) => args.includes(f);
const getArg = (f, d = null) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : d;
};

const BRAND = getArg("--brand", "skynpatch");
const DAYS = Math.max(1, Number(getArg("--days", "30")) || 30);
const STRICT = hasFlag("--strict");
const REPLAY = hasFlag("--replay");

function run(cmd, argv = []) {
  const r = spawnSync(cmd, argv, { stdio: "pipe", encoding: "utf8", env: process.env });
  return {
    ok: Number(r.status || 0) === 0,
    code: Number(r.status || 0),
    out: (r.stdout || "").trim(),
    err: (r.stderr || "").trim(),
  };
}

async function loadStats() {
  const { rows } = await pg.query(
    `WITH sends AS (
       SELECT *
       FROM email_sends
       WHERE brand_slug = $1
         AND sent_at >= NOW() - ($2::text || ' days')::interval
     ),
     orders_window AS (
       SELECT *
       FROM orders
       WHERE created_at >= NOW() - ($2::text || ' days')::interval
     ),
     webhook_events AS (
       SELECT event_type, COUNT(*)::int AS n
       FROM loyalty_webhook_events
       WHERE received_at >= NOW() - ($2::text || ' days')::interval
       GROUP BY event_type
     )
     SELECT
       (SELECT COUNT(*)::int FROM sends) AS sends,
       (SELECT COUNT(*)::int FROM sends WHERE status='sent') AS sends_marked_sent,
       (SELECT COUNT(*)::int FROM sends WHERE delivered_at IS NOT NULL OR status='delivered') AS delivered,
       (SELECT COUNT(*)::int FROM sends WHERE opened_at IS NOT NULL) AS opened,
       (SELECT COUNT(*)::int FROM sends WHERE clicked_at IS NOT NULL) AS clicked,
       (SELECT COUNT(*)::int FROM orders_window) AS orders,
       COALESCE((SELECT SUM(n)::int FROM webhook_events), 0) AS webhook_events_total`,
    [BRAND, String(DAYS)]
  );
  return rows[0] || {};
}

function n(v) {
  return Number(v || 0);
}

async function main() {
  const checks = [];

  const webhookUp = run("curl", ["-sf", "http://127.0.0.1:4040/api/webhook/maileroo"]);
  checks.push({
    name: "webhook_server_health",
    ok: webhookUp.ok,
    detail: webhookUp.ok ? "ok" : `curl_exit=${webhookUp.code}`,
  });

  if (REPLAY) {
    const replay = run("node", ["scripts/sales-webhook-replay.js", "--brand", BRAND, "--limit", "5"]);
    checks.push({
      name: "webhook_replay",
      ok: replay.ok,
      detail: replay.ok ? "ok" : replay.err.slice(-240),
    });
  }

  const stats = await loadStats();
  const sends = n(stats.sends);
  const sent = n(stats.sends_marked_sent);
  const delivered = n(stats.delivered);
  const opened = n(stats.opened);
  const clicked = n(stats.clicked);
  const orders = n(stats.orders);
  const webhookEvents = n(stats.webhook_events_total);

  checks.push({ name: "sends_exist", ok: sends > 0, detail: `sends=${sends}` });
  checks.push({ name: "sent_ratio", ok: sends === 0 ? false : sent / sends >= 0.70, detail: `sent=${sent}/${sends}` });
  checks.push({ name: "delivery_signal", ok: delivered > 0 || webhookEvents > 0, detail: `delivered=${delivered} webhook_events=${webhookEvents}` });
  checks.push({ name: "engagement_signal", ok: opened > 0 || clicked > 0 || sends < 10, detail: `opened=${opened} clicked=${clicked} sends=${sends}` });
  checks.push({ name: "orders_tracked", ok: orders >= 0, detail: `orders=${orders}` });

  const failed = checks.filter((c) => !c.ok);

  console.log("\n=== Sales Production Validate ===\n");
  console.log(`brand: ${BRAND}`);
  console.log(`window_days: ${DAYS}`);
  for (const c of checks) {
    console.log(`- ${c.name}: ${c.ok ? "PASS" : "FAIL"} (${c.detail})`);
  }

  if (STRICT && failed.length > 0) {
    process.exitCode = 2;
  }
}

main()
  .then(async () => { await pg.end(); })
  .catch(async (err) => {
    console.error("Fatal:", err.message);
    try { await pg.end(); } catch {}
    process.exit(1);
  });
