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
const DAYS = Math.max(1, Number(getArg("--days", "30")) || 30);
const STRICT = args.includes("--strict");

async function main() {
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
     attributed AS (
       SELECT o.id AS order_id, o.buyer_email, s.id AS send_id,
              s.sent_at, s.opened_at, s.clicked_at,
              ROW_NUMBER() OVER (PARTITION BY o.id ORDER BY s.sent_at DESC NULLS LAST) AS rn
       FROM orders_window o
       LEFT JOIN sends s
         ON LOWER(s.to_email) = LOWER(o.buyer_email)
        AND s.sent_at <= o.created_at
     )
     SELECT
       (SELECT COUNT(*)::int FROM sends) AS sends,
       (SELECT COUNT(*)::int FROM sends WHERE delivered_at IS NOT NULL OR status='delivered') AS delivered,
       (SELECT COUNT(*)::int FROM sends WHERE opened_at IS NOT NULL) AS opened,
       (SELECT COUNT(*)::int FROM sends WHERE clicked_at IS NOT NULL) AS clicked,
       (SELECT COUNT(*)::int FROM orders_window) AS orders,
       (SELECT COUNT(*)::int FROM attributed WHERE rn=1 AND send_id IS NOT NULL) AS orders_attributed,
       (SELECT COUNT(*)::int FROM attributed WHERE rn=1 AND send_id IS NULL) AS orders_unattributed,
       (SELECT COUNT(*)::int FROM attributed WHERE rn=1 AND send_id IS NOT NULL AND clicked_at IS NOT NULL) AS orders_last_touch_clicked
    `,
    [BRAND, String(DAYS)]
  );

  const r = rows[0] || {};
  const n = (k) => Number(r[k] || 0);
  const pct = (a, b) => (b > 0 ? ((a / b) * 100).toFixed(1) : "0.0");

  console.log("\n=== Sales Attribution QA ===\n");
  console.log(`brand: ${BRAND}`);
  console.log(`window_days: ${DAYS}`);
  console.log(`sends: ${n("sends")}`);
  console.log(`delivered: ${n("delivered")} (${pct(n("delivered"), n("sends"))}%)`);
  console.log(`opened: ${n("opened")} (${pct(n("opened"), n("delivered"))}% of delivered)`);
  console.log(`clicked: ${n("clicked")} (${pct(n("clicked"), n("opened"))}% of opened)`);
  console.log(`orders: ${n("orders")}`);
  console.log(`orders_attributed: ${n("orders_attributed")} (${pct(n("orders_attributed"), n("orders"))}% of orders)`);
  console.log(`orders_unattributed: ${n("orders_unattributed")}`);
  console.log(`orders_last_touch_clicked: ${n("orders_last_touch_clicked")} (${pct(n("orders_last_touch_clicked"), n("orders_attributed"))}% of attributed)`);

  const lowCoverage = n("orders") > 0 && n("orders_attributed") / n("orders") < 0.4;
  if (lowCoverage) {
    console.error("WARN: attribution coverage below 40% in selected window.");
    if (STRICT) process.exitCode = 2;
  }
}

main()
  .then(async () => { await pg.end(); })
  .catch(async (err) => {
    console.error("Fatal:", err.message);
    try { await pg.end(); } catch {}
    process.exit(1);
  });
