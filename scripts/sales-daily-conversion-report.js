#!/usr/bin/env node
"use strict";

require("dotenv").config();

const pg = require("../infra/postgres");

const args = process.argv.slice(2);
const getArg = (flag, fallback = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};

const BRAND = getArg("--brand", "skynpatch");
const DAYS = Math.max(1, Number(getArg("--days", "1")) || 1);

async function main() {
  const { rows } = await pg.query(
    `WITH sends AS (
       SELECT *
       FROM email_sends
       WHERE brand_slug = $1
         AND sent_at >= NOW() - ($2::text || ' days')::interval
     ),
     stats AS (
       SELECT
         COUNT(*)::int AS sends,
         COUNT(*) FILTER (WHERE status='delivered' OR delivered_at IS NOT NULL)::int AS delivered,
         COUNT(*) FILTER (WHERE opened_at IS NOT NULL)::int AS opened,
         COUNT(*) FILTER (WHERE clicked_at IS NOT NULL)::int AS clicked,
         COUNT(*) FILTER (WHERE status='bounced')::int AS bounced,
         COUNT(*) FILTER (WHERE status='complaint')::int AS complaints,
         COUNT(*) FILTER (WHERE status='unsubscribed')::int AS unsubscribed
       FROM sends
     ),
     orders_window AS (
       SELECT COUNT(*)::int AS orders
       FROM orders
       WHERE created_at >= NOW() - ($2::text || ' days')::interval
     )
     SELECT
       s.sends, s.delivered, s.opened, s.clicked, s.bounced, s.complaints, s.unsubscribed,
       o.orders
     FROM stats s
     CROSS JOIN orders_window o`,
    [BRAND, String(DAYS)]
  );
  const r = rows[0] || {};
  const n = (k) => Number(r[k] || 0);
  const pct = (a, b) => (b > 0 ? ((a / b) * 100).toFixed(1) : "0.0");

  console.log("\n=== Sales Daily Conversion Report ===\n");
  console.log(`brand: ${BRAND}`);
  console.log(`window_days: ${DAYS}`);
  console.log(`sends: ${n("sends")}`);
  console.log(`delivered: ${n("delivered")} (${pct(n("delivered"), n("sends"))}%)`);
  console.log(`opened: ${n("opened")} (${pct(n("opened"), n("delivered"))}% of delivered)`);
  console.log(`clicked: ${n("clicked")} (${pct(n("clicked"), n("opened"))}% of opened)`);
  console.log(`bounced: ${n("bounced")} (${pct(n("bounced"), n("sends"))}%)`);
  console.log(`complaints: ${n("complaints")} (${pct(n("complaints"), n("sends"))}%)`);
  console.log(`unsubscribed: ${n("unsubscribed")} (${pct(n("unsubscribed"), n("sends"))}%)`);
  console.log(`orders: ${n("orders")}`);
  console.log(`send_to_order: ${pct(n("orders"), n("sends"))}%`);
}

main()
  .then(async () => { await pg.end(); })
  .catch(async (err) => {
    console.error("Fatal:", err.message);
    try { await pg.end(); } catch {}
    process.exit(1);
  });

