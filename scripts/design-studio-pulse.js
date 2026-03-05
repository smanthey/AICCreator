#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const https = require("https");
const { v4: uuidv4 } = require("uuid");

const pg = require("../infra/postgres");
const { resolveRouting, isKnownTaskType } = require("../config/task-routing");
const { validatePayload } = require("../schemas/payloads");
const { buildTaskIdempotencyKey } = require("../control/idempotency");

const ROOT = path.join(__dirname, "..");
const REPORT_DIR = path.join(ROOT, "reports");
const ACTIVE_STATUSES = ["CREATED", "DISPATCHED", "RUNNING", "RETRY", "PENDING_APPROVAL"];
const SOURCE = "design_studio_pulse";

function arg(flag, fallback = null) {
  const args = process.argv.slice(2);
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
}

function has(flag) {
  return process.argv.slice(2).includes(flag);
}

function parseList(raw) {
  return String(raw || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function getJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: "GET", headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 160)}`));
        }
        try {
          resolve(JSON.parse(text));
        } catch (err) {
          reject(new Error(`Invalid JSON: ${err.message}`));
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

const TAG_RULES = [
  { tag: "onboarding", rx: /\bonboard|first.?run|welcome|signup|sign.?up|login|auth\b/i, boost: 4 },
  { tag: "flow_clarity", rx: /\bjourney|funnel|step|wizard|progress|flow|sequence\b/i, boost: 3 },
  { tag: "navigation_ia", rx: /\bnav|navigation|menu|sidebar|tab|information architecture|discoverability\b/i, boost: 3 },
  { tag: "microcopy", rx: /\bcopy|text|label|tooltip|hint|error message|empty state|helper text\b/i, boost: 3 },
  { tag: "forms_friction", rx: /\bform|input|field|validation|autocomplete|drop.?off|friction\b/i, boost: 4 },
  { tag: "visual_hierarchy", rx: /\bhierarchy|spacing|typography|contrast|visual weight|scan\b/i, boost: 2 },
  { tag: "accessibility", rx: /\ba11y|accessibility|screen reader|keyboard|wcag|contrast\b/i, boost: 4 },
  { tag: "mobile_responsive", rx: /\bmobile|responsive|small screen|thumb|touch target|iphone|android\b/i, boost: 3 },
  { tag: "trust_feedback", rx: /\bloading|skeleton|feedback|state|success|error|confirmation|trust\b/i, boost: 3 },
  { tag: "checkout_conversion", rx: /\bcheckout|payment|cart|pricing|trial|conversion|cta\b/i, boost: 4 },
];

function classifyText(text) {
  const tags = [];
  let score = 0;
  const t = String(text || "");
  for (const rule of TAG_RULES) {
    if (rule.rx.test(t)) {
      tags.push(rule.tag);
      score += rule.boost;
    }
  }
  return { tags: [...new Set(tags)], score };
}

function walkFigma(node, visitor) {
  if (!node || typeof node !== "object") return;
  visitor(node);
  const kids = Array.isArray(node.children) ? node.children : [];
  for (const c of kids) walkFigma(c, visitor);
}

async function collectFigmaSignals(fileKeys, figmaToken) {
  if (!figmaToken || !fileKeys.length) return [];
  const out = [];
  for (const key of fileKeys) {
    try {
      const data = await getJson(`https://api.figma.com/v1/files/${encodeURIComponent(key)}`, {
        "X-Figma-Token": figmaToken,
      });
      const counters = { FRAME: 0, COMPONENT: 0, INSTANCE: 0 };
      const names = [];
      walkFigma(data.document, (n) => {
        if (counters[n.type] !== undefined) counters[n.type] += 1;
        if (typeof n.name === "string" && n.name.trim()) names.push(n.name.trim());
      });
      const sampleNames = names.slice(0, 250).join(" | ");
      const cls = classifyText(`${data.name || ""} ${sampleNames}`);
      out.push({
        source: "figma",
        title: `Figma file: ${data.name || key}`,
        url: `https://www.figma.com/file/${key}`,
        score: Math.max(1, cls.score + Math.min(8, Math.floor(counters.FRAME / 40))),
        tags: cls.tags,
        evidence: {
          file_key: key,
          frame_count: counters.FRAME,
          component_count: counters.COMPONENT,
          instance_count: counters.INSTANCE,
          last_modified: data.lastModified || null,
        },
      });
    } catch (err) {
      out.push({
        source: "figma",
        title: `Figma file error: ${key}`,
        url: `https://www.figma.com/file/${key}`,
        score: 1,
        tags: ["integration_health"],
        evidence: { error: err.message },
      });
    }
  }
  return out;
}

