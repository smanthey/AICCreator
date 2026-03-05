#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

require("dotenv").config({ path: path.join(__dirname, "../.env") });

const pg = require("../infra/postgres");
const { resolveRouting, isKnownTaskType } = require("../config/task-routing");
const { validatePayload } = require("../schemas/payloads");
const { buildTaskIdempotencyKey } = require("../control/idempotency");
const { enqueueClosedLoopChain } = require("../control/closed-loop");
const { enqueueOnce } = require("../core/queue");

const ROOT = path.join(__dirname, "..");
const INDEX_DIR = path.join(process.env.HOME || os.homedir(), ".code-index");
const REPORT_PATH = path.join(ROOT, "reports", "symbolic-qa-hub-latest.json");
const EXEMPLAR_REPOS_PATH = path.join(ROOT, "data", "exemplar-repos.json");
const ACTIVE_TASK_STATUSES = ["CREATED", "DISPATCHED", "RUNNING", "RETRY", "PENDING_APPROVAL"];

const TOP_N_PER_FEATURE = Math.max(
  5,
  Math.min(25, Number.parseInt(String(process.env.SYMBOLIC_QA_TOP_N || "12"), 10) || 12)
);
const ENQUEUE_IMPLEMENTATION = String(process.env.SYMBOLIC_QA_ENQUEUE_IMPL || "true").toLowerCase() !== "false";

const EXEMPLAR_REPOS_BASELINE = [
  { repo_key: "local/quantfusion", source_url: null, category: "internal_priority", notes: "Primary build target" },
  { repo_key: "local/claw-architect", source_url: null, category: "internal_core", notes: "Dispatcher/worker baseline" },
  { repo_key: "local/payclaw", source_url: null, category: "internal_product", notes: "PayClaw flows" },
  { repo_key: "local/autopay_ui", source_url: "https://github.com/smanthey/autopay_ui", category: "internal_exemplar", notes: null },
  { repo_key: "local/CaptureInbound", source_url: "https://github.com/smanthey/CaptureInbound", category: "internal_exemplar", notes: null },
  { repo_key: "cypress-io/cypress", source_url: "https://github.com/cypress-io/cypress", category: "oss_qa", notes: null },
  { repo_key: "microsoft/playwright", source_url: "https://github.com/microsoft/playwright", category: "oss_qa", notes: null },
  { repo_key: "webdriverio/webdriverio", source_url: "https://github.com/webdriverio/webdriverio", category: "oss_qa", notes: null },
  { repo_key: "seleniumhq/selenium", source_url: "https://github.com/SeleniumHQ/selenium", category: "oss_qa", notes: null },
  { repo_key: "puppeteer/puppeteer", source_url: "https://github.com/puppeteer/puppeteer", category: "oss_qa", notes: null },
  { repo_key: "DevExpress/testcafe", source_url: "https://github.com/DevExpress/testcafe", category: "oss_qa", notes: null },
  { repo_key: "garris/BackstopJS", source_url: "https://github.com/garris/BackstopJS", category: "oss_visual", notes: null },
  { repo_key: "grafana/k6", source_url: "https://github.com/grafana/k6", category: "oss_perf", notes: "Browser+perf probes" },
];

function loadExemplarReposData() {
  try {
    return JSON.parse(fs.readFileSync(EXEMPLAR_REPOS_PATH, "utf8"));
  } catch {
    return null;
  }
}

function getExemplarRepos() {
  const data = loadExemplarReposData();
  const seen = new Set(EXEMPLAR_REPOS_BASELINE.map((m) => m.repo_key));
  const out = [...EXEMPLAR_REPOS_BASELINE];
  if (Array.isArray(data?.context_repos)) {
    for (const repo_key of data.context_repos) {
      if (repo_key && !seen.has(repo_key)) {
        seen.add(repo_key);
        out.push({ repo_key, source_url: null, category: "oss_benchmark", notes: "From exemplar-repos.json" });
      }
    }
  }
  return out;
}

const EXEMPLAR_REPOS = getExemplarRepos();

