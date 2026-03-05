#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const pg = require("../infra/postgres");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const ARGS = process.argv.slice(2);
const CMD = (ARGS[0] || "help").toLowerCase();
const REPORT_DIR = path.join(__dirname, "reports");

function arg(flag, fallback = null) {
  const i = ARGS.indexOf(flag);
  if (i < 0 || i + 1 >= ARGS.length) return fallback;
  return ARGS[i + 1];
}

function toNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function ensureReportDir() {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
}

function writeReport(name, payload) {
  ensureReportDir();
  const stamp = new Date().toISOString().replace(/[.:]/g, "-");
  const jsonPath = path.join(REPORT_DIR, `${stamp}-${name}.json`);
  const mdPath = path.join(REPORT_DIR, `${stamp}-${name}.md`);
  const latestJson = path.join(REPORT_DIR, `${name}-latest.json`);
  const latestMd = path.join(REPORT_DIR, `${name}-latest.md`);

  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
  fs.writeFileSync(latestJson, JSON.stringify(payload, null, 2));

  const md = [];
  md.push(`# ${name}`);
  md.push("");
  md.push(`Generated: ${payload.generated_at || nowIso()}`);
  md.push("");
  if (Array.isArray(payload.items)) {
    for (const item of payload.items) {
      md.push(`## ${item.name || item.slug || item.title || "entry"}`);
      Object.entries(item).forEach(([k, v]) => {
        if (k === "name") return;
        if (typeof v === "object") md.push(`- ${k}: \`${JSON.stringify(v)}\``);
        else md.push(`- ${k}: ${v}`);
      });
      md.push("");
    }
  }
  fs.writeFileSync(mdPath, md.join("\n"));
  fs.writeFileSync(latestMd, md.join("\n"));
  return { jsonPath, mdPath, latestJson, latestMd };
}

function serviceCatalog() {
  return [
    {
      slug: "research-reports-fast",
      category: "research_reports",
      name: "Research Reports (Fast Decision Brief)",
      summary: "Market and competitor intelligence report with clear decision paths.",
      price_min_usd: 50,
      price_max_usd: 200,
      delivery_window_days: 2,
      inclusions: [
        "Problem framing and target audience profile",
        "Competitor scan with pricing/features",
        "Risk and opportunity summary",
        "Action plan with 3 execution options",
      ],
      upsell_paths: ["weekly-research-retainer", "deep-dive-technical-due-diligence"],
      ideal_keywords: ["research", "analysis", "competitor", "market", "strategy"],
    },
    {
      slug: "content-writing-conversion-pack",
      category: "content_writing_packages",
      name: "Content Writing Packages (Conversion Focus)",
      summary: "Website/email/social copy package designed for conversion and speed.",
      price_min_usd: 100,
      price_max_usd: 500,
      delivery_window_days: 4,
      inclusions: [
        "Tone and offer audit",
        "1-3 core pages or campaign assets",
        "CTA and objection-handling pass",
        "Revision round with implementation notes",
      ],
      upsell_paths: ["monthly-content-ops", "seo-aeo-optimization-add-on"],
      ideal_keywords: ["copy", "content", "landing page", "email", "social"],
    },
    {
      slug: "automation-build-sprint",
      category: "automation_builds",
      name: "Automation Builds (Agent + Workflow Sprint)",
      summary: "Build and ship a production automation with QA and handoff docs.",
      price_min_usd: 200,
      price_max_usd: 2000,
      delivery_window_days: 7,
      inclusions: [
        "Workflow design and implementation",
        "Error handling and retries",
        "Monitoring and runbook",
        "Client handoff documentation",
      ],
      upsell_paths: ["ongoing-automation-management", "multi-system-integration-pack"],
      ideal_keywords: ["automation", "integration", "workflow", "agent", "api", "webhook"],
    },
    {
      slug: "data-analysis-clarity-pack",
      category: "data_analysis",
      name: "Data Analysis (KPI Clarity Pack)",
      summary: "Actionable KPI analysis with anomaly detection and decision-ready dashboards.",
      price_min_usd: 50,
      price_max_usd: 300,
      delivery_window_days: 3,
      inclusions: [
        "KPI baseline and trend breakdown",
        "Anomaly and risk notes",
        "Recommendations ranked by impact",
        "Dashboard-ready summary tables",
      ],
      upsell_paths: ["daily-kpi-monitoring", "predictive-forecast-module"],
      ideal_keywords: ["data", "dashboard", "kpi", "analytics", "reporting", "metrics"],
    },
  ];
}