async function collectRedditSignals(subreddits, limitPerSub) {
  const out = [];
  for (const sub of subreddits) {
    try {
      const url = `https://www.reddit.com/r/${encodeURIComponent(sub)}/top.json?limit=${limitPerSub}&t=week`;
      const json = await getJson(url, { "User-Agent": "claw-architect-design-studio/1.0" });
      const posts = (((json || {}).data || {}).children || []).map((c) => c.data).filter(Boolean);
      for (const p of posts) {
        const text = `${p.title || ""}\n${p.selftext || ""}`;
        const cls = classifyText(text);
        if (!cls.tags.length) continue;
        out.push({
          source: `reddit:r/${sub}`,
          title: p.title || "(untitled)",
          url: `https://www.reddit.com${p.permalink || ""}`,
          score: Math.max(1, cls.score + Math.round((Number(p.ups || 0) / 50))),
          tags: cls.tags,
          evidence: {
            ups: Number(p.ups || 0),
            comments: Number(p.num_comments || 0),
            created_utc: Number(p.created_utc || 0),
          },
        });
      }
    } catch (err) {
      out.push({
        source: `reddit:r/${sub}`,
        title: "reddit_source_error",
        url: `https://www.reddit.com/r/${sub}`,
        score: 1,
        tags: ["integration_health"],
        evidence: { error: err.message },
      });
    }
  }
  return out;
}

function rankOpportunities(signals, maxItems = 10) {
  const byTag = new Map();
  for (const s of signals) {
    for (const tag of s.tags || []) {
      if (!byTag.has(tag)) {
        byTag.set(tag, { tag, score: 0, sources: new Set(), examples: [] });
      }
      const row = byTag.get(tag);
      row.score += Number(s.score || 0);
      row.sources.add(s.source);
      if (row.examples.length < 5) row.examples.push({ title: s.title, url: s.url, source: s.source });
    }
  }
  return [...byTag.values()]
    .map((r) => ({ ...r, source_count: r.sources.size, sources: [...r.sources] }))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxItems);
}

async function ensureRoutingColumns() {
  await pg.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS required_tags TEXT[] DEFAULT '{}'`);
  await pg.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS idempotency_key TEXT`);
}

async function taskExists(idempotencyKey) {
  const { rows } = await pg.query(
    `SELECT 1 FROM tasks WHERE idempotency_key = $1 AND status = ANY($2::text[]) LIMIT 1`,
    [idempotencyKey, ACTIVE_STATUSES]
  );
  return rows.length > 0;
}

async function createTaskIfNeeded(type, payload, priority = 7, dryRun = false) {
  if (!isKnownTaskType(type)) throw new Error(`Unknown task type: ${type}`);
  validatePayload(type, payload || {});
  const idempotencyKey = buildTaskIdempotencyKey(type, payload || {});
  if (dryRun) return { created: true, dry_run: true, type, payload, idempotencyKey };
  if (await taskExists(idempotencyKey)) return { created: false, reason: "duplicate_active", type, idempotencyKey };
  const routing = resolveRouting(type);
  const id = uuidv4();
  await pg.query(
    `INSERT INTO tasks (id, type, payload, status, priority, worker_queue, required_tags, idempotency_key)
     VALUES ($1,$2,$3::jsonb,'CREATED',$4,$5,$6,$7)`,
    [id, type, JSON.stringify(payload || {}), priority, routing.queue, routing.required_tags, idempotencyKey]
  );
  await pg.query(`SELECT pg_notify('task_created', $1)`, [id]).catch(() => {});
  return { created: true, id, type, idempotencyKey };
}

