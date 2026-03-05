#!/usr/bin/env node
/**
 * experiment-engine.js
 * ─────────────────────────────────────────────────────────────────────────
 * Self-optimizing outbound engine — multi-armed bandit variant allocation.
 *
 * Core philosophy:
 *   PRIMARY KPI = Revenue (USD) per 100 sends. Not opens, not clicks, not replies.
 *   Every email sent is a data point. The system reallocates volume to winners.
 *
 * Variant components tested independently:
 *   subject | hook | cta | image | offer
 *
 * Architecture:
 *   80% exploitation (weighted toward top revenue performers)
 *   20% exploration  (deliberately routes traffic to least-tested variants)
 *   Daily weight update: reward = revenue_cents/sends × 100 → adjust weights
 *   Kill switch: pause variants below 50% of baseline after ≥500 sends
 *   Segment-aware: per-region / per-store-type performance tracked separately
 *
 * Usage:
 *   node scripts/experiment-engine.js --select [--segment=TYPE]
 *   node scripts/experiment-engine.js --update
 *   node scripts/experiment-engine.js --kill-losers
 *   node scripts/experiment-engine.js --stats
 *   node scripts/experiment-engine.js --stats-segment
 *   node scripts/experiment-engine.js --run-all    ← daily cron job
 */
"use strict";

const path    = require("path");
const { Pool } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

// ── DB pool ────────────────────────────────────────────────────────────────
// Reuse infra/postgres.js pattern but inline here so this module is self-contained
const pool = new Pool({
  host:     process.env.POSTGRES_HOST     || process.env.CLAW_DB_HOST || "192.168.1.164",
  port:     parseInt(process.env.POSTGRES_PORT || process.env.CLAW_DB_PORT || "15432"),
  user:     process.env.POSTGRES_USER     || process.env.CLAW_DB_USER || "claw",
  password: process.env.POSTGRES_PASSWORD || process.env.CLAW_DB_PASSWORD,
  database: process.env.POSTGRES_DB       || process.env.CLAW_DB_NAME || "claw_architect",
  max: 5,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 5000,
});

// ── Constants ──────────────────────────────────────────────────────────────
const EXPLORE_RATE       = 0.20;   // 20% exploration, 80% exploitation
const MIN_SENDS_TO_JUDGE = 500;    // don't kill before 500 sends
const KILL_THRESHOLD     = 0.50;   // kill if reward < 50% of component baseline
const WEIGHT_SCALE       = 2.0;    // aggressiveness of weight shift
const COMPONENTS         = ["subject", "hook", "cta", "image", "offer"];