function marketplaceTargets() {
  return [
    { slug: "47jobs", audience: "AI agent operators and buyers", positioning: "execution-first automation services" },
    { slug: "upwork", audience: "SMBs, founders, agencies", positioning: "clear scope + fast delivery" },
    { slug: "contra", audience: "creator and startup teams", positioning: "specialist productized outcomes" },
    { slug: "fiverr-pro", audience: "task-oriented buyers", positioning: "fixed-scope packages" },
    { slug: "toptal-projects", audience: "higher-ticket clients", positioning: "reliability and systems depth" },
  ];
}

function listingCopy(service, marketplace) {
  const budgetLine = `$${service.price_min_usd}-$${service.price_max_usd}`;
  const deliverables = service.inclusions.map((x) => `- ${x}`).join("\n");
  const useCases = [
    "Need outcomes, not vague AI output",
    "Need a fast path from idea to shipped workflow",
    "Need quality controls so nothing breaks in production",
  ];

  return {
    marketplace: marketplace.slug,
    service_slug: service.slug,
    title: `${service.name} | ${marketplace.positioning}`,
    short_pitch: `${service.summary} Delivered in ${service.delivery_window_days} days with measurable outputs.`,
    description: [
      `I help ${marketplace.audience} ship ${service.category.replace(/_/g, " ")} with zero fluff and clear ROI.`,
      "",
      "What you get:",
      deliverables,
      "",
      "Best fit:",
      ...useCases.map((u) => `- ${u}`),
      "",
      `Budget: ${budgetLine}`,
      `Timeline: ${service.delivery_window_days} days`,
      "",
      "If you send your current process and goal, I will return a concrete execution plan and start implementation immediately.",
    ].join("\n"),
    pricing: {
      min: service.price_min_usd,
      max: service.price_max_usd,
      model: "fixed_scope",
    },
  };
}