function writeReport(report) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[.:]/g, "-");
  const jsonPath = path.join(REPORT_DIR, `${stamp}-design-studio-pulse.json`);
  const latestPath = path.join(REPORT_DIR, "design-studio-pulse-latest.json");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(latestPath, JSON.stringify(report, null, 2));
  return { jsonPath, latestPath };
}

async function main() {
  const dryRun = has("--dry-run");
  const queue = has("--no-queue") ? false : true;
  const repos = parseList(arg("--repos", process.env.DESIGN_STUDIO_REPOS || "local/claw-architect"));
  const subreddits = parseList(arg("--subreddits", process.env.DESIGN_STUDIO_SUBREDDITS || "userexperience,UXDesign,web_design,figma,design_critiques"));
  const figmaKeys = parseList(arg("--figma-file-keys", process.env.FIGMA_FILE_KEYS || ""));
  const figmaToken = String(arg("--figma-token", process.env.FIGMA_TOKEN || "")).trim();
  const limitPerSub = Math.max(3, Math.min(50, Number(arg("--limit-per-subreddit", process.env.DESIGN_STUDIO_SUB_LIMIT || "12")) || 12));
  const maxOpportunities = Math.max(3, Math.min(20, Number(arg("--top", process.env.DESIGN_STUDIO_TOP || "10")) || 10));

  await ensureRoutingColumns();

  const [figmaSignals, redditSignals] = await Promise.all([
    collectFigmaSignals(figmaKeys, figmaToken),
    collectRedditSignals(subreddits, limitPerSub),
  ]);
  const signals = [...figmaSignals, ...redditSignals].sort((a, b) => b.score - a.score);
  const opportunities = rankOpportunities(signals, maxOpportunities);

  const queued = [];
  if (queue && opportunities.length > 0) {
    const focusTags = opportunities.slice(0, 5).map((o) => o.tag);
    const evidenceUrls = opportunities.flatMap((o) => o.examples.map((e) => e.url)).slice(0, 8);
    for (const repo of repos) {
      const siteFixPayload = {
        repo,
        source: SOURCE,
        focus_tags: focusTags,
        evidence_urls: evidenceUrls,
      };
      const objective = [
        "Design studio implementation pass:",
        `prioritize ${focusTags.join(", ")}`,
        "tighten onboarding and form friction details,",
        "improve IA clarity and microcopy,",
        "and ship simple, Apple-level flow polish with measurable UX deltas.",
      ].join(" ");
      const opencodePayload = {
        repo,
        source: SOURCE,
        objective,
        max_iterations: 3,
        quality_target: 95,
        auto_iterate: true,
      };
      queued.push(await createTaskIfNeeded("site_fix_plan", siteFixPayload, 8, dryRun));
      queued.push(await createTaskIfNeeded("opencode_controller", opencodePayload, 9, dryRun));
    }
  }

  const report = {
    generated_at: new Date().toISOString(),
    dry_run: dryRun,
    queue_enabled: queue,
    repos,
    inputs: {
      figma_file_keys: figmaKeys.length,
      figma_enabled: Boolean(figmaToken && figmaKeys.length),
      subreddits,
      limit_per_subreddit: limitPerSub,
    },
    totals: {
      signals: signals.length,
      figma_signals: figmaSignals.length,
      reddit_signals: redditSignals.length,
      opportunities: opportunities.length,
      queued_created: queued.filter((q) => q.created).length,
    },
    top_opportunities: opportunities,
    top_signals: signals.slice(0, 25),
    queued,
  };

  const paths = writeReport(report);
  console.log(JSON.stringify({
    ok: true,
    report: paths.jsonPath,
    latest: paths.latestPath,
    signals: report.totals.signals,
    opportunities: report.totals.opportunities,
    queued_created: report.totals.queued_created,
    dry_run: dryRun,
  }, null, 2));
  await pg.end();
}

main().catch(async (err) => {
  console.error("[design-studio-pulse] fatal:", err.message);
  try { await pg.end(); } catch {}
  process.exit(1);
});