const FEATURE_MAP = [
  {
    key: "symbol_failure_mapping",
    title: "Failure to symbol mapping",
    summary:
      "Map runtime/browser failures to owning symbols and enqueue deterministic repair tasks before broad debugging.",
    keywords: ["error", "stack", "trace", "symbol", "owner", "triage", "mapping", "failure", "exception"],
    recommended_stack: ["filesystem-rg-symbol-map-index", "repomap", "pm2-failure-symbol-triage", "targeted-smoke"],
  },
  {
    key: "cdp_network_contracts",
    title: "CDP network and API contracts",
    summary:
      "Use CDP-level network/console instrumentation to assert API contracts, failed requests, and browser error budgets quickly.",
    keywords: ["cdp", "network", "request", "response", "console", "assert", "contract", "har", "intercept"],
    recommended_stack: ["puppeteer-cdp", "playwright-tracing", "schema-assertions", "fast-api-probes"],
  },
  {
    key: "auto_wait_stability",
    title: "Auto wait and flake resistance",
    summary:
      "Prefer deterministic waits and retry primitives over static sleeps to reduce flaky regressions and reruns.",
    keywords: ["wait", "retry", "timeout", "flake", "stability", "poll", "backoff", "eventually"],
    recommended_stack: ["explicit-condition-waits", "bounded-retry", "idempotent-steps"],
  },
  {
    key: "selector_resilience",
    title: "Selector resilience and accessibility probes",
    summary:
      "Use semantic selectors and accessibility-aware queries that survive layout changes.",
    keywords: ["selector", "locator", "aria", "role", "testid", "accessibility", "label", "query"],
    recommended_stack: ["semantic-locators", "a11y-tree-checks", "fallback-selector-policy"],
  },
  {
    key: "visual_regression_baselines",
    title: "Visual regression baseline fastlane",
    summary:
      "Run low-noise screenshot diffs with deterministic viewports and threshold tuning for fast UI regression checks.",
    keywords: ["visual", "snapshot", "screenshot", "diff", "baseline", "threshold", "pixelmatch"],
    recommended_stack: ["baseline-snapshots", "pixel-diff", "masked-dynamic-zones"],
  },
  {
    key: "trace_replay_debug",
    title: "Trace replay and debug artifacts",
    summary:
      "Persist traces/videos/logs for high-value failures so agents can repair without rerunning full suites.",
    keywords: ["trace", "record", "video", "artifact", "debug", "replay", "har", "console"],
    recommended_stack: ["trace-artifacts", "artifact-index", "failure-replay"],
  },
];

let _routingColsEnsured = false;

function repoIndexPath(repoKey) {
  return path.join(INDEX_DIR, `${String(repoKey).replace(/\//g, "-")}.json`);
}

