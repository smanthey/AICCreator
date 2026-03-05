#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const ARGS = process.argv.slice(2);
const CMD = (ARGS[0] || "gaps").toLowerCase();

const ROOT = path.join(__dirname, "..");
const REPORT_DIR = path.join(__dirname, "reports");
const SKILLS_DIR = path.join(ROOT, "agents", "skills");

function arg(flag, fallback = null) {
  const i = ARGS.indexOf(flag);
  if (i < 0 || i + 1 >= ARGS.length) return fallback;
  return ARGS[i + 1];
}

function boolArg(flag) {
  return ARGS.includes(flag);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function latest(fileName) {
  return path.join(REPORT_DIR, fileName);
}

function nowIso() {
  return new Date().toISOString();
}

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 58);
}

function titleCase(s) {
  return String(s || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function listExistingSkillIds() {
  ensureDir(SKILLS_DIR);
  return new Set(
    fs
      .readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  );
}

function scorePrice(freq) {
  if (freq >= 5) return { price: 49, model: "subscription" };
  if (freq >= 3) return { price: 39, model: "one_time" };
  if (freq >= 2) return { price: 29, model: "one_time" };
  return { price: 19, model: "one_time" };
}

function classifyOpportunity(summary) {
  const s = String(summary || "").toLowerCase();
  const rules = [
    {
      re: /(invoice|billing|excel|google sheets|handwritten|manually)/,
      id: "invoice-ops-automation-starter",
      name: "Invoice Ops Automation Starter Skill",
      problem: "Invoicing and ops are handled manually across spreadsheets and ad-hoc processes",
      audience: "small_business,freelance",
    },
    {
      re: /(manuals|user guides|translation|different formats|documentation)/,
      id: "multiformat-doc-localizer",
      name: "Multi-Format Doc Localizer Skill",
      problem: "Business documentation is scattered across formats and hard to localize consistently",
      audience: "small_business,content_creators",
    },
    {
      re: /(too expensive|moved on|cost)/,
      id: "cost-down-stack-migrator",
      name: "Cost-Down Stack Migrator Skill",
      problem: "Teams churn from software due to cost and need lower-cost alternatives with migration plans",
      audience: "small_business,freelance,agencies",
    },
    {
      re: /(manual process|manual processes|repetitive|wasting time|bottleneck)/,
      id: "ops-automation-audit-pack",
      name: "Ops Automation Audit Pack Skill",
      problem: "Core operations rely on repetitive manual workflows that block growth",
      audience: "small_business,freelance,content_creators",
    },
  ];
  for (const r of rules) {
    if (r.re.test(s)) return r;
  }
  const baseId = slugify(summary) || "workflow-pain-skill";
  return {
    id: `workflow-${baseId}`.slice(0, 58),
    name: `${titleCase(summary)} Skill`,
    problem: summary,
    audience: "small_business,freelance,content_creators",
  };
}

function extractOpportunities() {
  const pain = readJsonSafe(latest("saas-pain-opportunity-report-latest.json")) || {};
  const reddit = readJsonSafe(latest("reddit-digest-latest.json")) || {};

  const opportunities = [];
  const pains = Array.isArray(pain.top_pain_points) ? pain.top_pain_points : [];

  for (const p of pains) {
    const summary = p.summary || p.key || "Unmet workflow pain point";
    const cls = classifyOpportunity(summary);
    const skillId = `clawhub-${cls.id}`.slice(0, 64);
    const freq = Number(p.frequency || 1);
    const priceMeta = scorePrice(freq);
    opportunities.push({
      skill_id: skillId,
      name: cls.name,
      problem_summary: cls.problem || summary,
      audience: cls.audience,
      frequency: freq,
      price_usd: priceMeta.price,
      billing_model: priceMeta.model,
      evidence: (p.examples || []).slice(0, 4),
      product_angles: Array.isArray(p.angles) && p.angles.length
        ? p.angles
        : ["Operational workflow accelerator with templates and QA checks"],
      source_report: "saas-pain-opportunity-report-latest.json",
    });
  }

  const redditHints = [];
  const results = Array.isArray(reddit.results) ? reddit.results : [];
  for (const r of results) {
    for (const post of r.posts || []) {
      const t = String(post.title || "").toLowerCase();
      if (t.includes("workflow") || t.includes("guide") || t.includes("benchmark") || t.includes("automation")) {
        redditHints.push({
          title: post.title,
          url: post.url,
          subreddit: r.subreddit,
        });
      }
    }
  }

  if (redditHints.length) {
    opportunities.push({
      skill_id: "clawhub-research-backed-workflow-pack",
      name: "Research Backed Workflow Pack Skill",
      problem_summary: "Teams need production-ready workflow templates instead of generic prompts",
      audience: "small_business,freelance,content_creators",
      frequency: redditHints.length,
      price_usd: 39,
      billing_model: "one_time",
      evidence: redditHints.slice(0, 5),
      product_angles: [
        "Workflow pack with ready checklists, launch templates, and failure handling",
      ],
      source_report: "reddit-digest-latest.json",
    });
  }

  // De-dupe by skill_id and keep highest frequency
  const byId = new Map();
  for (const o of opportunities) {
    const prev = byId.get(o.skill_id);
    if (!prev || (o.frequency || 0) > (prev.frequency || 0)) {
      byId.set(o.skill_id, o);
      continue;
    }
    if ((o.frequency || 0) === (prev.frequency || 0)) {
      byId.set(o.skill_id, {
        ...prev,
        evidence: [...(prev.evidence || []), ...(o.evidence || [])].slice(0, 6),
        product_angles: [...new Set([...(prev.product_angles || []), ...(o.product_angles || [])])].slice(0, 4),
      });
    }
  }

  return Array.from(byId.values()).sort((a, b) => (b.frequency || 0) - (a.frequency || 0));
}

function buildSkillMarkdown(skill) {
  return [
    `# ${skill.name}`,
    "",
    "## Outcome",
    `Deliver a repeatable workflow that solves: ${skill.problem_summary}.`,
    "",
    "## Target Users",
    `${skill.audience.replace(/,/g, ", ")}`,
    "",
    "## Inputs",
    "- Business context and workflow constraints",
    "- Current tools and bottlenecks",
    "- Success metric (time saved, revenue lift, error reduction)",
    "",
    "## Outputs",
    "- Action plan with phased implementation",
    "- Implementation checklist",
    "- Risk and QA verification steps",
    "",
    "## Workflow",
    "1. Clarify current workflow and identify one bottleneck to remove first.",
    "2. Generate implementation options ranked by ROI and setup cost.",
    "3. Produce execution checklist with owner, due date, and validation step.",
    "4. Add failure modes and rollback path before deployment.",
    "5. Return concise deliverables suitable for immediate execution.",
    "",
    "## Edge Cases",
    "- Missing key inputs: return a minimal questionnaire and proceed with assumptions.",
    "- Incomplete data: suggest safe defaults and tag uncertainty.",
    "- Policy/compliance constraints: downgrade risky actions and provide compliant alternatives.",
    "",
    "## Quality Bar",
    "- No filler language",
    "- Concrete steps with measurable outcomes",
    "- Implementation-safe recommendations",
    "",
  ].join("\n");
}

function buildListingMarkdown(skill) {
  const useCases = [
    "Turn repetitive manual tasks into reusable automations",
    "Create production-ready SOPs for agents and operators",
    "Reduce implementation errors with built-in QA checkpoints",
  ];
  return [
    `# ${skill.name} - ClawHub Listing`,
    "",
    "## One-liner",
    `${skill.problem_summary}. This skill turns that pain into a deployable workflow in one run.`,
    "",
    "## Best For",
    `- ${skill.audience.replace(/,/g, "\n- ")}`,
    "",
    "## Use Cases",
    ...useCases.map((u) => `- ${u}`),
    "",
    "## Deliverables",
    "- Structured implementation plan",
    "- Risk checks and fallback strategy",
    "- Next sprint task breakdown",
    "",
    "## Pricing",
    `- Recommended: $${skill.price_usd}/${skill.billing_model === "subscription" ? "month" : "skill"}`,
    "- Bundle option: 3 skills for 15% discount",
    "",
    "## Proof",
    ...(skill.evidence && skill.evidence.length
      ? skill.evidence.map((e) => `- ${e.title || e.channel || "signal"}: ${e.link || e.url || "n/a"}`)
      : ["- Backed by recurring workflow pain signals from research pipeline."]),
    "",
  ].join("\n");
}

function buildTestCasesMarkdown(skill) {
  return [
    `# ${skill.name} - Test Cases`,
    "",
    "## Functional",
    "1. Valid brief with clear bottleneck -> returns phased implementation plan.",
    "2. Multiple bottlenecks -> prioritizes by ROI and risk.",
    "3. Existing stack conflict -> suggests adapter/fallback.",
    "",
    "## Edge Cases",
    "4. Missing KPIs -> generates assumptions and asks only critical follow-ups.",
    "5. Missing compliance context -> outputs safe-mode recommendations.",
    "6. Empty workflow description -> returns intake questionnaire, not hallucinated plan.",
    "",
    "## Quality Checks",
    "7. Output includes measurable success metric and owner fields.",
    "8. No banned fluff words or repetitive sentence starts.",
    "9. Contains rollback/failure handling before any irreversible step.",
    "",
    "## Pass Criteria",
    "- At least 9/9 checks pass",
    "- Edge cases produce safe and actionable output",
    "",
  ].join("\n");
}

function scaffoldSkill(skill, apply) {
  const dir = path.join(SKILLS_DIR, skill.skill_id);
  const exists = fs.existsSync(dir);
  if (!apply) {
    return { skill_id: skill.skill_id, path: dir, created: false, exists };
  }

  ensureDir(dir);
  ensureDir(path.join(dir, "prompts"));

  const taskName = `${skill.skill_id.toUpperCase().replace(/-/g, "_")}_RUN`;
  const skillJson = {
    id: skill.skill_id,
    name: skill.name,
    version: "1.0.0",
    description: skill.problem_summary,
    tasks: [taskName],
    tags: ["clawhub", "marketplace", "automation"],
    author: "claw-architect",
    pricing: {
      usd: skill.price_usd,
      model: skill.billing_model,
    },
  };

  const indexJs = [
    `// ${skill.skill_id}/index.js`,
    "'use strict';",
    "",
    "async function run(payload = {}) {",
    "  const problem = payload.problem || payload.input || 'workflow bottleneck';",
    "  return {",
    "    ok: true,",
    "    skill: '" + skill.skill_id + "',",
    "    recommendation: [",
    "      `Define baseline KPI for ${problem}` ,",
    "      'Implement one high-ROI automation first',",
    "      'Run QA validation and rollback check before production'",
    "    ],",
    "  };",
    "}",
    "",
    "module.exports = { run };",
    "",
  ].join("\n");

  fs.writeFileSync(path.join(dir, "skill.json"), JSON.stringify(skillJson, null, 2));
  fs.writeFileSync(path.join(dir, "SKILL.md"), buildSkillMarkdown(skill));
  fs.writeFileSync(path.join(dir, "README.md"), buildSkillMarkdown(skill));
  fs.writeFileSync(path.join(dir, "TEST_CASES.md"), buildTestCasesMarkdown(skill));
  fs.writeFileSync(path.join(dir, "LISTING.md"), buildListingMarkdown(skill));
  fs.writeFileSync(path.join(dir, "pricing.json"), JSON.stringify({
    skill_id: skill.skill_id,
    usd: skill.price_usd,
    model: skill.billing_model,
    bundle_discount_pct: 15,
  }, null, 2));
  fs.writeFileSync(path.join(dir, "index.js"), indexJs);
  fs.writeFileSync(path.join(dir, "prompts", "default.md"), [
    "You are executing a ClawHub marketplace skill.",
    `Skill: ${skill.name}`,
    "Return concise, actionable outputs with measurable outcomes.",
  ].join("\n"));

  return { skill_id: skill.skill_id, path: dir, created: !exists, exists };
}

function writeReport(name, payload) {
  ensureDir(REPORT_DIR);
  const stamp = new Date().toISOString().replace(/[.:]/g, "-");
  const json = path.join(REPORT_DIR, `${stamp}-${name}.json`);
  const md = path.join(REPORT_DIR, `${stamp}-${name}.md`);
  const latestJson = path.join(REPORT_DIR, `${name}-latest.json`);
  const latestMd = path.join(REPORT_DIR, `${name}-latest.md`);
  fs.writeFileSync(json, JSON.stringify(payload, null, 2));
  fs.writeFileSync(latestJson, JSON.stringify(payload, null, 2));

  const lines = [
    `# ${name}`,
    "",
    `Generated: ${payload.generated_at || nowIso()}`,
    "",
    "## Summary",
    `- total: ${payload.total || 0}`,
    `- selected: ${payload.selected || 0}`,
    "",
  ];
  for (const row of payload.items || []) {
    lines.push(`## ${row.skill_id || row.name}`);
    if (row.problem_summary) lines.push(`- Problem: ${row.problem_summary}`);
    if (row.frequency != null) lines.push(`- Frequency: ${row.frequency}`);
    if (row.price_usd != null) lines.push(`- Price: $${row.price_usd}`);
    if (row.path) lines.push(`- Path: ${row.path}`);
    lines.push("");
  }

  fs.writeFileSync(md, lines.join("\n"));
  fs.writeFileSync(latestMd, lines.join("\n"));
  return { json, md, latestJson, latestMd };
}

function cmdGaps() {
  const top = Math.max(1, Math.min(20, Number(arg("--top", "10")) || 10));
  const existing = listExistingSkillIds();
  const opps = extractOpportunities().filter((o) => !existing.has(o.skill_id)).slice(0, top);
  const payload = {
    generated_at: nowIso(),
    total: opps.length,
    selected: opps.length,
    items: opps,
  };
  const out = writeReport("clawhub-skill-gaps", payload);
  console.log(JSON.stringify({ ok: true, ...out, opportunities: opps.length }, null, 2));
}

function cmdBuild() {
  const top = Math.max(1, Math.min(20, Number(arg("--top", "5")) || 5));
  const apply = boolArg("--apply");
  const existing = listExistingSkillIds();
  const selected = extractOpportunities().filter((o) => !existing.has(o.skill_id)).slice(0, top);

  const actions = selected.map((s) => scaffoldSkill(s, apply));
  const payload = {
    generated_at: nowIso(),
    apply,
    total: selected.length,
    selected: selected.length,
    items: selected.map((s, i) => ({ ...s, ...actions[i] })),
  };
  const out = writeReport("clawhub-skill-build", payload);
  console.log(JSON.stringify({ ok: true, ...out, apply, built: selected.length }, null, 2));
}

function validateSkillDir(dir) {
  const required = ["skill.json", "SKILL.md", "TEST_CASES.md", "LISTING.md", "pricing.json", "index.js"];
  const missing = required.filter((f) => !fs.existsSync(path.join(dir, f)));
  const findings = [];

  let parsedSkill = null;
  let parsedPricing = null;
  if (!missing.includes("skill.json")) {
    try {
      parsedSkill = JSON.parse(fs.readFileSync(path.join(dir, "skill.json"), "utf8"));
    } catch {
      findings.push("skill.json is not valid JSON");
    }
  }
  if (!missing.includes("pricing.json")) {
    try {
      parsedPricing = JSON.parse(fs.readFileSync(path.join(dir, "pricing.json"), "utf8"));
    } catch {
      findings.push("pricing.json is not valid JSON");
    }
  }

  if (!missing.includes("SKILL.md")) {
    const text = fs.readFileSync(path.join(dir, "SKILL.md"), "utf8").toLowerCase();
    ["## outcome", "## workflow", "## edge cases"].forEach((k) => {
      if (!text.includes(k)) findings.push(`SKILL.md missing section: ${k}`);
    });
  }

  if (!missing.includes("TEST_CASES.md")) {
    const text = fs.readFileSync(path.join(dir, "TEST_CASES.md"), "utf8").toLowerCase();
    if (!text.includes("edge cases")) findings.push("TEST_CASES.md missing edge-case section");
    const checks = (text.match(/^\d+\./gm) || []).length;
    if (checks < 6) findings.push("TEST_CASES.md should include at least 6 numbered tests");
  }

  if (parsedPricing && (parsedPricing.usd == null || parsedPricing.usd < 10 || parsedPricing.usd > 50)) {
    findings.push("pricing.json usd should be between 10 and 50 for marketplace target");
  }

  if (parsedSkill && (!Array.isArray(parsedSkill.tasks) || parsedSkill.tasks.length === 0)) {
    findings.push("skill.json requires at least one task");
  }

  return {
    skill_id: path.basename(dir),
    path: dir,
    missing,
    findings,
    pass: missing.length === 0 && findings.length === 0,
  };
}

function cmdTest() {
  ensureDir(SKILLS_DIR);
  const target = arg("--skill", null);
  const dirs = fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(SKILLS_DIR, d.name))
    .filter((d) => !target || path.basename(d) === target);

  const results = dirs.map(validateSkillDir);
  const pass = results.filter((r) => r.pass).length;
  const fail = results.length - pass;
  const payload = {
    generated_at: nowIso(),
    total: results.length,
    selected: results.length,
    pass,
    fail,
    items: results,
  };
  const out = writeReport("clawhub-skill-test", payload);
  console.log(JSON.stringify({ ok: fail === 0, ...out, pass, fail }, null, 2));
  if (fail > 0) process.exitCode = 1;
}

async function withPg(fn) {
  const pg = require("../infra/postgres");
  try {
    await fn(pg);
  } finally {
    try {
      await pg.end();
    } catch {}
  }
}

async function ensureDbSchema(pg) {
  // Check if migration has been applied
  const { rows } = await pg.query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables 
      WHERE table_name = 'clawhub_skill_catalog'
    ) as exists
  `);
  
  if (!rows[0].exists) {
    throw new Error('Migration 068 must be applied first. Run: node scripts/run-migrations.js --only 068');
  }
}

async function cmdSalesLog() {
  const skillId = arg("--skill");
  const name = arg("--name", skillId || "Unknown Skill");
  const price = Number(arg("--price", "0")) || 0;
  const qty = Math.max(1, Number(arg("--qty", "1")) || 1);
  const model = arg("--model", "one_time");
  const channel = arg("--channel", "clawhub");
  const buyerRef = arg("--buyer", null);
  const notes = arg("--notes", null);
  if (!skillId) throw new Error("--skill is required");

  await withPg(async (pg) => {
    await ensureDbSchema(pg);
    await pg.query(
      `INSERT INTO clawhub_skill_catalog (skill_id, name, price_usd, billing_model, listing_status)
       VALUES ($1,$2,$3,$4,'published')
       ON CONFLICT (skill_id) DO UPDATE SET
         name = EXCLUDED.name,
         price_usd = EXCLUDED.price_usd,
         billing_model = EXCLUDED.billing_model,
         updated_at = NOW()`,
      [skillId, name, price, model]
    );

    const { rows } = await pg.query(
      `INSERT INTO clawhub_skill_sales (skill_id, channel, quantity, unit_price_usd, buyer_ref, notes)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, skill_id, quantity, unit_price_usd, gross_usd, sold_at`,
      [skillId, channel, qty, price, buyerRef, notes]
    );
    console.log(JSON.stringify({ ok: true, sale: rows[0] }, null, 2));
  });
}

async function cmdFeedbackLog() {
  const skillId = arg("--skill");
  const rating = Number(arg("--rating", "0")) || null;
  const sentiment = arg("--sentiment", null);
  const notes = arg("--notes", null);
  const source = arg("--source", "clawhub");
  if (!skillId) throw new Error("--skill is required");

  await withPg(async (pg) => {
    await ensureDbSchema(pg);
    const { rows } = await pg.query(
      `INSERT INTO clawhub_skill_feedback (skill_id, source, rating, sentiment, notes)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, skill_id, rating, sentiment, created_at`,
      [skillId, source, rating, sentiment, notes]
    );
    console.log(JSON.stringify({ ok: true, feedback: rows[0] }, null, 2));
  });
}

async function cmdSalesReport() {
  await withPg(async (pg) => {
    await ensureDbSchema(pg);
    const { rows } = await pg.query(`
      WITH sales AS (
        SELECT
          skill_id,
          COUNT(*) AS sale_events,
          COALESCE(SUM(quantity),0)::int AS units,
          COALESCE(SUM(gross_usd),0)::numeric(12,2) AS gross_usd
        FROM clawhub_skill_sales
        GROUP BY skill_id
      ),
      fb AS (
        SELECT
          skill_id,
          ROUND(AVG(rating)::numeric,2) AS avg_rating,
          COUNT(*) AS feedback_count
        FROM clawhub_skill_feedback
        GROUP BY skill_id
      )
      SELECT
        c.skill_id,
        c.name,
        c.price_usd,
        c.billing_model,
        COALESCE(s.sale_events,0)::int AS sale_events,
        COALESCE(s.units,0)::int AS units,
        COALESCE(s.gross_usd,0)::numeric(12,2) AS gross_usd,
        fb.avg_rating,
        COALESCE(fb.feedback_count,0)::int AS feedback_count
      FROM clawhub_skill_catalog c
      LEFT JOIN sales s ON s.skill_id = c.skill_id
      LEFT JOIN fb ON fb.skill_id = c.skill_id
      ORDER BY gross_usd DESC, units DESC, c.skill_id ASC
    `);

    const out = {
      generated_at: nowIso(),
      total_skills: rows.length,
      total_gross_usd: Number(rows.reduce((sum, r) => sum + Number(r.gross_usd || 0), 0).toFixed(2)),
      items: rows,
    };

    const report = writeReport("clawhub-skill-sales", {
      generated_at: out.generated_at,
      total: out.total_skills,
      selected: out.items.length,
      items: out.items,
      total_gross_usd: out.total_gross_usd,
    });

    console.log(JSON.stringify({ ok: true, ...out, reports: report }, null, 2));
  });
}

async function cmdSyncCatalog() {
  ensureDir(SKILLS_DIR);
  const dirs = fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  const rows = [];
  for (const id of dirs) {
    const dir = path.join(SKILLS_DIR, id);
    const meta = readJsonSafe(path.join(dir, "skill.json")) || {};
    const pricing = readJsonSafe(path.join(dir, "pricing.json")) || {};
    rows.push({
      skill_id: id,
      name: meta.name || titleCase(id.replace(/^clawhub-/, "").replace(/-/g, " ")),
      problem_summary: meta.description || "",
      audience: "small_business,freelance,content_creators",
      price_usd: Number(pricing.usd || meta.pricing?.usd || 0),
      billing_model: pricing.model || meta.pricing?.model || "one_time",
      listing_status: "testing",
      source_report: "clawhub-skill-build-latest.json",
    });
  }

  await withPg(async (pg) => {
    await ensureDbSchema(pg);
    for (const r of rows) {
      await pg.query(
        `INSERT INTO clawhub_skill_catalog
          (skill_id, name, problem_summary, audience, price_usd, billing_model, listing_status, source_report)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (skill_id) DO UPDATE SET
          name = EXCLUDED.name,
          problem_summary = EXCLUDED.problem_summary,
          audience = EXCLUDED.audience,
          price_usd = EXCLUDED.price_usd,
          billing_model = EXCLUDED.billing_model,
          listing_status = EXCLUDED.listing_status,
          source_report = EXCLUDED.source_report,
          updated_at = NOW()`,
        [r.skill_id, r.name, r.problem_summary, r.audience, r.price_usd, r.billing_model, r.listing_status, r.source_report]
      );
    }
    console.log(JSON.stringify({ ok: true, synced: rows.length }, null, 2));
  });
}

async function main() {
  ensureDir(REPORT_DIR);
  ensureDir(SKILLS_DIR);

  switch (CMD) {
    case "gaps":
      cmdGaps();
      return;
    case "build":
      cmdBuild();
      return;
    case "test":
      cmdTest();
      return;
    case "sales-log":
      await cmdSalesLog();
      return;
    case "feedback-log":
      await cmdFeedbackLog();
      return;
    case "sales-report":
      await cmdSalesReport();
      return;
    case "sync-catalog":
      await cmdSyncCatalog();
      return;
    case "help":
    default:
      console.log(`ClawHub Skill Factory\n\nCommands:\n  gaps [--top 10]\n  build [--top 5] [--apply]\n  test [--skill <id>]\n  sync-catalog\n  sales-log --skill <id> --name <name> --price <usd> [--qty 1] [--channel clawhub]\n  feedback-log --skill <id> [--rating 1-5] [--sentiment positive|neutral|negative] [--notes text]\n  sales-report\n`);
  }
}

main().catch((err) => {
  console.error("[clawhub-skill-factory] fatal:", err.message);
  process.exit(1);
});
