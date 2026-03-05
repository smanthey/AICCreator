#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

require("dotenv").config({ path: path.join(__dirname, "../.env") });

const ROOT = path.join(__dirname, "..");
const REPORT_DIR = path.join(ROOT, "scripts", "reports");
const LIMIT = Math.max(5, Number(process.env.SAAS_RESEARCH_LIMIT || "12"));

const OPPORTUNITIES = [
  { id: "field-service-crm", query: "field service crm sms reminders payments", needed: ["auth", "multi_tenant", "stripe", "telnyx", "email_flows"] },
  { id: "wholesale-b2b-portal", query: "b2b wholesale portal reorder workflow", needed: ["auth", "multi_tenant", "stripe", "email_flows"] },
  { id: "compliance-document-automation", query: "document automation compliance signatures", needed: ["auth", "multi_tenant", "email_flows"] },
  { id: "local-leadgen-autofollowup", query: "local lead generation follow up automation sms", needed: ["auth", "multi_tenant", "telnyx", "email_flows"] },
  { id: "creator-nfc-verification", query: "nfc verification creator commerce", needed: ["auth", "multi_tenant", "stripe"] },
  { id: "appointment-recovery-agent", query: "appointment no show recovery sms email", needed: ["auth", "multi_tenant", "telnyx", "email_flows", "stripe"] },
  { id: "pdf-workflow-saas", query: "pdf workflow form fill e-sign automation", needed: ["auth", "multi_tenant", "stripe", "email_flows"] },
  { id: "micro-saas-inbox-agent", query: "inbox automation customer support workflow", needed: ["auth", "multi_tenant", "email_flows"] },
  { id: "community-marketplace-ops", query: "community marketplace operations automation", needed: ["auth", "multi_tenant", "stripe", "email_flows"] },
  { id: "sales-sequence-saas", query: "sales sequence email sms pipeline", needed: ["auth", "multi_tenant", "telnyx", "email_flows"] },
  { id: "ai-content-ops-saas", query: "content operations workflow publishing", needed: ["auth", "multi_tenant", "email_flows"] },
  { id: "tenant-analytics-alerting", query: "multi tenant analytics alerting saas", needed: ["auth", "multi_tenant", "email_flows"] },
];

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function latestFile(dir, suffix) {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(suffix)).sort();
  if (!files.length) return null;
  return path.join(dir, files[files.length - 1]);
}

function ghRepoDemandScore(query) {
  const res = spawnSync(
    "gh",
    ["search", "repos", query, "--limit", "20", "--json", "stargazersCount,updatedAt"],
    { encoding: "utf8", cwd: ROOT, env: process.env }
  );
  if (res.status !== 0 || !res.stdout) return null;
  try {
    const arr = JSON.parse(res.stdout);
    if (!Array.isArray(arr) || arr.length === 0) return 0;
    const stars = arr.reduce((n, x) => n + Number(x.stargazersCount || 0), 0);
    return Math.round(stars / arr.length);
  } catch {
    return null;
  }
}

function scoreBuildReadiness(needed, capabilitySummary) {
  if (!capabilitySummary || !Array.isArray(capabilitySummary.scoreboard)) return 78;
  const weights = {
    auth: "auth.better_auth",
    multi_tenant: "tenancy.multitenant",
    stripe: "billing.stripe.checkout",
    telnyx: "comms.telnyx.sms",
    email_flows: "email.maileroo.send",
  };
  let total = 0;
  let count = 0;
  for (const key of needed) {
    const capId = weights[key];
    if (!capId) continue;
    const row = capabilitySummary.scoreboard.find((x) => x.capability === capId);
    total += row ? Math.max(65, Number(row.avgScore || 65)) : 78;
    count += 1;
  }
  return Math.max(70, count ? Math.round(total / count) : 78);
}

function main() {
  const started = new Date().toISOString();
  console.log("[saas-opportunity-researcher] start");

  const capFile = latestFile(path.join(ROOT, "reports", "capability-factory"), "-phase2-scoreboard.json");
  const cap = capFile ? readJson(capFile) : null;

  const ranked = OPPORTUNITIES.map((op) => {
    const demand = ghRepoDemandScore(op.query);
    const demandScore = demand === null ? 74 : Math.max(30, Math.min(100, Math.round(Math.log10(Math.max(10, demand)) * 40)));
    const readinessScore = scoreBuildReadiness(op.needed, cap);
    const total = Math.round((demandScore * 0.55) + (readinessScore * 0.45));
    return {
      ...op,
      demand_score: demandScore,
      readiness_score: readinessScore,
      total_score: total,
      recommendation: total >= 78 ? "build_now" : total >= 65 ? "prototype_next" : "watchlist",
    };
  })
    .sort((a, b) => b.total_score - a.total_score)
    .slice(0, LIMIT);

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = Date.now();
  const jsonOut = path.join(REPORT_DIR, `${stamp}-saas-opportunity-research.json`);
  const mdOut = path.join(REPORT_DIR, `${stamp}-saas-opportunity-research.md`);

  fs.writeFileSync(jsonOut, JSON.stringify({
    started_at: started,
    completed_at: new Date().toISOString(),
    capability_source: capFile,
    top: ranked,
  }, null, 2));

  const lines = [
    "# SaaS Opportunity Research",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "| Opportunity | Demand | Readiness | Total | Recommendation |",
    "|---|---:|---:|---:|---|",
    ...ranked.map((r) => `| ${r.id} | ${r.demand_score} | ${r.readiness_score} | ${r.total_score} | ${r.recommendation} |`),
    "",
    "## Notes",
    "- Demand is estimated from GitHub repo search signal when available.",
    "- Readiness is estimated from capability-factory scoreboard.",
    "- Use `build_now` candidates for next launch queue.",
  ];
  fs.writeFileSync(mdOut, lines.join("\n"));

  console.log(`[saas-opportunity-researcher] report_json=${jsonOut}`);
  console.log(`[saas-opportunity-researcher] report_md=${mdOut}`);
  console.log("[saas-opportunity-researcher] done");
}

main();