function readIndex(repoKey) {
  const fp = repoIndexPath(repoKey);
  try {
    const raw = fs.readFileSync(fp, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function tokenize(words) {
  return words
    .map((w) => String(w || "").toLowerCase().trim())
    .filter((w) => w.length >= 3);
}

function scoreSymbol(sym, tokens) {
  if (!sym || !tokens.length) return 0;
  const hay = [
    sym.name,
    sym.qualified_name,
    sym.signature,
    sym.summary,
    sym.docstring,
    sym.file,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  let score = 0;
  for (const t of tokens) {
    if (hay.includes(t)) score += 1;
  }
  if (/(test|spec|assert|expect|wait|retry|trace|webhook|queue|worker)/i.test(String(sym.name || ""))) {
    score += 1;
  }
  return score;
}

function topSymbolsForFeature(index, feature, limit = TOP_N_PER_FEATURE) {
  const tokens = tokenize(feature.keywords || []);
  const symbols = Array.isArray(index?.symbols) ? index.symbols : [];
  return symbols
    .map((s) => ({ s, score: scoreSymbol(s, tokens) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => ({
      symbol_id: x.s.id,
      symbol_name: x.s.name || "",
      symbol_kind: x.s.kind || null,
      symbol_file: x.s.file || "",
      symbol_signature: x.s.signature || null,
      symbol_summary: x.s.summary || x.s.docstring || null,
      language: x.s.language || null,
      score: x.score,
    }));
}

async function ensureSchema() {
  const ddl = [
    `
    CREATE TABLE IF NOT EXISTS symbol_exemplar_repos (
      repo_key TEXT PRIMARY KEY,
      source_url TEXT,
      category TEXT NOT NULL DEFAULT 'general',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      notes TEXT,
      last_seen_indexed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
    `
    CREATE TABLE IF NOT EXISTS symbol_exemplar_symbols (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      repo_key TEXT NOT NULL REFERENCES symbol_exemplar_repos(repo_key) ON DELETE CASCADE,
      feature_key TEXT NOT NULL,
      symbol_id TEXT NOT NULL,
      symbol_name TEXT NOT NULL,
      symbol_kind TEXT,
      symbol_file TEXT NOT NULL,
      symbol_signature TEXT,
      symbol_summary TEXT,
      language TEXT,
      score INTEGER NOT NULL DEFAULT 0,
      source_indexed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (repo_key, feature_key, symbol_id)
    )
  `,
    `
    CREATE TABLE IF NOT EXISTS symbol_feature_playbooks (
      feature_key TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      recommended_stack JSONB NOT NULL DEFAULT '[]'::jsonb,
      implementation_notes TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  ];

  // If another worker is running DDL at the same time, tolerate type-name race errors.
  for (const q of ddl) {
    try {
      await pg.query(q);
    } catch (err) {
      const msg = String(err?.message || "");
      if (!msg.includes("pg_type_typname_nsp_index")) throw err;
    }
  }
}

async function ensureRoutingColumns() {
  if (_routingColsEnsured) return;
  await pg.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS required_tags TEXT[] DEFAULT '{}'`);
  await pg.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS idempotency_key TEXT`);
  _routingColsEnsured = true;
}

async function taskExists(idempotencyKey) {
  const { rows } = await pg.query(
    `SELECT 1
       FROM tasks
      WHERE idempotency_key = $1
        AND status = ANY($2::text[])
      LIMIT 1`,
    [idempotencyKey, ACTIVE_TASK_STATUSES]
  );
  return rows.length > 0;
}

async function enqueueTask(type, payload) {
  return enqueueOnce({ type, payload, activeStatuses: ACTIVE_TASK_STATUSES });
}

async function upsertRepo(meta, indexedAt) {
  await pg.query(
    `INSERT INTO symbol_exemplar_repos
      (repo_key, source_url, category, notes, last_seen_indexed_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (repo_key)
     DO UPDATE SET
       source_url = EXCLUDED.source_url,
       category = EXCLUDED.category,
       notes = EXCLUDED.notes,
       last_seen_indexed_at = EXCLUDED.last_seen_indexed_at,
       updated_at = NOW()`,
    [meta.repo_key, meta.source_url, meta.category, meta.notes || null, indexedAt]
  );
}

async function upsertFeaturePlaybook(feature) {
  await pg.query(
    `INSERT INTO symbol_feature_playbooks
      (feature_key, title, summary, recommended_stack, implementation_notes, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, NOW())
     ON CONFLICT (feature_key)
     DO UPDATE SET
       title = EXCLUDED.title,
       summary = EXCLUDED.summary,
       recommended_stack = EXCLUDED.recommended_stack,
       implementation_notes = EXCLUDED.implementation_notes,
       updated_at = NOW()`,
    [
      feature.key,
      feature.title,
      feature.summary,
      JSON.stringify(feature.recommended_stack || []),
      "Prefer symbol-first QA. Route failure diagnostics to owning symbols and run targeted checks before full E2E.",
    ]
  );
}

async function upsertSymbols(repoKey, featureKey, indexTs, symbols) {
  for (const sym of symbols) {
    await pg.query(
      `INSERT INTO symbol_exemplar_symbols
        (repo_key, feature_key, symbol_id, symbol_name, symbol_kind, symbol_file, symbol_signature, symbol_summary, language, score, source_indexed_at, updated_at)
       VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
       ON CONFLICT (repo_key, feature_key, symbol_id)
       DO UPDATE SET
         symbol_name = EXCLUDED.symbol_name,
         symbol_kind = EXCLUDED.symbol_kind,
         symbol_file = EXCLUDED.symbol_file,
         symbol_signature = EXCLUDED.symbol_signature,
         symbol_summary = EXCLUDED.symbol_summary,
         language = EXCLUDED.language,
         score = EXCLUDED.score,
         source_indexed_at = EXCLUDED.source_indexed_at,
         updated_at = NOW()`,
      [
        repoKey,
        featureKey,
        sym.symbol_id,
        sym.symbol_name || "unknown",
        sym.symbol_kind,
        sym.symbol_file || "unknown",
        sym.symbol_signature,
        sym.symbol_summary,
        sym.language,
        sym.score || 0,
        indexTs,
      ]
    );
  }
}

function objectiveFromTopSymbols(featureKey, topSymbols) {
  const lines = topSymbols
    .slice(0, 8)
    .map((s, i) => `${i + 1}. [${s.repo_key}] ${s.symbol_name} (${s.symbol_file}) score=${s.score}`)
    .join("\n");
  return (
    `Build/upgrade feature "${featureKey}" using symbol-native QA architecture.\n` +
    `Required:\n` +
    `- Use filesystem MCP + rg symbol-map indexing first (no jcodemunch), then repo_mapper when available.\n` +
    `- Reuse best exemplar symbols below.\n` +
    `- Implement 1-2 deterministic improvements with tests/smokes.\n` +
    `- Capture outcomes in docs for lightweight micro-SaaS reuse.\n\n` +
    `Top symbols:\n${lines}`
  );
}

async function enqueueImplementationTasks(report) {
  if (!ENQUEUE_IMPLEMENTATION) return;

  const topByFeature = {};
  for (const r of report.features) {
    topByFeature[r.feature_key] = (r.top_symbols || []).slice(0, 8);
  }

  const targets = [
    { repo: "local/quantfusion", feature_key: "cdp_network_contracts" },
    { repo: "local/quantfusion", feature_key: "symbol_failure_mapping" },
    { repo: "local/claw-architect", feature_key: "symbol_failure_mapping" },
    { repo: "local/payclaw", feature_key: "auto_wait_stability" },
  ];

  for (const t of targets) {
    const topSymbols = topByFeature[t.feature_key] || [];
    const payload = {
      repo: t.repo,
      source: "symbolic_qa_hub",
      feature_key: t.feature_key,
      objective: objectiveFromTopSymbols(t.feature_key, topSymbols),
      force_implement: true,
      max_iterations: 2,
      quality_target: 92,
    };
    const queued = await enqueueTask("opencode_controller", payload);
    report.queued_tasks.push({ repo: t.repo, feature_key: t.feature_key, ...queued });
  }

  // Closed dev loop: enqueue strict 8-step dependency chains (test -> symbol map -> fix -> retest).
  const loopTargets = [
    { repo: "local/quantfusion", feature_key: "cdp_network_contracts" },
    { repo: "local/quantfusion", feature_key: "symbol_failure_mapping" },
    { repo: "local/payclaw", feature_key: "auto_wait_stability" },
  ];
  for (const lt of loopTargets) {
    const objective =
      `Run closed improvement loop for ${lt.repo} (${lt.feature_key}): ` +
      `targeted probes -> failure-to-symbol mapping -> minimal fixes -> targeted retest -> broader verification.`;
    const queued = await enqueueClosedLoopChain({
      repo: lt.repo,
      feature_key: lt.feature_key,
      source: "symbolic_qa_hub_closed_loop",
      objective,
      quality_target: 92,
    });
    report.queued_tasks.push({ repo: lt.repo, feature_key: lt.feature_key, ...queued });
  }
}

async function main() {
  await ensureSchema();

  const report = {
    ok: true,
    generated_at: new Date().toISOString(),
    top_n_per_feature: TOP_N_PER_FEATURE,
    repos_total: EXEMPLAR_REPOS.length,
    repos_indexed: 0,
    repos_missing_index: [],
    features: [],
    queued_tasks: [],
  };

  for (const feature of FEATURE_MAP) {
    await upsertFeaturePlaybook(feature);
  }

  for (const meta of EXEMPLAR_REPOS) {
    const idx = readIndex(meta.repo_key);
    const idxTs = idx?.indexed_at ? new Date(idx.indexed_at).toISOString() : null;
    await upsertRepo(meta, idxTs);

    if (!idx || !Array.isArray(idx.symbols) || idx.symbols.length === 0) {
      report.repos_missing_index.push(meta.repo_key);
      continue;
    }

    report.repos_indexed += 1;

    for (const feature of FEATURE_MAP) {
      const top = topSymbolsForFeature(idx, feature, TOP_N_PER_FEATURE);
      await upsertSymbols(meta.repo_key, feature.key, idxTs, top);
    }
  }

  for (const feature of FEATURE_MAP) {
    const { rows } = await pg.query(
      `SELECT repo_key, symbol_id, symbol_name, symbol_file, score
         FROM symbol_exemplar_symbols
        WHERE feature_key = $1
        ORDER BY score DESC, updated_at DESC
        LIMIT $2`,
      [feature.key, TOP_N_PER_FEATURE]
    );
    report.features.push({
      feature_key: feature.key,
      title: feature.title,
      top_symbols: rows,
    });
  }

  if (report.repos_missing_index.length > 0) {
    for (const repoKey of report.repos_missing_index.slice(0, 8)) {
      const payload = {
        repo: "local/claw-architect",
        source: "symbolic_qa_hub_index_gap",
        feature_key: "index_backfill",
        objective:
          `Index missing exemplar repo "${repoKey}" with filesystem MCP + rg + local symbol-map scripts (no jcodemunch), then refresh symbolic QA hub.\n` +
          `Required: filesystem MCP + rg symbol map refresh -> repo_mapper (if available) -> verify top symbols for QA features in DB.`,
        force_implement: true,
        max_iterations: 1,
      };
      const queued = await enqueueTask("opencode_controller", payload);
      report.queued_tasks.push({ repo: "local/claw-architect", feature_key: "index_backfill", target_repo: repoKey, ...queued });
    }
  }

  await enqueueImplementationTasks(report);

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((err) => {
    console.error("[symbolic-qa-hub] fatal:", err.message);
    process.exit(1);
  })
  .finally(async () => {
    await pg.end().catch(() => {});
  });