async function ensureSchema() {
  const pg = require("../infra/postgres");
  // Check if migration has been applied
  const { rows } = await pg.query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables 
      WHERE table_name = 'marketplace_services'
    ) as exists
  `);
  
  if (!rows[0].exists) {
    throw new Error('Migration 069 must be applied first. Run: node scripts/run-migrations.js --only 069');
  }
}

async function syncCatalog() {
  await ensureSchema();
  const services = serviceCatalog();
  for (const s of services) {
    await pg.query(
      `INSERT INTO marketplace_service_offers
        (slug, category, name, summary, price_min_usd, price_max_usd, delivery_window_days, inclusions, upsell_paths, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,TRUE)
       ON CONFLICT (slug) DO UPDATE SET
         category=EXCLUDED.category,
         name=EXCLUDED.name,
         summary=EXCLUDED.summary,
         price_min_usd=EXCLUDED.price_min_usd,
         price_max_usd=EXCLUDED.price_max_usd,
         delivery_window_days=EXCLUDED.delivery_window_days,
         inclusions=EXCLUDED.inclusions,
         upsell_paths=EXCLUDED.upsell_paths,
         active=TRUE,
         updated_at=NOW()`,
      [
        s.slug,
        s.category,
        s.name,
        s.summary,
        s.price_min_usd,
        s.price_max_usd,
        s.delivery_window_days,
        JSON.stringify(s.inclusions),
        JSON.stringify(s.upsell_paths),
      ]
    );
  }
  return services;
}

async function cmdCatalog() {
  const services = await syncCatalog();
  const out = {
    generated_at: nowIso(),
    marketplaces: marketplaceTargets(),
    items: services,
  };
  const files = writeReport("marketplace-service-catalog", out);
  console.log(JSON.stringify({ ok: true, services: services.length, ...files }, null, 2));
}

async function cmdListings() {
  const services = await syncCatalog();
  const targetsArg = arg("--marketplaces", "47jobs,upwork,contra,fiverr-pro,toptal-projects");
  const targets = targetsArg.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  const markets = marketplaceTargets().filter((m) => targets.includes(m.slug));

  const listings = [];
  for (const m of markets) {
    for (const s of services) listings.push(listingCopy(s, m));
  }

  const out = {
    generated_at: nowIso(),
    selected_marketplaces: markets.map((m) => m.slug),
    items: listings,
  };
  const files = writeReport("marketplace-service-listings", out);
  console.log(JSON.stringify({ ok: true, listings: listings.length, ...files }, null, 2));
}

async function cmdJobAdd() {
  await ensureSchema();
  const marketplace = arg("--marketplace", "47jobs");
  const externalId = arg("--external-id", null);
  const title = arg("--title", null);
  const description = arg("--description", null);
  if (!title || !description) {
    throw new Error("--title and --description are required");
  }
  const budgetMin = toNum(arg("--budget-min", "0"), 0);
  const budgetMax = toNum(arg("--budget-max", "0"), 0);
  const contactName = arg("--contact-name", null);
  const contactEmail = arg("--contact-email", null);
  const jobUrl = arg("--job-url", null);

  let rows;
  if (externalId) {
    ({ rows } = await pg.query(
      `INSERT INTO marketplace_jobs
        (marketplace, external_job_id, title, description, budget_min_usd, budget_max_usd, contact_name, contact_email, job_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (marketplace, external_job_id)
       DO UPDATE SET
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         budget_min_usd = EXCLUDED.budget_min_usd,
         budget_max_usd = EXCLUDED.budget_max_usd,
         contact_name = EXCLUDED.contact_name,
         contact_email = EXCLUDED.contact_email,
         job_url = EXCLUDED.job_url,
         updated_at = NOW()
       RETURNING id, marketplace, title, status, created_at`,
      [marketplace, externalId, title, description, budgetMin || null, budgetMax || null, contactName, contactEmail, jobUrl]
    ));
  } else {
    ({ rows } = await pg.query(
      `INSERT INTO marketplace_jobs
        (marketplace, title, description, budget_min_usd, budget_max_usd, contact_name, contact_email, job_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, marketplace, title, status, created_at`,
      [marketplace, title, description, budgetMin || null, budgetMax || null, contactName, contactEmail, jobUrl]
    ));
  }

  console.log(JSON.stringify({ ok: true, job: rows[0] }, null, 2));
}

function triageMatch(job, offers) {
  const text = `${job.title} ${job.description}`.toLowerCase();
  let best = null;

  for (const o of offers) {
    const kws = Array.isArray(o.ideal_keywords) ? o.ideal_keywords : [];
    let hits = 0;
    for (const kw of kws) {
      if (text.includes(String(kw).toLowerCase())) hits += 1;
    }
    const confidence = kws.length ? hits / kws.length : 0;
    if (!best || confidence > best.confidence) {
      best = { offer: o, confidence, hits };
    }
  }

  const budget = Number(job.budget_max_usd || job.budget_min_usd || 0);
  const urgencyBoost = /urgent|asap|today|immediately/.test(text) ? 0.1 : 0;
  const priority = (best ? best.confidence : 0) * 0.7 + Math.min(1, budget / 2000) * 0.2 + urgencyBoost;

  if (!best) {
    return {
      offer: null,
      confidence: 0,
      priority,
      recommendation: "No direct offer match. Route to manual review and propose discovery call.",
      price: null,
    };
  }

  const o = best.offer;
  const midpoint = Math.round((Number(o.price_min_usd) + Number(o.price_max_usd)) / 2);
  const recommendation = [
    `Match to ${o.name}`,
    `Lead with fixed scope at $${midpoint}`,
    "Offer add-on retainer after first delivery",
  ].join(". ");

  return {
    offer: o,
    confidence: Number(best.confidence.toFixed(4)),
    priority: Number(priority.toFixed(4)),
    recommendation,
    price: midpoint,
  };
}

async function cmdJobTriage() {
  await ensureSchema();
  const limit = Math.max(1, Math.min(200, toNum(arg("--limit", "25"), 25)));
  const { rows: offersRaw } = await pg.query(`
    SELECT slug, category, name, summary, price_min_usd, price_max_usd, delivery_window_days, inclusions, upsell_paths
    FROM marketplace_service_offers
    WHERE active = TRUE
  `);

  const offers = offersRaw.map((o) => ({
    ...o,
    ideal_keywords: (() => {
      const byCat = {
        research_reports: ["research", "analysis", "market", "competitor", "report"],
        content_writing_packages: ["copy", "content", "landing", "email", "social", "script"],
        automation_builds: ["automation", "api", "integration", "agent", "workflow", "webhook"],
        data_analysis: ["data", "dashboard", "kpi", "analytics", "metrics", "reporting"],
      };
      return byCat[o.category] || ["workflow", "automation"];
    })(),
  }));

  const { rows: jobs } = await pg.query(
    `SELECT * FROM marketplace_jobs WHERE status='new' ORDER BY created_at ASC LIMIT $1`,
    [limit]
  );

  const triaged = [];
  for (const job of jobs) {
    const m = triageMatch(job, offers);
    await pg.query(
      `INSERT INTO marketplace_job_triage
        (job_id, matched_offer_slug, confidence, priority_score, triage_notes, proposal_summary, recommended_price_usd)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        job.id,
        m.offer?.slug || null,
        m.confidence,
        m.priority,
        m.recommendation,
        m.recommendation,
        m.price,
      ]
    );

    await pg.query(`UPDATE marketplace_jobs SET status='triaged', updated_at=NOW() WHERE id=$1`, [job.id]);

    triaged.push({
      job_id: job.id,
      title: job.title,
      marketplace: job.marketplace,
      matched_offer: m.offer?.slug || null,
      confidence: m.confidence,
      priority_score: m.priority,
      recommended_price_usd: m.price,
      recommendation: m.recommendation,
    });
  }

  const out = {
    generated_at: nowIso(),
    items: triaged,
  };
  const files = writeReport("marketplace-job-triage", out);
  console.log(JSON.stringify({ ok: true, triaged: triaged.length, ...files }, null, 2));
}

