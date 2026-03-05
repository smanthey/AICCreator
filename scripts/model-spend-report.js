"use strict";

require("dotenv").config();
const pg = require("../infra/postgres");

function money(v) {
  return `$${Number(v || 0).toFixed(6)}`;
}

async function run() {
  const dayArg = process.argv.find((a) => a.startsWith("--day="));
  const utcDay = dayArg ? dayArg.split("=")[1] : null; // YYYY-MM-DD

  // UTC day boundary (not DB-local timezone)
  let whereSql = "created_at >= (date_trunc('day', timezone('UTC', now())) AT TIME ZONE 'UTC')";
  let params = [];

  if (utcDay) {
    whereSql = "created_at >= (($1::date)::timestamp AT TIME ZONE 'UTC') AND created_at < ((($1::date + interval '1 day')::timestamp) AT TIME ZONE 'UTC')";
    params = [utcDay];
  }

  const totalQ = await pg.query(
    `SELECT
       COUNT(*)::int AS calls,
       COALESCE(SUM(tokens_in), 0)::bigint AS tokens_in,
       COALESCE(SUM(tokens_out), 0)::bigint AS tokens_out,
       COALESCE(SUM(cost_usd), 0)::numeric AS cost_usd
     FROM model_usage
     WHERE ${whereSql}`,
    params
  );

  const providerQ = await pg.query(
    `SELECT
       provider,
       COUNT(*)::int AS calls,
       COALESCE(SUM(tokens_in), 0)::bigint AS tokens_in,
       COALESCE(SUM(tokens_out), 0)::bigint AS tokens_out,
       COALESCE(SUM(cost_usd), 0)::numeric AS cost_usd
     FROM model_usage
     WHERE ${whereSql}
     GROUP BY provider
     ORDER BY cost_usd DESC, calls DESC`,
    params
  );

  const modelQ = await pg.query(
    `SELECT
       model_key,
       provider,
       COUNT(*)::int AS calls,
       COALESCE(SUM(tokens_in), 0)::bigint AS tokens_in,
       COALESCE(SUM(tokens_out), 0)::bigint AS tokens_out,
       COALESCE(SUM(cost_usd), 0)::numeric AS cost_usd
     FROM model_usage
     WHERE ${whereSql}
     GROUP BY model_key, provider
     ORDER BY cost_usd DESC, calls DESC
     LIMIT 25`,
    params
  );

  const taskQ = await pg.query(
    `SELECT
       task_type,
       COUNT(*)::int AS calls,
       COALESCE(SUM(tokens_in), 0)::bigint AS tokens_in,
       COALESCE(SUM(tokens_out), 0)::bigint AS tokens_out,
       COALESCE(SUM(cost_usd), 0)::numeric AS cost_usd
     FROM model_usage
     WHERE ${whereSql}
     GROUP BY task_type
     ORDER BY cost_usd DESC, calls DESC
     LIMIT 50`,
    params
  );

  const summary = totalQ.rows[0] || { calls: 0, tokens_in: 0, tokens_out: 0, cost_usd: 0 };
  const label = utcDay ? `${utcDay} UTC` : "today (UTC)";

  console.log(`\n=== Model Spend Report: ${label} ===\n`);
  console.log("Summary:");
  console.table([{
    calls: Number(summary.calls || 0),
    tokens_in: Number(summary.tokens_in || 0),
    tokens_out: Number(summary.tokens_out || 0),
    cost_usd: money(summary.cost_usd),
  }]);

  console.log("\nBy provider:");
  console.table((providerQ.rows || []).map((r) => ({
    provider: r.provider,
    calls: Number(r.calls || 0),
    tokens_in: Number(r.tokens_in || 0),
    tokens_out: Number(r.tokens_out || 0),
    cost_usd: money(r.cost_usd),
  })));

  console.log("\nTop models:");
  console.table((modelQ.rows || []).map((r) => ({
    model_key: r.model_key,
    provider: r.provider,
    calls: Number(r.calls || 0),
    tokens_in: Number(r.tokens_in || 0),
    tokens_out: Number(r.tokens_out || 0),
    cost_usd: money(r.cost_usd),
  })));

  console.log("\nBy task type:");
  console.table((taskQ.rows || []).map((r) => ({
    task_type: r.task_type,
    calls: Number(r.calls || 0),
    tokens_in: Number(r.tokens_in || 0),
    tokens_out: Number(r.tokens_out || 0),
    cost_usd: money(r.cost_usd),
  })));
}

run()
  .then(async () => { await pg.end(); process.exit(0); })
  .catch(async (err) => {
    console.error(err.message || String(err));
    try { await pg.end(); } catch (_) {}
    process.exit(1);
  });
