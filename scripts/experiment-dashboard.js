#!/usr/bin/env node
/**
 * experiment-dashboard.js
 * Colored variant performance dashboard — reads from PostgreSQL (NAS).
 * Winner is decided by revenue per 100 sends.
 *
 * Usage:
 *   node scripts/experiment-dashboard.js
 */
"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const { Pool } = require("pg");

const pool = new Pool({
  host:     process.env.POSTGRES_HOST     || process.env.CLAW_DB_HOST,
  port:     parseInt(process.env.POSTGRES_PORT || process.env.CLAW_DB_PORT || "15432", 10),
  user:     process.env.POSTGRES_USER     || process.env.CLAW_DB_USER     || "claw",
  password: process.env.POSTGRES_PASSWORD || process.env.CLAW_DB_PASSWORD,
  database: process.env.POSTGRES_DB       || process.env.CLAW_DB_NAME     || "claw_architect",
  max: 3,
  connectionTimeoutMillis: 5000,
});

const C = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  dim:    "\x1b[2m",
  cyan:   "\x1b[36m",
  green:  "\x1b[32m",
  yellow: "\x1b[33m",
  red:    "\x1b[31m",
};

function rewardPer100(sends, revenueCents) {
  if (!sends) return 0;
  return (revenueCents / 100) / sends * 100;
}

async function main() {
  let rows = [];
  try {
    const result = await pool.query(
      `SELECT v.component, v.id, v.label, v.active, v.weight,
              COALESCE(s.sends, 0)         AS sends,
              COALESCE(s.revenue_cents, 0) AS revenue_cents,
              COALESCE(s.orders, 0)        AS orders
         FROM email_variants v
         LEFT JOIN variant_stats s ON s.variant_id = v.id
        ORDER BY v.component, v.weight DESC`
    );
    rows = result.rows;
  } catch (e) {
    console.error(`\n❌ Query failed: ${e.message}`);
    console.error(`   Ensure PostgreSQL is reachable and migrations have been run.`);
    console.error(`   Run: node scripts/run-migrations.js`);
    await pool.end().catch(() => {});
    process.exit(1);
  }

  await pool.end().catch(() => {});

  if (!rows.length) {
    console.log("No variant rows found. Run migrations/seed first.");
    return;
  }

  const totalSends        = rows.reduce((n, r) => n + Number(r.sends || 0), 0);
  const totalRevenueCents = rows.reduce((n, r) => n + Number(r.revenue_cents || 0), 0);

  console.log(`\n${C.bold}${C.cyan}╔══════════════════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.cyan}║                  EXPERIMENT DASHBOARD (REVENUE-LED)                    ║${C.reset}`);
  console.log(`${C.bold}${C.cyan}╚══════════════════════════════════════════════════════════════════════════╝${C.reset}\n`);

  const components = [...new Set(rows.map(r => r.component))];
  for (const component of components) {
    const group  = rows.filter(r => r.component === component);
    const scored = group.map(r => ({ ...r, rp100: rewardPer100(Number(r.sends), Number(r.revenue_cents)) }));
    const winner = scored
      .filter(r => r.active)
      .sort((a, b) => b.rp100 - a.rp100 || b.sends - a.sends)[0];

    console.log(`  ${C.bold}${C.yellow}${component.toUpperCase()}${C.reset}`);
    console.log(`  ${"-".repeat(74)}`);
    console.log(`  ${"VARIANT".padEnd(30)} ${"WT".padEnd(6)} ${"SENDS".padEnd(8)} ${"ORD".padEnd(6)} ${"REV/100".padEnd(11)} STATUS`);
    console.log(`  ${"-".repeat(74)}`);

    for (const row of scored) {
      const isWinner = !!winner && row.id === winner.id;
      const status = !row.active
        ? `${C.dim}PAUSED${C.reset}`
        : isWinner
          ? `${C.green}WINNER${C.reset}`
          : `${C.dim}active${C.reset}`;

      const color = !row.active ? C.dim : isWinner ? C.green : row.rp100 === 0 ? C.dim : C.reset;

      console.log(
        `  ${color}${String(row.label).padEnd(30)}${C.reset} ` +
        `${color}${Number(row.weight).toFixed(2).padEnd(6)}${C.reset} ` +
        `${String(row.sends).padEnd(8)} ` +
        `${String(row.orders).padEnd(6)} ` +
        `${(`$${row.rp100.toFixed(2)}`).padEnd(11)} ` +
        `${status}`
      );
    }
    console.log("");
  }

  const overall = totalSends > 0 ? ((totalRevenueCents / 100) / totalSends * 100) : 0;
  console.log(`${C.bold}Overall KPI:${C.reset} ${totalSends} sends, $${(totalRevenueCents / 100).toFixed(2)} revenue, $${overall.toFixed(2)} per 100 sends\n`);
}

main().catch(async (e) => {
  console.error(`\n❌ ${e.message}`);
  await pool.end().catch(() => {});
  process.exit(1);
});
