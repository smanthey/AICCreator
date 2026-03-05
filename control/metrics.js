// control/metrics.js
// Operational metrics via SQL — no Prometheus needed.
//
// Usage:
//   const metrics = require("./metrics");
//   const snapshot = await metrics.snapshot();
//   console.log(snapshot);

const pg = require("../infra/postgres");

/**
 * Returns a full metrics snapshot: queue depth, retry rate,
 * dead-letter rate, average durations, cost aggregates.
 */
async function snapshot() {
  const { rows } = await pg.query(`
    SELECT

      -- Queue depth
      COUNT(*) FILTER (WHERE status = 'CREATED')     AS queued,
      COUNT(*) FILTER (WHERE status = 'RUNNING')     AS running,
      COUNT(*) FILTER (WHERE status = 'DISPATCHED')  AS dispatched,
      COUNT(*) FILTER (WHERE status = 'RETRY')       AS retrying,
      COUNT(*) FILTER (WHERE status = 'PENDING')     AS pending,

      -- Outcomes (last 24h)
      COUNT(*) FILTER (WHERE status = 'COMPLETED'
        AND completed_at > NOW() - INTERVAL '24 hours')   AS completed_24h,
      COUNT(*) FILTER (WHERE status = 'DEAD_LETTER'
        AND dead_lettered_at > NOW() - INTERVAL '24 hours') AS dead_letters_24h,
      COUNT(*) FILTER (WHERE retry_count > 0
        AND completed_at > NOW() - INTERVAL '24 hours')   AS retried_24h,

      -- Performance
      ROUND(AVG(duration_ms) FILTER (WHERE status = 'COMPLETED'
        AND completed_at > NOW() - INTERVAL '24 hours'))   AS avg_duration_ms,
      ROUND(MAX(duration_ms) FILTER (WHERE status = 'COMPLETED'
        AND completed_at > NOW() - INTERVAL '24 hours'))   AS max_duration_ms,

      -- Cost
      COALESCE(SUM(cost_usd) FILTER (
        WHERE completed_at > NOW() - INTERVAL '24 hours'), 0) AS cost_24h_usd,
      COALESCE(SUM(cost_usd), 0)                             AS cost_total_usd

    FROM tasks
  `);

  const m = rows[0];

  // Dead-letter rate (last 24h)
  const total24h = Number(m.completed_24h) + Number(m.dead_letters_24h);
  const dlRate   = total24h > 0
    ? ((Number(m.dead_letters_24h) / total24h) * 100).toFixed(1)
    : "0.0";

  return {
    queue: {
      queued:     Number(m.queued),
      running:    Number(m.running),
      dispatched: Number(m.dispatched),
      retrying:   Number(m.retrying),
      pending:    Number(m.pending)
    },
    last24h: {
      completed:    Number(m.completed_24h),
      dead_letters: Number(m.dead_letters_24h),
      retried:      Number(m.retried_24h),
      dead_letter_rate_pct: Number(dlRate)
    },
    performance: {
      avg_duration_ms: Number(m.avg_duration_ms) || 0,
      max_duration_ms: Number(m.max_duration_ms) || 0
    },
    cost: {
      last_24h_usd: Number(m.cost_24h_usd).toFixed(4),
      total_usd:    Number(m.cost_total_usd).toFixed(4)
    }
  };
}

/**
 * Per-task-type performance breakdown (last 24h).
 */
async function byType() {
  const { rows } = await pg.query(`
    SELECT
      type,
      COUNT(*) FILTER (WHERE status = 'COMPLETED')   AS completed,
      COUNT(*) FILTER (WHERE status = 'DEAD_LETTER') AS dead_letters,
      ROUND(AVG(duration_ms) FILTER (WHERE status = 'COMPLETED')) AS avg_ms,
      COALESCE(SUM(cost_usd), 0) AS cost_usd
    FROM tasks
    WHERE created_at > NOW() - INTERVAL '24 hours'
    GROUP BY type
    ORDER BY completed DESC
  `);

  return rows.map(r => ({
    type:         r.type,
    completed:    Number(r.completed),
    dead_letters: Number(r.dead_letters),
    avg_ms:       Number(r.avg_ms) || 0,
    cost_usd:     Number(r.cost_usd).toFixed(4)
  }));
}

/**
 * Print a human-readable metrics report to stdout.
 */
async function printReport() {
  const s = await snapshot();
  const t = await byType();

  console.log(`
╔══════════════════════════════════════════════╗
║           ClawdBot Metrics Snapshot          ║
╚══════════════════════════════════════════════╝

Queue:
  Queued:      ${s.queue.queued}
  Running:     ${s.queue.running}
  Dispatched:  ${s.queue.dispatched}
  Retrying:    ${s.queue.retrying}
  Pending:     ${s.queue.pending}

Last 24h:
  Completed:       ${s.last24h.completed}
  Dead Letters:    ${s.last24h.dead_letters}
  Retried:         ${s.last24h.retried}
  Dead Letter Rate: ${s.last24h.dead_letter_rate_pct}%

Performance:
  Avg Duration:  ${s.performance.avg_duration_ms}ms
  Max Duration:  ${s.performance.max_duration_ms}ms

Cost:
  Last 24h:  $${s.cost.last_24h_usd}
  Total:     $${s.cost.total_usd}
`);

  if (t.length) {
    console.log("By Task Type (last 24h):");
    console.log("  Type         | Done | Dead | Avg ms | Cost USD");
    console.log("  " + "─".repeat(52));
    for (const r of t) {
      console.log(
        `  ${r.type.padEnd(12)} | ${String(r.completed).padEnd(4)} | ${String(r.dead_letters).padEnd(4)} | ${String(r.avg_ms).padEnd(6)} | $${r.cost_usd}`
      );
    }
  }
}

module.exports = { snapshot, byType, printReport };
