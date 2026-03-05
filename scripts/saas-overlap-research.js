#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const ARGS = process.argv.slice(2);
const RUN_ID = getArg("--run-id", null);
const OUT_DIR = path.join(__dirname, "reports");

function getArg(flag, fallback = null) {
  const i = ARGS.indexOf(flag);
  return i >= 0 ? ARGS[i + 1] : fallback;
}

function pool() {
  return new Pool({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT || 15432),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
  });
}

function toFeatureSet(r) {
  return new Set([
    `framework:${r.framework || "unknown"}`,
    `router:${r.router_mode || "unknown"}`,
    `auth:${r.auth_provider || "none"}`,
    `billing:${r.billing_pattern || "none"}`,
    `telnyx:${r.telnyx_pattern || "none"}`,
    `email:${r.email_provider || "none"}`,
    `orm:${r.orm_used || "none"}`,
    `db:${r.db_client || "none"}`,
    `manifests:${r.has_module_manifests ? "yes" : "no"}`,
    `playwright:${r.has_playwright ? "yes" : "no"}`,
  ]);
}

function jaccard(a, b) {
  const inter = [...a].filter((x) => b.has(x)).length;
  const uni = new Set([...a, ...b]).size || 1;
  return inter / uni;
}

function frequency(rows, key) {
  const m = new Map();
  for (const r of rows) {
    const v = r[key] || "none";
    m.set(v, (m.get(v) || 0) + 1);
  }
  return [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
}

async function main() {
  const db = pool();
  try {
    const run = RUN_ID
      ? (await db.query("SELECT id, started_at, finished_at, status FROM github_repo_scan_runs WHERE id=$1", [RUN_ID])).rows[0]
      : (await db.query(
        `SELECT id, started_at, finished_at, status
         FROM github_repo_scan_runs
         WHERE status='completed'
         ORDER BY finished_at DESC NULLS LAST, started_at DESC
         LIMIT 1`
      )).rows[0];

    if (!run) {
      throw new Error("no completed github scan run found; run `npm run github:scan` first");
    }

    const { rows } = await db.query(
      `SELECT repo_name, framework, router_mode, auth_provider, billing_pattern, telnyx_pattern,
              email_provider, orm_used, db_client, has_playwright, has_module_manifests,
              stack_health_score, webhook_signature_verified, stripe_idempotency_used, pattern_hash
       FROM github_repo_stack_facts
       WHERE run_id = $1
       ORDER BY repo_name`,
      [run.id]
    );

    if (!rows.length) {
      throw new Error(`scan run ${run.id} has zero repo facts`);
    }

    const featuresByRepo = rows.map((r) => ({ repo: r.repo_name, features: toFeatureSet(r), health: Number(r.stack_health_score || 0), row: r }));

    const overlaps = [];
    for (let i = 0; i < featuresByRepo.length; i++) {
      for (let j = i + 1; j < featuresByRepo.length; j++) {
        const a = featuresByRepo[i];
        const b = featuresByRepo[j];
        const score = Number(jaccard(a.features, b.features).toFixed(3));
        overlaps.push({ repo_a: a.repo, repo_b: b.repo, overlap_score: score });
      }
    }
    overlaps.sort((a, b) => b.overlap_score - a.overlap_score);

    const healthy = rows.filter((r) => Number(r.stack_health_score || 0) >= 80);
    const best = [...rows].sort((a, b) => {
      const ax = Number(a.stack_health_score || 0) + (a.has_playwright ? 5 : 0) + (a.webhook_signature_verified ? 5 : 0);
      const bx = Number(b.stack_health_score || 0) + (b.has_playwright ? 5 : 0) + (b.webhook_signature_verified ? 5 : 0);
      return bx - ax;
    })[0];

    const report = {
      generated_at: new Date().toISOString(),
      run: run,
      repos: rows.length,
      healthy_repos: healthy.length,
      frequencies: {
        auth_provider: frequency(rows, "auth_provider"),
        billing_pattern: frequency(rows, "billing_pattern"),
        telnyx_pattern: frequency(rows, "telnyx_pattern"),
        email_provider: frequency(rows, "email_provider"),
        orm_used: frequency(rows, "orm_used"),
        db_client: frequency(rows, "db_client"),
      },
      highest_overlaps: overlaps.slice(0, 25),
      best_reference_repo: best ? {
        repo_name: best.repo_name,
        stack_health_score: Number(best.stack_health_score || 0),
        auth_provider: best.auth_provider,
        billing_pattern: best.billing_pattern,
        telnyx_pattern: best.telnyx_pattern,
        has_playwright: best.has_playwright,
        webhook_signature_verified: best.webhook_signature_verified,
      } : null,
      recommendations: [
        "Standardize new SaaS apps on the most frequent healthy auth + billing + comms stack.",
        "Prioritize repos with overlap_score >= 0.75 for codemod migration in a single wave.",
        "Use best_reference_repo as canonical implementation for shared modules.",
      ],
    };

    fs.mkdirSync(OUT_DIR, { recursive: true });
    const out = path.join(OUT_DIR, `${Date.now()}-saas-overlap-research.json`);
    fs.writeFileSync(out, JSON.stringify(report, null, 2));

    console.log("\n=== SaaS Overlap Research ===\n");
    console.log(`run_id: ${run.id}`);
    console.log(`repos: ${rows.length}`);
    console.log(`healthy_repos: ${healthy.length}`);
    if (report.best_reference_repo) {
      console.log(`best_reference_repo: ${report.best_reference_repo.repo_name} (health=${report.best_reference_repo.stack_health_score})`);
    }
    console.log(`report: ${out}`);
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error(`saas-overlap-research fatal: ${e.message}`);
  process.exit(1);
});