async function cmdDashboard() {
  await ensureSchema();
  const { rows } = await pg.query(`
    SELECT
      (SELECT COUNT(*)::int FROM marketplace_service_offers WHERE active=TRUE) AS active_services,
      (SELECT COUNT(*)::int FROM marketplace_jobs) AS jobs_total,
      (SELECT COUNT(*)::int FROM marketplace_jobs WHERE status='new') AS jobs_new,
      (SELECT COUNT(*)::int FROM marketplace_jobs WHERE status='triaged') AS jobs_triaged,
      (SELECT COUNT(*)::int FROM marketplace_jobs WHERE status='proposal_ready') AS jobs_proposal_ready,
      (SELECT COUNT(*)::int FROM marketplace_jobs WHERE status='won') AS jobs_won,
      (SELECT COUNT(*)::int FROM marketplace_jobs WHERE status='lost') AS jobs_lost
  `);

  console.log(JSON.stringify({ ok: true, dashboard: rows[0] || {} }, null, 2));
}

function usage() {
  console.log(`Marketplace Services OS

Commands:
  catalog
  listings [--marketplaces 47jobs,upwork,contra,fiverr-pro,toptal-projects]
  jobs:add --marketplace 47jobs --external-id abc --title "..." --description "..." [--budget-min 100 --budget-max 500 --contact-name "..." --contact-email "..." --job-url "..."]
  jobs:triage [--limit 25]
  dashboard
`);
}

(async function main() {
  try {
    if (CMD === "catalog") return await cmdCatalog();
    if (CMD === "listings") return await cmdListings();
    if (CMD === "jobs:add") return await cmdJobAdd();
    if (CMD === "jobs:triage") return await cmdJobTriage();
    if (CMD === "dashboard") return await cmdDashboard();
    usage();
  } catch (err) {
    console.error("[marketplace-services-os] fatal:", err.message || String(err));
    process.exitCode = 1;
  } finally {
    try { await pg.end(); } catch {}
  }
})();
