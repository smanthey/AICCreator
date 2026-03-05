"use strict";

require("dotenv").config();
const pg = require("../infra/postgres");
const { routingStats } = require("../infra/model-router");

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function run() {
  const where = "created_at >= date_trunc('day', timezone('UTC', now()))";

  const totals = await pg.query(
    `SELECT
       COUNT(*)::int AS total_calls,
       COUNT(*) FILTER (WHERE routing_outcome='success')::int AS success_calls,
       COUNT(*) FILTER (WHERE routing_outcome='error')::int AS error_calls,
       COUNT(*) FILTER (WHERE routing_outcome='low_confidence')::int AS low_confidence_count,
       COUNT(*) FILTER (WHERE escalation_reason IS NOT NULL)::int AS fallback_invoked,
       COUNT(*) FILTER (WHERE escalation_reason='budget_blocked' OR routing_outcome='budget_blocked')::int AS budget_blocked
     FROM model_usage
     WHERE ${where}`
  );

  const fallbackReasons = await pg.query(
    `SELECT escalation_reason, COUNT(*)::int AS n
     FROM model_usage
     WHERE ${where}
       AND escalation_reason IS NOT NULL
     GROUP BY escalation_reason
     ORDER BY n DESC`
  );

  const providerErrorRates = await pg.query(
    `SELECT
       provider,
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE routing_outcome='error')::int AS errors,
       CASE WHEN COUNT(*) = 0 THEN 0
            ELSE ROUND((COUNT(*) FILTER (WHERE routing_outcome='error')::numeric / COUNT(*)::numeric), 4)
       END AS error_rate
     FROM model_usage
     WHERE ${where}
     GROUP BY provider
     ORDER BY error_rate DESC, total DESC`
  );

  const primarySelected = await pg.query(
    `SELECT COUNT(*)::int AS n
     FROM model_usage
     WHERE ${where}
       AND routing_outcome='success'
       AND escalation_reason IS NULL`
  );

  const summary = totals.rows[0] || {};
  const primary = num(primarySelected.rows?.[0]?.n);
  const routerMem = routingStats();

  console.log("\n=== Model Routing Stats (today UTC) ===\n");
  console.table([
    {
      routing_primary_selected: primary,
      routing_fallback_invoked: num(summary.fallback_invoked),
      routing_budget_blocked: num(summary.budget_blocked),
      routing_low_confidence_count: num(summary.low_confidence_count),
      total_calls: num(summary.total_calls),
      success_calls: num(summary.success_calls),
      error_calls: num(summary.error_calls),
    },
  ]);

  console.log("\nFallback reason breakdown:");
  console.table(
    (fallbackReasons.rows || []).map((r) => ({
      routing_fallback_reason: r.escalation_reason,
      count: num(r.n),
    }))
  );

  console.log("\nProvider error rates:");
  console.table(
    (providerErrorRates.rows || []).map((r) => ({
      provider: r.provider,
      total: num(r.total),
      errors: num(r.errors),
      routing_provider_error_rate: Number(r.error_rate || 0),
    }))
  );

  console.log("\nIn-memory router counters:");
  console.log(JSON.stringify(routerMem.routing, null, 2));
  console.log("\nBudgets / flags:");
  console.log(JSON.stringify({ limits: routerMem.limits, flags: routerMem.flags }, null, 2));
}

run()
  .then(async () => { await pg.end(); process.exit(0); })
  .catch(async (err) => {
    console.error(err.message || String(err));
    try { await pg.end(); } catch (_) {}
    process.exit(1);
  });
