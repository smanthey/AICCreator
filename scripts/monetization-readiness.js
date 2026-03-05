#!/usr/bin/env node
"use strict";

/**
 * Monetization readiness report — one place to see how close we are to revenue.
 * Pillars: (1) Lead gen (Skyn Patch first), (2) ClawPay ($1+ Stripe), (3) SaaS completion (P0/P1 gaps).
 * Usage: node scripts/monetization-readiness.js [--json]
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

require("dotenv").config({ path: path.join(__dirname, "../.env") });

const ROOT = path.join(__dirname, "..");
const REPORTS_DIR = path.join(ROOT, "reports");
const ROLLING_GAP_PATH = path.join(REPORTS_DIR, "repo-completion-gap-rolling.json");
const LEADGEN_RATIO_PATH = path.join(ROOT, "config", "leadgen-send-ratio.json");
const PRIORITY_AREAS_PATH = path.join(ROOT, "config", "top-priority-areas.json");

const CLAWPAY_PM2_APPS = ["claw-prompt-oracle", "claw-bot-commerce-api", "claw-bot-discovery", "claw-bot-outreach"];
const CLAWPAY_ALWAYS_ON = ["claw-prompt-oracle", "claw-bot-commerce-api"];
const CLAWPAY_CRON_APPS = ["claw-bot-discovery", "claw-bot-outreach"];
const CLAWPAY_ENV = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "COMMERCE_PUBLIC_URL"];
const P0_P1_REPOS = ["CookiesPass", "payclaw", "CaptureInbound", "capture", "autopay_ui"];

function pm2Status(name) {
  try {
    const out = execSync(`pm2 jlist 2>/dev/null || echo "[]"`, { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
    const list = JSON.parse(out || "[]");
    const p = list.find((x) => x.name === name);
    return p ? (p.pm2_env?.status || "unknown") : "not_found";
  } catch {
    return "pm2_error";
  }
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function run() {
  const report = {
    generated_at: new Date().toISOString(),
    pillars: {},
    blockers: [],
    next_steps: [],
  };

  // ─── 1. ClawPay (unlimited $1+ Stripe) ─────────────────────────────────────
  const clawpay = {
    apps: {},
    env_set: {},
    ready: true,
  };
  for (const app of CLAWPAY_PM2_APPS) {
    clawpay.apps[app] = pm2Status(app);
  }
  for (const app of CLAWPAY_ALWAYS_ON) {
    if (clawpay.apps[app] !== "online") clawpay.ready = false;
  }
  for (const app of CLAWPAY_CRON_APPS) {
    if (clawpay.apps[app] !== "online" && clawpay.apps[app] !== "stopped") clawpay.ready = false;
  }
  for (const key of CLAWPAY_ENV) {
    const val = process.env[key];
    clawpay.env_set[key] = !!(val && String(val).trim().length > 0);
    if (!clawpay.env_set[key]) clawpay.ready = false;
  }
  report.pillars.clawpay = clawpay;
  if (!clawpay.ready) {
    const missing = [];
    for (const app of CLAWPAY_ALWAYS_ON) {
      if (clawpay.apps[app] !== "online") missing.push(app);
    }
    for (const app of CLAWPAY_CRON_APPS) {
      if (clawpay.apps[app] === "not_found" || clawpay.apps[app] === "pm2_error") missing.push(app);
    }
    const envMissing = CLAWPAY_ENV.filter((k) => !clawpay.env_set[k]);
    if (missing.length || envMissing.length) {
      const parts = [];
      if (missing.length) parts.push(`Start ${missing.join(", ")} (npm run pm2:background:start)`);
      if (envMissing.length) parts.push(`Set ${envMissing.join(", ")} in .env`);
      report.blockers.push("ClawPay: " + parts.join(". "));
      report.next_steps.push(
        "Run: pm2 start ecosystem.background.config.js --only " +
          (missing.length ? missing.join(",") : "claw-bot-discovery,claw-bot-outreach") +
          "; verify .env has STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, COMMERCE_PUBLIC_URL"
      );
    }
  } else {
    report.next_steps.push("ClawPay is configured (cron apps may show stopped between runs); focus on discovery volume and first conversion.");
  }

  // ─── 2. Lead gen (Skyn Patch first) ────────────────────────────────────────
  const leadgenRatio = readJson(LEADGEN_RATIO_PATH, {});
  const leadgen = {
    skynpatch_send_max: leadgenRatio.skynpatch_send_max ?? 50,
    bws_send_max: leadgenRatio.bws_send_max ?? 12,
    config_loaded: !!leadgenRatio.skynpatch_send_max,
    note: "Skyn Patch should get more sends than BWS (100k+ wholesale). Lead autopilots run via PM2 cron.",
  };
  report.pillars.lead_gen = leadgen;
  report.next_steps.push("Lead gen: Ensure claw-lead-autopilot-skynpatch and claw-lead-autopilot-bws are in PM2 (cron); check config/leadgen-send-ratio.json.");

  // ─── 3. SaaS completion (P0/P1 gap closure) ─────────────────────────────────
  const rolling = readJson(ROLLING_GAP_PATH, []);
  const latestByRepo = {};
  for (const r of rolling) {
    if (r.repo && (!latestByRepo[r.repo] || r.completed_at > latestByRepo[r.repo].completed_at)) {
      latestByRepo[r.repo] = r;
    }
  }
  const saas = {
    p0_p1_repos: P0_P1_REPOS,
    last_gap: {},
    next_actions_combined: [],
  };
  for (const repo of P0_P1_REPOS) {
    const rec = latestByRepo[repo];
    if (rec) {
      saas.last_gap[repo] = {
        capability_score: rec.capability_score,
        incomplete_sections: Object.entries(rec.sections || {}).filter(([, v]) => v.status !== "complete").length,
        next_actions: (rec.next_actions || []).slice(0, 3),
      };
      saas.next_actions_combined.push(...(rec.next_actions || []).map((a) => `[${repo}] ${a}`));
    } else {
      saas.last_gap[repo] = null;
    }
  }
  saas.next_actions_combined = [...new Set(saas.next_actions_combined)].slice(0, 8);
  report.pillars.saas_completion = saas;
  if (saas.next_actions_combined.length > 0) {
    report.blockers.push("SaaS: Close P0/P1 gaps — run repo-completion-gap-one then enqueue gap-closure tasks (npm run monetization:gap:enqueue)");
    report.next_steps.push("Run: node scripts/repo-completion-gap-one.js --repo CookiesPass (or --next); then npm run monetization:gap:enqueue");
  }

  report.blockers = report.blockers.length ? report.blockers : ["No critical blockers; focus on volume and first conversion."];
  return report;
}

function main() {
  const jsonOnly = process.argv.includes("--json");
  const report = run();

  if (jsonOnly) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const md = [
    "# Monetization Readiness",
    "",
    `Generated: ${report.generated_at}`,
    "",
    "## Blockers",
    ...report.blockers.map((b) => `- ${b}`),
    "",
    "## Next steps",
    ...report.next_steps.map((s) => `- ${s}`),
    "",
    "## ClawPay",
    `- Apps: ${JSON.stringify(report.pillars.clawpay?.apps)}`,
    `- Env set: ${JSON.stringify(report.pillars.clawpay?.env_set)}`,
    `- Ready: ${report.pillars.clawpay?.ready}`,
    "",
    "## Lead gen",
    `- Skyn Patch send_max: ${report.pillars.lead_gen?.skynpatch_send_max}, BWS: ${report.pillars.lead_gen?.bws_send_max}`,
    "",
    "## SaaS (P0/P1)",
    ...Object.entries(report.pillars.saas_completion?.last_gap || {}).map(([repo, v]) => {
      if (!v) return `- ${repo}: no gap run yet`;
      return `- ${repo}: score=${v.capability_score} incomplete=${v.incomplete_sections} — ${(v.next_actions || []).join("; ")}`;
    }),
  ].join("\n");

  console.log(md);
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORTS_DIR, "monetization-readiness-latest.json"), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(REPORTS_DIR, "monetization-readiness-latest.md"), md);
  console.log("\nWrote reports/monetization-readiness-latest.json and .md");
}

main();
