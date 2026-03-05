#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const pg = require("../infra/postgres");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const ARGS = process.argv.slice(2);
const CMD = ARGS[0] || "help";

function arg(flag, fallback = null) {
  const i = ARGS.indexOf(flag);
  if (i < 0 || i + 1 >= ARGS.length) return fallback;
  return ARGS[i + 1];
}

function toNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function nowTs() {
  return new Date().toISOString();
}

function reportDir() {
  const d = path.join(__dirname, "reports");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function writeReport(prefix, payload) {
  const ts = String(Date.now());
  const dir = reportDir();
  const jsonPath = path.join(dir, `${ts}-${prefix}.json`);
  const latestPath = path.join(dir, `${prefix}-latest.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
  fs.writeFileSync(latestPath, JSON.stringify(payload, null, 2));
  return { jsonPath, latestPath };
}

function latestReportBySuffix(suffix) {
  const dir = reportDir();
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(suffix)).sort();
  if (!files.length) return null;
  const file = files[files.length - 1];
  const full = path.join(dir, file);
  try {
    return { file, full, data: JSON.parse(fs.readFileSync(full, "utf8")) };
  } catch {
    return null;
  }
}

async function ensureSchema() {
  const pg = require("../infra/postgres");
  // Check if migration has been applied
  const { rows } = await pg.query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables 
      WHERE table_name = 'agency_accounts'
    ) as exists
  `);
  
  if (!rows[0].exists) {
    throw new Error('Migration 067 must be applied first. Run: node scripts/run-migrations.js --only 067');
  }
}

function stageProbability(stage) {
  const map = {
    new_lead: 10,
    discovery_booked: 25,
    qualified: 40,
    proposal_sent: 55,
    verbal_yes: 80,
    closed_won: 100,
    closed_lost: 0,
  };
  return map[stage] == null ? 10 : map[stage];
}

async function addAccount() {
  await ensureSchema();
  const name = arg("--name");
  if (!name) throw new Error("--name is required");
  const segment = arg("--segment", "small_business");
  const source = arg("--source", "manual");
  const owner = arg("--owner", "<USER>");
  const website = arg("--website", null);
  const contactName = arg("--contact-name", null);
  const contactEmail = arg("--contact-email", null);
  const pain = arg("--pain", null);

  const { rows } = await pg.query(
    `INSERT INTO agency_accounts
      (name, segment, source, owner, website, contact_name, contact_email, pain_summary)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, name, status, created_at`,
    [name, segment, source, owner, website, contactName, contactEmail, pain]
  );

  console.log(JSON.stringify({ ok: true, account: rows[0] }, null, 2));
}

async function addDeal() {
  await ensureSchema();
  const account = arg("--account");
  if (!account) throw new Error("--account is required (id or name)");
  const stage = arg("--stage", "new_lead");
  const setup = toNum(arg("--setup", "0"), 0);
  const retainer = toNum(arg("--retainer", "0"), 0);
  const closeDate = arg("--close-date", null);
  const nextAction = arg("--next-action", null);
  const notes = arg("--notes", null);

  const acct = await pg.query(
    `SELECT id, name FROM agency_accounts
      WHERE id::text = $1 OR lower(name) = lower($1)
      ORDER BY created_at DESC
      LIMIT 1`,
    [account]
  );
  if (!acct.rows.length) throw new Error(`account not found: ${account}`);

  const probability = stageProbability(stage);

  const { rows } = await pg.query(
    `INSERT INTO agency_deals
      (account_id, stage, setup_value_usd, retainer_value_usd, probability_pct, expected_close_date, next_action, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, account_id, stage, probability_pct, setup_value_usd, retainer_value_usd, expected_close_date`,
    [acct.rows[0].id, stage, setup, retainer, probability, closeDate, nextAction, notes]
  );

  await pg.query(
    `INSERT INTO agency_activities (account_id, deal_id, activity_type, summary, detail)
     VALUES ($1,$2,'deal_created',$3,$4::jsonb)`,
    [acct.rows[0].id, rows[0].id, `Deal created at stage ${stage}`, JSON.stringify({ setup, retainer, closeDate })]
  );

  console.log(JSON.stringify({ ok: true, account: acct.rows[0], deal: rows[0] }, null, 2));
}

async function advanceDeal() {
  await ensureSchema();
  const dealId = arg("--deal");
  const stage = arg("--stage");
  if (!dealId || !stage) throw new Error("--deal and --stage are required");
  const prob = stageProbability(stage);
  const nextAction = arg("--next-action", null);
  const notes = arg("--notes", null);

  const { rows } = await pg.query(
    `UPDATE agency_deals
     SET stage = $2,
         probability_pct = $3,
         next_action = COALESCE($4, next_action),
         notes = COALESCE($5, notes),
         updated_at = NOW()
     WHERE id::text = $1
     RETURNING id, account_id, stage, probability_pct, setup_value_usd, retainer_value_usd, expected_close_date`,
    [dealId, stage, prob, nextAction, notes]
  );
  if (!rows.length) throw new Error(`deal not found: ${dealId}`);

  await pg.query(
    `INSERT INTO agency_activities (account_id, deal_id, activity_type, summary, detail)
     VALUES ($1,$2,'deal_stage_changed',$3,$4::jsonb)`,
    [rows[0].account_id, rows[0].id, `Deal advanced to ${stage}`, JSON.stringify({ probability_pct: prob, nextAction })]
  );

  console.log(JSON.stringify({ ok: true, deal: rows[0] }, null, 2));
}

async function addCaseStudy() {
  await ensureSchema();
  const account = arg("--account", null);
  const title = arg("--title");
  if (!title) throw new Error("--title is required");
  const baseline = arg("--baseline", "");
  const outcome = arg("--outcome", "");
  const links = (arg("--proof-links", "") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const published = String(arg("--published", "false")).toLowerCase() === "true";

  let accountId = null;
  if (account) {
    const acct = await pg.query(
      `SELECT id FROM agency_accounts
       WHERE id::text = $1 OR lower(name) = lower($1)
       ORDER BY created_at DESC LIMIT 1`,
      [account]
    );
    accountId = acct.rows[0]?.id || null;
  }

  const { rows } = await pg.query(
    `INSERT INTO agency_case_studies
      (account_id, title, baseline_summary, outcome_summary, proof_links, published)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id, account_id, title, published, created_at`,
    [accountId, title, baseline, outcome, links, published]
  );

  console.log(JSON.stringify({ ok: true, case_study: rows[0] }, null, 2));
}

async function dashboard() {
  await ensureSchema();
  const { rows: stageRows } = await pg.query(
    `SELECT stage, COUNT(*)::int AS deals
     FROM agency_deals
     GROUP BY stage
     ORDER BY deals DESC`
  );

  const { rows: revRows } = await pg.query(
    `SELECT
       COALESCE(SUM(CASE WHEN d.stage='closed_won' THEN d.setup_value_usd ELSE 0 END),0)::numeric AS won_setup_usd,
       COALESCE(SUM(CASE WHEN d.stage='closed_won' THEN d.retainer_value_usd ELSE 0 END),0)::numeric AS won_mrr_usd,
       COALESCE(SUM((d.setup_value_usd + d.retainer_value_usd * 12) * (d.probability_pct::numeric / 100.0)),0)::numeric AS weighted_pipeline_annual_usd,
       COALESCE(SUM((d.setup_value_usd + d.retainer_value_usd) * (d.probability_pct::numeric / 100.0)),0)::numeric AS weighted_pipeline_month1_usd
     FROM agency_deals d`
  );

  const { rows: acctRows } = await pg.query(
    `SELECT status, COUNT(*)::int AS accounts
     FROM agency_accounts
     GROUP BY status
     ORDER BY accounts DESC`
  );

  const { rows: caseRows } = await pg.query(
    `SELECT
       COUNT(*)::int AS total,
       COALESCE(SUM(CASE WHEN published THEN 1 ELSE 0 END),0)::int AS published
     FROM agency_case_studies`
  );

  const out = {
    generated_at: nowTs(),
    account_status: acctRows,
    deal_stages: stageRows,
    revenue: revRows[0] || {},
    case_studies: caseRows[0] || {},
    target_monthly_usd: 100000,
  };

  const files = writeReport("agency-dashboard", out);
  console.log(JSON.stringify({ ok: true, report: out, files }, null, 2));
}

function computeModel() {
  const targetMonthly = toNum(arg("--target-monthly", "100000"), 100000);
  const avgSetup = toNum(arg("--avg-setup", "3500"), 3500);
  const avgRetainer = toNum(arg("--avg-retainer", "1250"), 1250);
  const setupPerMonth = toNum(arg("--new-setups-per-month", "6"), 6);
  const closeRate = toNum(arg("--close-rate", "0.25"), 0.25);
  const proposalRate = toNum(arg("--proposal-rate", "0.5"), 0.5);
  const qualifiedRate = toNum(arg("--qualified-rate", "0.35"), 0.35);

  const setupMonthly = avgSetup * setupPerMonth;
  const mrrGap = Math.max(0, targetMonthly - setupMonthly);
  const retainerClientsNeeded = avgRetainer > 0 ? Math.ceil(mrrGap / avgRetainer) : 0;

  const qualifiedNeeded = closeRate > 0 ? Math.ceil((setupPerMonth + retainerClientsNeeded) / closeRate) : 0;
  const proposalsNeeded = proposalRate > 0 ? Math.ceil(qualifiedNeeded / proposalRate) : 0;
  const leadsNeeded = qualifiedRate > 0 ? Math.ceil(qualifiedNeeded / qualifiedRate) : 0;

  const out = {
    generated_at: nowTs(),
    assumptions: {
      target_monthly_usd: targetMonthly,
      avg_setup_usd: avgSetup,
      avg_retainer_usd: avgRetainer,
      new_setups_per_month: setupPerMonth,
      close_rate: closeRate,
      proposal_rate: proposalRate,
      qualified_rate: qualifiedRate,
    },
    model: {
      setup_monthly_usd: setupMonthly,
      remaining_mrr_gap_usd: mrrGap,
      active_retainer_clients_needed: retainerClientsNeeded,
      total_new_clients_needed_this_month: setupPerMonth + retainerClientsNeeded,
      funnel_monthly_targets: {
        leads: leadsNeeded,
        proposals: proposalsNeeded,
        qualified_calls: qualifiedNeeded,
        closes: setupPerMonth + retainerClientsNeeded,
      },
      weekly_targets: {
        leads: Math.ceil(leadsNeeded / 4),
        proposals: Math.ceil(proposalsNeeded / 4),
        qualified_calls: Math.ceil(qualifiedNeeded / 4),
        closes: Math.ceil((setupPerMonth + retainerClientsNeeded) / 4),
      },
    },
    pricing_ladder: [
      { tier: "starter", setup_usd: 2000, retainer_usd: 500, includes: ["core setup", "1 workflow", "handoff"] },
      { tier: "growth", setup_usd: 3500, retainer_usd: 1250, includes: ["full setup", "4 workflows", "weekly optimization"] },
      { tier: "scale", setup_usd: 5000, retainer_usd: 2000, includes: ["custom integrations", "priority support", "expansion roadmap"] },
    ],
    next_actions: [
      "Publish 2 case studies/week with measurable before/after metrics",
      "Run discovery pipeline daily and move leads through CRM stages",
      "Package readiness audits as paid entry offer",
      "Convert closed-won setups into 6-12 month retainers with SLA"
    ]
  };

  const files = writeReport("agency-100k-model", out);
  return { out, files };
}

function scoreFromReports(repoName) {
  const qa = latestReportBySuffix("-qa-human-grade.json");
  const e2e = latestReportBySuffix("-launch-e2e-matrix.json");

  let qaRepo = null;
  if (qa?.data?.results && repoName) {
    qaRepo = qa.data.results.find((r) => String(r.name || "").toLowerCase() === repoName.toLowerCase()) || null;
  }

  let e2eRepo = null;
  if (e2e?.data?.results && repoName) {
    e2eRepo = e2e.data.results.find((r) => String(r.name || "").toLowerCase() === repoName.toLowerCase()) || null;
  }

  let score = 100;
  const findings = [];

  if (qa?.data) {
    const high = Number(qa.data.high_findings || 0);
    if (high > 0) {
      score -= Math.min(35, high * 7);
      findings.push(`${high} high-priority human QA findings in latest run`);
    }
  }

  if (e2e?.data) {
    const blocking = Number(e2e.data.blocking_failures || 0);
    const failures = Number(e2e.data.failures || 0);
    if (blocking > 0) {
      score -= Math.min(45, blocking * 15);
      findings.push(`${blocking} blocking E2E failures in launch matrix`);
    }
    if (failures > 0) {
      score -= Math.min(20, failures * 5);
      findings.push(`${failures} non-blocking E2E failures in launch matrix`);
    }
  }

  if (qaRepo?.findings?.length) {
    score -= Math.min(20, qaRepo.findings.length * 2);
    findings.push(`${qaRepo.findings.length} repo-specific QA findings for ${repoName}`);
  }

  if (e2eRepo?.playwright && e2eRepo.playwright.ok === false) {
    score -= 15;
    findings.push(`${repoName} Playwright smoke check is failing`);
  }

  score = Math.max(0, Math.round(score));
  const grade = score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F";

  return {
    repo: repoName || "portfolio",
    score,
    grade,
    findings,
    source_reports: {
      qa_human: qa?.file || null,
      launch_e2e: e2e?.file || null,
    },
    repo_snapshots: {
      qa: qaRepo,
      e2e: e2eRepo,
    },
    offer_recommendation: score >= 85
      ? "Retainer-ready: pitch optimization + scale package"
      : "Audit-first: sell a paid remediation sprint before retainer"
  };
}

async function buildAuditPack() {
  const repo = arg("--repo", "portfolio");
  const out = {
    generated_at: nowTs(),
    type: "agency_sellable_audit_pack",
    ...scoreFromReports(repo),
    deliverables: [
      "Executive summary and risk score",
      "Prioritized fixes (blocking -> non-blocking)",
      "30-day stabilization plan",
      "Retainer scope suggestion"
    ],
    pricing_guidance: {
      audit_only_usd: [500, 1500],
      setup_training_usd: [2000, 5000],
      monthly_retainer_usd: [500, 2000]
    }
  };

  const files = writeReport("agency-sellable-audit-pack", out);

  const mdPath = path.join(reportDir(), `agency-sellable-audit-pack-latest.md`);
  const lines = [
    `# Agency Sellable Audit Pack`,
    ``,
    `- Generated: ${out.generated_at}`,
    `- Repo: ${out.repo}`,
    `- Score: **${out.score}/100 (${out.grade})**`,
    `- Recommendation: ${out.offer_recommendation}`,
    ``,
    `## Key Findings`,
    ...(out.findings.length ? out.findings.map((f) => `- ${f}`) : ["- No major findings in latest snapshots."]),
    ``,
    `## Packaging`,
    `- Audit: $${out.pricing_guidance.audit_only_usd[0]}-$${out.pricing_guidance.audit_only_usd[1]}`,
    `- Setup + Training: $${out.pricing_guidance.setup_training_usd[0]}-$${out.pricing_guidance.setup_training_usd[1]}`,
    `- Retainer: $${out.pricing_guidance.monthly_retainer_usd[0]}-$${out.pricing_guidance.monthly_retainer_usd[1]}/mo`,
  ];
  fs.writeFileSync(mdPath, `${lines.join("\n")}\n`, "utf8");

  console.log(JSON.stringify({ ok: true, audit_pack: out, files: { ...files, mdPath } }, null, 2));
}

async function proposal() {
  await ensureSchema();
  const account = arg("--account");
  if (!account) throw new Error("--account is required");

  const { rows: acctRows } = await pg.query(
    `SELECT * FROM agency_accounts WHERE id::text=$1 OR lower(name)=lower($1) ORDER BY created_at DESC LIMIT 1`,
    [account]
  );
  if (!acctRows.length) throw new Error(`account not found: ${account}`);

  const accountRow = acctRows[0];
  const { rows: dealRows } = await pg.query(
    `SELECT * FROM agency_deals WHERE account_id=$1 ORDER BY created_at DESC LIMIT 1`,
    [accountRow.id]
  );

  const deal = dealRows[0] || null;
  const setup = Number(deal?.setup_value_usd || accountRow.setup_price_usd || 3500);
  const retainer = Number(deal?.retainer_value_usd || accountRow.retainer_usd || 1250);

  const md = [
    `# OpenClaw Automation Proposal - ${accountRow.name}`,
    ``,
    `## Outcome`,
    `Deploy and operate OpenClaw automations that save operator time, reduce execution errors, and improve speed-to-output.`,
    ``,
    `## Scope`,
    `1. Setup and onboarding`,
    `2. Workflow automation and QA hardening`,
    `3. Weekly optimization and reporting`,
    ``,
    `## Pricing`,
    `- One-time setup + training: **$${setup.toFixed(0)}**`,
    `- Ongoing management retainer: **$${retainer.toFixed(0)}/mo**`,
    ``,
    `## Next Step`,
    `- Approve proposal and schedule kickoff call`,
    ``,
    `Generated at ${nowTs()}`,
  ].join("\n");

  const outDir = path.join(reportDir());
  const safeName = String(accountRow.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const outPath = path.join(outDir, `${Date.now()}-proposal-${safeName}.md`);
  fs.writeFileSync(outPath, md, "utf8");

  await pg.query(
    `INSERT INTO agency_activities (account_id, activity_type, summary, detail)
     VALUES ($1,'proposal_generated',$2,$3::jsonb)`,
    [accountRow.id, `Proposal generated (${setup}/${retainer})`, JSON.stringify({ outPath, setup, retainer })]
  );

  console.log(JSON.stringify({ ok: true, proposal_path: outPath, account: accountRow.name, setup, retainer }, null, 2));
}

function help() {
  console.log(`
Agency Growth OS

Commands:
  plan [--target-monthly 100000 --avg-setup 3500 --avg-retainer 1250 --new-setups-per-month 6]
  account:add --name "Acme" [--segment creator] [--source outbound]
  deal:add --account "Acme" [--stage qualified] [--setup 3500] [--retainer 1250]
  deal:advance --deal <deal_uuid> --stage proposal_sent [--next-action "follow up Tue"]
  case:add --title "SkynPatch growth" [--account "SkynPatch"] [--baseline "..."] [--outcome "..."]
  dashboard
  audit:pack [--repo usipeorg]
  proposal --account "Acme"
`);
}

async function main() {
  if (CMD === "help" || CMD === "--help" || CMD === "-h") return help();
  if (CMD === "plan") {
    const { out, files } = computeModel();
    console.log(JSON.stringify({ ok: true, model: out, files }, null, 2));
    return;
  }
  if (CMD === "account:add") return addAccount();
  if (CMD === "deal:add") return addDeal();
  if (CMD === "deal:advance") return advanceDeal();
  if (CMD === "case:add") return addCaseStudy();
  if (CMD === "dashboard") return dashboard();
  if (CMD === "audit:pack") return buildAuditPack();
  if (CMD === "proposal") return proposal();
  return help();
}

main()
  .catch((err) => {
    console.error("[agency-growth-os] fatal:", err.message || String(err));
    process.exit(1);
  })
  .finally(async () => {
    try { await pg.end(); } catch (_) {}
  });
