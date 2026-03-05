#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { Pool } = require("pg");

require("dotenv").config({ path: path.join(__dirname, "../.env") });

const ROOT = path.join(__dirname, "..");
const REPORT_DIR = path.join(ROOT, "scripts", "reports");

function parseArg(flag, fallback = null) {
  const idx = process.argv.indexOf(flag);
  if (idx < 0 || idx + 1 >= process.argv.length) return fallback;
  return process.argv[idx + 1];
}

const LIMIT = Math.max(5, Number(parseArg("--limit", process.env.AFFILIATE_RESEARCH_LIMIT || "12")) || 12);
const HOST_FILTER = String(parseArg("--host", "") || "").trim().toLowerCase();

function parseUrlsFromEnv() {
  const envVal = String(process.env.GLOBAL_STATUS_URLS || process.env.SYSTEM_DASHBOARD_URLS || "");
  return envVal
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((u) => {
      try {
        const parsed = new URL(u);
        return { url: parsed.toString(), host: parsed.hostname.toLowerCase(), source: "env" };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function ghSearchRepos(query, limit = 20) {
  const args = [
    "search", "repos", query,
    "--limit", String(limit),
    "--json", "fullName,description,stargazersCount,pushedAt,updatedAt,url",
  ];
  const res = spawnSync("gh", args, {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
    timeout: 30000,
  });
  if (res.status !== 0 || !res.stdout) {
    return { ok: false, query, repos: [], error: (res.stderr || res.stdout || "gh search failed").trim() };
  }
  try {
    const rows = JSON.parse(res.stdout);
    return {
      ok: true,
      query,
      repos: Array.isArray(rows) ? rows : [],
      error: null,
    };
  } catch (err) {
    return { ok: false, query, repos: [], error: `json_parse_error:${err.message}` };
  }
}

function toScore(stars, updatedAt) {
  const starScore = Math.max(1, Math.round(Math.log10(Math.max(10, Number(stars || 0))) * 25));
  const ageDays = updatedAt ? Math.max(0, (Date.now() - new Date(updatedAt).getTime()) / 86400000) : 3650;
  const freshness = ageDays <= 30 ? 20 : ageDays <= 180 ? 14 : ageDays <= 365 ? 8 : 3;
  return Math.min(100, starScore + freshness);
}

function uniqByHost(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    if (!r || !r.host) continue;
    if (HOST_FILTER && r.host !== HOST_FILTER) continue;
    if (seen.has(r.host)) continue;
    seen.add(r.host);
    out.push(r);
  }
  return out;
}

function buildSitePlan(site, topRepo) {
  const host = site.host;
  const short = host.replace(/^www\./, "");
  const stackHint = topRepo ? `${topRepo.nameWithOwner} (score ${topRepo.score})` : "internal first-party referral ledger";
  return {
    host,
    brand_slug: site.brand_slug || null,
    affiliate_stack_hint: stackHint,
    implementation_steps: [
      `Create /go/:code redirect endpoint on ${short} with click-id + UTM capture.`,
      "Add referral ledger tables (affiliate, click, conversion, payout) with idempotent writes.",
      "Attach conversion events from Stripe/webhooks to affiliate code or click-id attribution.",
      "Generate partner links and coupon mapping per affiliate.",
      "Add fraud checks (self-referral, duplicate-IP bursts, coupon abuse, refund clawback).",
      "Expose affiliate dashboard KPIs: clicks, conversion rate, net revenue, pending payout.",
    ],
    automations: [
      "hourly: affiliate click/conversion sync",
      "daily: commission accrual + anomaly detection",
      "weekly: payout proposal report + approval queue",
      "monthly: top affiliate retention and recruitment outreach",
    ],
    tracking_spec: {
      landing_params: ["aff", "subid", "utm_source", "utm_campaign", "utm_content"],
      conversion_fields: ["affiliate_code", "click_id", "order_id", "gross_amount", "refund_amount", "net_commission"],
    },
  };
}

async function fetchBrandSites(pool) {
  try {
    const q = await pool.query(
      `SELECT slug, name, primary_domain
         FROM brands
        WHERE primary_domain IS NOT NULL
          AND primary_domain <> ''
          AND slug NOT LIKE 'e2e-brand-%'
        ORDER BY slug`
    );
    return q.rows.map((r) => ({
      host: String(r.primary_domain || "").trim().toLowerCase(),
      url: `https://${String(r.primary_domain || "").trim().toLowerCase()}`,
      source: "brands",
      brand_slug: r.slug,
      brand_name: r.name,
    }));
  } catch {
    return [];
  }
}

async function main() {
  const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: parseInt(process.env.POSTGRES_PORT || "5432", 10),
    database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    max: 2,
  });

  const startedAt = new Date().toISOString();

  const queries = [
    "open source affiliate tracking software",
    "open source referral program software",
    "open source partner attribution saas",
    "open source coupon tracking ecommerce",
  ];

  const searchRuns = queries.map((q) => ghSearchRepos(q, 20));
  const allRepos = [];
  for (const run of searchRuns) {
    for (const r of run.repos || []) {
      allRepos.push({
        query: run.query,
        nameWithOwner: r.fullName || r.nameWithOwner || "",
        description: r.description || "",
        stargazersCount: Number(r.stargazersCount || 0),
        updatedAt: r.pushedAt || r.updatedAt || null,
        url: r.url,
        score: toScore(r.stargazersCount, r.pushedAt || r.updatedAt),
      });
    }
  }

  const dedupMap = new Map();
  for (const r of allRepos) {
    const key = String(r.nameWithOwner || "").toLowerCase();
    if (!key) continue;
    const prev = dedupMap.get(key);
    if (!prev || r.score > prev.score) dedupMap.set(key, r);
  }
  const ranked = Array.from(dedupMap.values())
    .sort((a, b) => (b.score - a.score) || (b.stargazersCount - a.stargazersCount))
    .slice(0, LIMIT);

  const brandSites = await fetchBrandSites(pool);
  const envSites = parseUrlsFromEnv();
  const sites = uniqByHost([...brandSites, ...envSites]);

  const sitePlans = sites.map((site) => buildSitePlan(site, ranked[0] || null));

  const automationBlueprint = {
    pm2_jobs: [
      { name: "affiliate-research-sync", schedule: "0 */6 * * *", command: "npm run affiliate:research -- --limit 15" },
      { name: "affiliate-rollout-refresh", schedule: "30 */6 * * *", command: "npm run affiliate:research -- --host <site-host>" },
    ],
    task_lanes: [
      "research_sync -> research_signals -> affiliate_research",
      "sales webhook replay -> affiliate attribution reconcile",
      "daily payout proposal -> manager approval",
    ],
  };

  const report = {
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    filter_host: HOST_FILTER || null,
    open_source_search: {
      queries,
      runs: searchRuns.map((r) => ({ query: r.query, ok: r.ok, error: r.error || null, count: (r.repos || []).length })),
      top_candidates: ranked,
    },
    sites_discovered: sites,
    site_rollout_plans: sitePlans,
    automation_blueprint: automationBlueprint,
    recommended_next_actions: [
      "Add affiliate ledger schema migration and idempotent webhook attribution hooks.",
      "Enable one affiliate onboarding flow per brand with default commission tiers.",
      "Publish partner TOS + payout rules before enabling live payouts.",
    ],
  };

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = Date.now();
  const jsonOut = path.join(REPORT_DIR, `${stamp}-affiliate-rollout-research.json`);
  const mdOut = path.join(REPORT_DIR, `${stamp}-affiliate-rollout-research.md`);

  fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2));

  const md = [
    "# Affiliate Rollout Research",
    "",
    `Generated: ${report.completed_at}`,
    "",
    "## Open-Source Candidates",
    "",
    "| Repo | Score | Stars | Updated |",
    "|---|---:|---:|---|",
    ...ranked.map((r) => `| ${r.nameWithOwner} | ${r.score} | ${r.stargazersCount} | ${r.updatedAt || "n/a"} |`),
    "",
    "## Sites and Rollout Plans",
    "",
    ...sitePlans.map((p) => [
      `### ${p.host}`,
      `- Brand: ${p.brand_slug || "unknown"}`,
      `- Stack hint: ${p.affiliate_stack_hint}`,
      "- Steps:",
      ...p.implementation_steps.map((s) => `  - ${s}`),
      "- Automations:",
      ...p.automations.map((a) => `  - ${a}`),
      "",
    ].join("\n")),
    "## Automation Blueprint",
    "",
    ...automationBlueprint.pm2_jobs.map((j) => `- ${j.name}: ${j.schedule} -> \`${j.command}\``),
    "",
  ].join("\n");

  fs.writeFileSync(mdOut, md);

  console.log("=== Affiliate Rollout Research ===");
  console.log(`sites=${sites.length} top_candidates=${ranked.length}`);
  console.log(`report_json=${jsonOut}`);
  console.log(`report_md=${mdOut}`);

  await pool.end();
}

main().catch(async (err) => {
  console.error(`[affiliate-rollout-research] fatal: ${err.message}`);
  process.exitCode = 1;
});