// ── ANSI ───────────────────────────────────────────────────────────────────
const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", green: "\x1b[32m", yellow: "\x1b[33m",
  red: "\x1b[31m",  cyan: "\x1b[36m", dim: "\x1b[2m",   blue: "\x1b[34m",
};

// ── Helpers ────────────────────────────────────────────────────────────────

async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

async function getActiveVariants(component) {
  const res = await query(
    `SELECT v.*, COALESCE(s.sends,0)::int AS sends,
            COALESCE(s.revenue_cents,0)::bigint AS revenue_cents,
            COALESCE(s.orders,0)::int AS orders,
            COALESCE(s.opens,0)::int AS opens,
            COALESCE(s.clicks,0)::int AS clicks,
            COALESCE(s.replies,0)::int AS replies
     FROM email_variants v
     LEFT JOIN variant_stats s ON s.variant_id = v.id
     WHERE v.component = $1 AND v.active = TRUE
     ORDER BY v.weight DESC`,
    [component]
  );
  return res.rows;
}

// ── Weighted random choice ─────────────────────────────────────────────────

function weightedChoice(variants) {
  if (!variants.length) return null;
  if (variants.length === 1) return variants[0];
  const total = variants.reduce((s, v) => s + parseFloat(v.weight || 1), 0);
  let rand = Math.random() * total;
  for (const v of variants) {
    rand -= parseFloat(v.weight || 1);
    if (rand <= 0) return v;
  }
  return variants[variants.length - 1];
}

// ── Select variant combo ───────────────────────────────────────────────────

/**
 * Select one variant per component for a single email send.
 * Returns: { subject: id, hook: id, cta: id, image: id, offer: id, is_explore: bool }
 */
async function selectVariantCombo(segment = null) {
  const isExplore = Math.random() < EXPLORE_RATE;
  const combo = { is_explore: isExplore };

  for (const component of COMPONENTS) {
    const variants = await getActiveVariants(component);
    if (!variants.length) { combo[component] = null; continue; }

    let chosen;
    if (isExplore) {
      // Prefer variants with fewer sends
      const sorted = [...variants].sort((a, b) => (a.sends || 0) - (b.sends || 0));
      const pool2  = sorted.slice(0, Math.ceil(variants.length * 0.5));
      chosen = pool2[Math.floor(Math.random() * pool2.length)];
    } else {
      chosen = weightedChoice(variants);
    }
    combo[component] = chosen ? chosen.id : null;
  }

  return combo;
}

// ── Reward score ───────────────────────────────────────────────────────────

function rewardScore(sends, revenue_cents) {
  if (!sends || sends < 10) return null;
  return (revenue_cents / 100) / sends * 100; // $ per 100 sends
}

// ── Weight update (daily cron) ─────────────────────────────────────────────

async function updateWeights() {
  console.log(`\n${C.bold}${C.cyan}⚙️  Updating variant weights...${C.reset}\n`);

  for (const component of COMPONENTS) {
    const { rows } = await query(
      `SELECT v.id, v.label, v.weight::float AS weight, v.active,
              COALESCE(s.sends,0)::int AS sends,
              COALESCE(s.revenue_cents,0)::bigint AS revenue_cents
       FROM email_variants v
       LEFT JOIN variant_stats s ON s.variant_id = v.id
       WHERE v.component = $1`,
      [component]
    );

    const judgeables = rows.filter(v => v.sends >= 50);
    if (!judgeables.length) {
      console.log(`  ${C.dim}${component.padEnd(10)}: not enough data (need ≥50 sends)${C.reset}`);
      continue;
    }

    const scores = judgeables.map(v => ({ ...v, reward: rewardScore(v.sends, v.revenue_cents) }))
      .filter(v => v.reward !== null);
    if (!scores.length) continue;

    const baseline = scores.reduce((s, v) => s + v.reward, 0) / scores.length;
    console.log(`  ${C.bold}${component}${C.reset} — baseline $${baseline.toFixed(2)}/100 sends`);

    for (const v of scores) {
      const ratio     = baseline > 0 ? v.reward / baseline : 1.0;
      const newWeight = Math.max(0.1, Math.min(5.0, 1.0 + (ratio - 1.0) * WEIGHT_SCALE));
      if (Math.abs(newWeight - v.weight) < 0.05) {
        console.log(`    ${C.dim}  ${v.label.padEnd(32)} $${v.reward.toFixed(2)}/100 weight=${newWeight.toFixed(2)} (unchanged)${C.reset}`);
        continue;
      }
      await query(`UPDATE email_variants SET weight = $1 WHERE id = $2`, [newWeight, v.id]);
      await query(
        `INSERT INTO experiment_log (action, variant_id, old_weight, new_weight, reason, reward_score)
         VALUES ('weight_update', $1, $2, $3, $4, $5)`,
        [v.id, v.weight, newWeight, `ratio=${ratio.toFixed(3)}`, v.reward]
      );
      const arrow = newWeight > v.weight ? `${C.green}↑${C.reset}` : `${C.red}↓${C.reset}`;
      console.log(`    ${arrow} ${v.label.padEnd(32)} $${v.reward.toFixed(2)}/100 → w${v.weight.toFixed(2)}→${newWeight.toFixed(2)}`);
    }
  }
  console.log(`\n  ${C.green}✓ Weights updated${C.reset}\n`);
}

// ── Kill switch ────────────────────────────────────────────────────────────

async function killLosers() {
  console.log(`\n${C.bold}${C.red}🔪 Kill switch pass...${C.reset}\n`);
  let killed = 0;

  for (const component of COMPONENTS) {
    const { rows } = await query(
      `SELECT v.id, v.label, v.active,
              COALESCE(s.sends,0)::int AS sends,
              COALESCE(s.revenue_cents,0)::bigint AS revenue_cents
       FROM email_variants v
       LEFT JOIN variant_stats s ON s.variant_id = v.id
       WHERE v.component = $1 AND v.active = TRUE`,
      [component]
    );

    const eligible = rows.filter(v => v.sends >= MIN_SENDS_TO_JUDGE);
    if (eligible.length <= 1) continue;

    const scores  = eligible.map(v => ({ ...v, reward: rewardScore(v.sends, v.revenue_cents) || 0 }));
    const baseline = scores.reduce((s, v) => s + v.reward, 0) / scores.length;

    for (const v of scores) {
      if (v.reward < baseline * KILL_THRESHOLD && rows.length > 1) {
        const reason = `kill_switch: $${v.reward.toFixed(2)}/100 < threshold $${(baseline * KILL_THRESHOLD).toFixed(2)}/100`;
        await query(
          `UPDATE email_variants SET active = FALSE, paused_at = NOW(), pause_reason = $1 WHERE id = $2`,
          [reason, v.id]
        );
        await query(
          `INSERT INTO experiment_log (action, variant_id, reason) VALUES ('pause_variant', $1, $2)`,
          [v.id, reason]
        );
        console.log(`  ${C.red}✗ PAUSED${C.reset} ${component}/${v.label} — ${reason}`);
        killed++;
      }
    }
  }
  console.log(killed === 0
    ? `  ${C.dim}No variants below kill threshold.${C.reset}`
    : `\n  ${C.red}${killed} variant(s) paused.${C.reset}`
  );
}

// ── Stats display ─────────────────────────────────────────────────────────

async function showStats() {
  const { rows } = await query(
    `SELECT v.id, v.component, v.label, v.weight::float AS weight, v.active,
            COALESCE(s.sends,0)::int AS sends,
            COALESCE(s.opens,0)::int AS opens,
            COALESCE(s.clicks,0)::int AS clicks,
            COALESCE(s.replies,0)::int AS replies,
            COALESCE(s.orders,0)::int AS orders,
            COALESCE(s.revenue_cents,0)::bigint AS revenue_cents
     FROM email_variants v
     LEFT JOIN variant_stats s ON s.variant_id = v.id
     ORDER BY v.component, v.weight DESC`
  );

  console.log(`\n${C.bold}${C.cyan}╔═══════════════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.cyan}║   EXPERIMENT ENGINE — VARIANT PERFORMANCE   KPI: $/100 sends         ║${C.reset}`);
  console.log(`${C.bold}${C.cyan}╚═══════════════════════════════════════════════════════════════════════╝${C.reset}\n`);

  const components = [...new Set(rows.map(r => r.component))];
  for (const component of components) {
    const vs = rows.filter(r => r.component === component);
    const maxReward = Math.max(...vs.map(v => rewardScore(v.sends, v.revenue_cents) || 0));

    console.log(`  ${C.bold}${C.yellow}${component.toUpperCase()}${C.reset}`);
    console.log(`  ${'─'.repeat(70)}`);
    console.log(`  ${'VARIANT'.padEnd(32)} ${'W'.padEnd(5)} ${'SENDS'.padEnd(7)} ${'OPEN%'.padEnd(7)} ${'$/100'.padEnd(8)} STATUS`);
    console.log(`  ${'─'.repeat(70)}`);

    for (const v of vs) {
      const reward    = rewardScore(v.sends, v.revenue_cents);
      const isWinner  = reward !== null && reward === maxReward && maxReward > 0;
      const isLoser   = reward !== null && reward < maxReward * KILL_THRESHOLD;
      const color     = !v.active ? C.dim : isWinner ? C.green : isLoser ? C.red : C.reset;
      const status    = !v.active ? `${C.dim}PAUSED${C.reset}` : isWinner ? `${C.green}★ WINNER${C.reset}` : `${C.dim}active${C.reset}`;
      const openRate  = v.sends > 0 ? `${((v.opens / v.sends) * 100).toFixed(0)}%` : '—';
      const rewardStr = reward !== null ? `$${reward.toFixed(2)}` : '—';

      console.log(
        `  ${color}${v.label.padEnd(32)}${C.reset}` +
        ` ${color}${v.weight.toFixed(2).padEnd(5)}${C.reset}` +
        ` ${String(v.sends).padEnd(7)}` +
        ` ${openRate.padEnd(7)}` +
        ` ${rewardStr.padEnd(8)}` +
        ` ${status}`
      );
    }
    console.log('');
  }

  // Totals
  const totRes = await query(
    `SELECT COALESCE(SUM(order_value_cents),0)::bigint AS total FROM email_send_log WHERE order_value_cents IS NOT NULL`
  );
  const totalRev   = (totRes.rows[0]?.total || 0) / 100;
  const totalSends = rows.reduce((s, v) => s + (v.sends || 0), 0);
  const kpi        = totalSends > 0 ? (totalRev / totalSends * 100).toFixed(2) : '0.00';
  console.log(`  ${C.bold}Overall: ${totalSends} sends → $${totalRev.toFixed(2)} revenue → $${kpi}/100 sends${C.reset}\n`);
}

// ── Attribution API (called by stripe-webhook-handler.js) ─────────────────

/**
 * Attribute a Stripe order to the variant combo that sent the email.
 * Idempotent: skips if order_id already attributed.
 */
async function attributeRevenue(leadId, orderId, valueCents) {
  // Idempotency guard
  if (orderId) {
    const dup = await query(
      `SELECT id FROM email_send_log WHERE order_id = $1 LIMIT 1`, [orderId]
    );
    if (dup.rows.length) {
      console.log(`  [experiment] Order ${orderId} already attributed`);
      return;
    }
  }

  const logRes = await query(
    `SELECT * FROM email_send_log WHERE lead_id = $1 ORDER BY sent_at DESC LIMIT 1`,
    [leadId]
  );
  const sendLog = logRes.rows[0];
  if (!sendLog) {
    console.log(`  [experiment] No send log for lead ${leadId}`);
    return;
  }
  if (sendLog.order_id) {
    console.log(`  [experiment] Lead ${leadId} already has attributed order ${sendLog.order_id}`);
    return;
  }

  await query(
    `UPDATE email_send_log SET order_id = $1, order_value_cents = $2 WHERE id = $3`,
    [orderId, valueCents, sendLog.id]
  );

  const variants = [
    sendLog.subject_id, sendLog.hook_id, sendLog.cta_id,
    sendLog.image_id,   sendLog.offer_id,
  ].filter(Boolean);

  for (const vid of variants) {
    await query(
      `INSERT INTO variant_stats (variant_id, orders, revenue_cents)
       VALUES ($1, 1, $2)
       ON CONFLICT (variant_id) DO UPDATE SET
         orders        = variant_stats.orders + 1,
         revenue_cents = variant_stats.revenue_cents + $2,
         last_updated  = NOW()`,
      [vid, valueCents]
    );
    if (sendLog.segment) {
      await query(
        `INSERT INTO segment_variant_stats (segment, variant_id, sends, revenue_cents)
         VALUES ($1, $2, 0, $3)
         ON CONFLICT (segment, variant_id) DO UPDATE SET revenue_cents = segment_variant_stats.revenue_cents + $3`,
        [sendLog.segment, vid, valueCents]
      );
    }
  }
  console.log(`  [experiment] Attributed $${(valueCents/100).toFixed(2)} → ${variants.join(', ')}`);
}

// ── Log send (called by daily-send-scheduler.js) ──────────────────────────

/**
 * Record which variant combo was used for a specific lead send.
 * Returns the email_send_log row ID.
 */
async function logSend(leadId, combo, segment) {
  const res = await query(
    `INSERT INTO email_send_log
       (lead_id, subject_id, hook_id, cta_id, image_id, offer_id, segment, is_explore)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      leadId, combo.subject || null, combo.hook || null, combo.cta || null,
      combo.image || null, combo.offer || null, segment || null, combo.is_explore || false,
    ]
  );

  // Increment sends per variant
  const variants = [combo.subject, combo.hook, combo.cta, combo.image, combo.offer].filter(Boolean);
  for (const vid of variants) {
    await query(
      `INSERT INTO variant_stats (variant_id, sends) VALUES ($1, 1)
       ON CONFLICT (variant_id) DO UPDATE SET sends = variant_stats.sends + 1, last_updated = NOW()`,
      [vid]
    );
    if (segment) {
      await query(
        `INSERT INTO segment_variant_stats (segment, variant_id, sends, revenue_cents)
         VALUES ($1, $2, 1, 0)
         ON CONFLICT (segment, variant_id) DO UPDATE SET sends = segment_variant_stats.sends + 1`,
        [segment, vid]
      );
    }
  }

  return res.rows[0]?.id;
}

// ── Log engagement (called by webhook-server.js) ──────────────────────────

/**
 * Record an open/click/reply event.
 * eventType: 'open' | 'click' | 'reply'
 */
async function logEngagement(leadId, eventType) {
  const colMap = { open: 'opened_at', click: 'clicked_at', reply: 'replied_at' };
  const countCol = { open: 'opens', click: 'clicks', reply: 'replies' };
  const col = colMap[eventType];
  if (!col) return;

  // Update email_send_log
  await query(
    `UPDATE email_send_log SET ${col} = NOW()
     WHERE lead_id = $1 AND ${col} IS NULL
     AND id = (SELECT id FROM email_send_log WHERE lead_id = $1 ORDER BY sent_at DESC LIMIT 1)`,
    [leadId]
  );

  // Increment variant stat
  const logRes = await query(
    `SELECT subject_id, hook_id, cta_id, image_id, offer_id
     FROM email_send_log WHERE lead_id = $1 ORDER BY sent_at DESC LIMIT 1`,
    [leadId]
  );
  const row = logRes.rows[0];
  if (!row) return;

  const variants = [row.subject_id, row.hook_id, row.cta_id, row.image_id, row.offer_id].filter(Boolean);
  for (const vid of variants) {
    await query(
      `UPDATE variant_stats SET ${countCol[eventType]} = ${countCol[eventType]} + 1, last_updated = NOW()
       WHERE variant_id = $1`,
      [vid]
    );
  }
}

// ── Get variant content (called by daily-send-scheduler.js) ──────────────

/**
 * Resolve variant IDs to their content strings.
 * Returns { subject: "...", hook: "...", cta: "...", image: "...", offer: "..." }
 */
async function resolveVariantContent(combo) {
  const ids = [combo.subject, combo.hook, combo.cta, combo.image, combo.offer].filter(Boolean);
  if (!ids.length) return {};

  const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
  const { rows } = await query(
    `SELECT id, component, content FROM email_variants WHERE id IN (${placeholders})`,
    ids
  );

  const out = {};
  for (const row of rows) out[row.component] = row.content;
  return out;
}

// ── Close pool (call at process exit) ─────────────────────────────────────

async function closePool() {
  await pool.end();
}

// ── CLI ────────────────────────────────────────────────────────────────────

if (require.main === module) {
  (async () => {
    const args     = process.argv.slice(2);
    const select   = args.includes("--select");
    const update   = args.includes("--update");
    const killLos  = args.includes("--kill-losers");
    const stats    = args.includes("--stats");
    const segStats = args.includes("--stats-segment");
    const runAll   = args.includes("--run-all");
    const segArg   = args.find(a => a.startsWith("--segment="));
    const segment  = segArg ? segArg.split("=")[1] : null;

    // Verify tables exist
    try {
      await query(`SELECT 1 FROM email_variants LIMIT 1`);
    } catch {
      console.error(`\n  ⚠️  Experiment tables not found. Run:\n  node scripts/run-migrations.js\n`);
      process.exit(1);
    }

    if (select) {
      const combo = await selectVariantCombo(segment);
      console.log(JSON.stringify(combo, null, 2));
    } else if (update) {
      await updateWeights();
    } else if (killLos) {
      await killLosers();
    } else if (stats) {
      await showStats();
    } else if (runAll) {
      await updateWeights();
      await killLosers();
      await showStats();
    } else {
      console.log(`
  ${C.bold}experiment-engine.js${C.reset} — self-optimizing outbound variant system

  --select [--segment=TYPE]  Output variant combo JSON for one send
  --update                   Recompute weights from current revenue data
  --kill-losers              Pause underperforming variants (≥${MIN_SENDS_TO_JUDGE} sends)
  --stats                    Print full variant performance table
  --run-all                  update + kill-losers + stats (run daily)

  Primary KPI: revenue ($) per 100 sends
  Explore/Exploit: ${EXPLORE_RATE * 100}% / ${(1 - EXPLORE_RATE) * 100}%
  Kill threshold:  ${KILL_THRESHOLD * 100}% of baseline after ≥${MIN_SENDS_TO_JUDGE} sends
      `);
    }

    await closePool();
  })().catch(e => { console.error(e); process.exit(1); });
}

module.exports = {
  selectVariantCombo,
  resolveVariantContent,
  logSend,
  logEngagement,
  attributeRevenue,
  updateWeights,
  killLosers,
  showStats,
  closePool,
};
