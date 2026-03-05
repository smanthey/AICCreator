#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const pg = require("../infra/postgres");

const ROOT = path.join(__dirname, "..");
const INDEX_DIR = path.join(process.env.HOME || os.homedir(), ".code-index");
const EXEMPLAR_REPOS_PATH = path.join(ROOT, "data", "exemplar-repos.json");
const MIN_DELTA = Number(process.env.FEATURE_BENCHMARK_MIN_DELTA || "0.25");
const TOP_N = Math.max(5, Math.min(10, Number(process.env.FEATURE_BENCHMARK_TOP_N || "10")));
const WRITE_DB = !process.argv.includes("--dry-run");
const SOURCE = getArg("--source", "manual");
const REPO = getArg("--repo", "local/claw-architect");
const FEATURE_ARG = getArg("--feature", "");

const FEATURE_CATALOG = [
  { key: "stripe_checkout", label: "Stripe Checkout reliability", tags: ["stripe", "checkout", "payment", "metadata", "retry"] },
  { key: "stripe_webhooks", label: "Stripe webhook idempotency", tags: ["stripe", "webhook", "idempotency", "signature", "event"] },
  { key: "sms_compliance", label: "Telnyx SMS compliance flow", tags: ["telnyx", "sms", "stop", "help", "opt", "webhook"] },
  { key: "email_delivery", label: "Email delivery resilience", tags: ["email", "delivery", "retry", "bounce", "provider"] },
  { key: "queue_backpressure", label: "Queue backpressure and retries", tags: ["queue", "retry", "backoff", "dead", "worker"] },
  { key: "auth_session", label: "Auth/session hardening", tags: ["auth", "session", "token", "login", "oauth"] },
  { key: "observability", label: "Observability and audit trails", tags: ["observability", "logging", "metrics", "audit", "trace"] },
  { key: "api_contracts", label: "API contract validation", tags: ["api", "schema", "validation", "contract", "zod"] },
  { key: "data_integrity", label: "Data integrity and migrations", tags: ["database", "migration", "integrity", "constraint", "transaction"] },
  { key: "desktop_packaging", label: "Desktop packaging and runtime hardening", tags: ["electron", "macos", "packaging", "dmg", "runtime"] },
  { key: "symbolic_qa_engine", label: "Symbol-aware QA engine", tags: ["qa", "symbol", "triage", "assertion", "repro"] },
  { key: "cdp_contract_probe", label: "CDP contract probes", tags: ["cdp", "network", "console", "browser", "contract"] },
  { key: "visual_regression_fastlane", label: "Visual regression fastlane", tags: ["visual", "regression", "snapshot", "diff", "baseline"] },
];

const EXEMPLAR_LIBRARY = [
  { repo: "local/autopay_ui", tags: ["stripe", "checkout", "payment", "webhook", "sms"] },
  { repo: "local/CaptureInbound", tags: ["stripe", "email", "queue", "api"] },
  { repo: "local/veritap_2026", tags: ["auth", "api", "webhook", "logging"] },
  { repo: "local/claw-architect", tags: ["queue", "pm2", "dispatcher", "observability", "qa"] },
  { repo: "local/quantfusion", tags: ["api", "queue", "observability", "retry"] },
  { repo: "local/payclaw", tags: ["stripe", "telnyx", "sms", "webhook", "email"] },
  { repo: "cypress-io/cypress", tags: ["qa", "assertion", "retry", "browser"] },
  { repo: "webdriverio/webdriverio", tags: ["qa", "browser", "retry"] },
  { repo: "seleniumhq/selenium", tags: ["qa", "browser", "webdriver"] },
  { repo: "puppeteer/puppeteer", tags: ["browser", "cdp", "qa"] },
  { repo: "DevExpress/testcafe", tags: ["qa", "assertion", "browser"] },
  { repo: "garris/BackstopJS", tags: ["visual", "regression", "snapshot"] },
  { repo: "grafana/k6", tags: ["performance", "browser", "qa", "cdp"] },
  { repo: "triggerdotdev/trigger.dev", tags: ["workflow", "retry", "queue", "durable"] },
  { repo: "medusajs/medusa", tags: ["checkout", "payment", "api", "auth"] },
];

function getArg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  if (i < 0 || i + 1 >= process.argv.length) return fallback;
  const v = String(process.argv[i + 1] || "").trim();
  return v || fallback;
}

function repoIndexPath(repoKey) {
  return path.join(INDEX_DIR, `${String(repoKey).replace(/\//g, "-")}.json`);
}

function readIndex(repoKey) {
  try {
    return JSON.parse(fs.readFileSync(repoIndexPath(repoKey), "utf8"));
  } catch {
    return null;
  }
}

function tokenizedFeature(feature) {
  return (feature.tags || []).map((t) => String(t || "").toLowerCase()).filter(Boolean);
}

function scoreSymbol(sym, tokens) {
  const hay = [
    sym?.name,
    sym?.qualified_name,
    sym?.signature,
    sym?.summary,
    sym?.docstring,
    sym?.file,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  let points = 0;
  for (const t of tokens) {
    if (hay.includes(t)) points += 1;
  }
  if (/(test|spec|assert|retry|idempot|webhook|trace|audit|metrics|schema|queue)/i.test(hay)) points += 1;
  return points;
}

function rawFeatureScore(index, feature) {
  const symbols = Array.isArray(index?.symbols) ? index.symbols : [];
  if (!symbols.length) return { raw: 0, matched: 0, symbols: 0, depth: 0 };
  const tokens = tokenizedFeature(feature);
  const scored = symbols.map((s) => scoreSymbol(s, tokens));
  const matchedScores = scored.filter((x) => x > 0);
  const matched = matchedScores.length;
  const avgDepth = matched ? matchedScores.reduce((a, b) => a + b, 0) / matched : 0;
  const coveragePct = (matched / symbols.length) * 100;
  const depthScore = Math.min(100, avgDepth * 25);
  const raw = Math.max(0, Math.min(100, coveragePct * 0.55 + depthScore * 0.45));
  return { raw, matched, symbols: symbols.length, depth: avgDepth };
}

function loadExemplarRepos() {
  try {
    return JSON.parse(fs.readFileSync(EXEMPLAR_REPOS_PATH, "utf8"));
  } catch {
    return null;
  }
}

function pickTopExemplars(feature, topN = TOP_N) {
  const tags = new Set(tokenizedFeature(feature));
  const exemplarData = loadExemplarRepos();

  if (exemplarData?.by_feature_tags && typeof exemplarData.by_feature_tags === "object") {
    const scoreByRepo = new Map();
    for (const [tag, list] of Object.entries(exemplarData.by_feature_tags)) {
      if (!tags.has(tag) || !Array.isArray(list)) continue;
      for (const e of list) {
        const repo = e.repo || "";
        if (!repo) continue;
        scoreByRepo.set(repo, (scoreByRepo.get(repo) || 0) + 1);
      }
    }
    let candidates = [...scoreByRepo.entries()]
      .filter(([, score]) => score > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN * 2)
      .map(([repo]) => repo);
    candidates = candidates.filter((r) => r !== REPO && readIndex(r));
    if (candidates.length >= Math.min(3, topN)) {
      return candidates.slice(0, topN);
    }
  }

  return EXEMPLAR_LIBRARY
    .map((x) => ({ repo: x.repo, score: (x.tags || []).filter((t) => tags.has(t)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map((x) => x.repo);
}

function round2(n) {
  return Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
}

async function previousScore(repoKey, featureKey) {
  const { rows } = await pg.query(
    `SELECT feature_score
       FROM public.feature_benchmark_scores
      WHERE repo_key = $1
        AND feature_key = $2
      ORDER BY created_at DESC
      LIMIT 1`,
    [repoKey, featureKey]
  );
  return rows[0] ? Number(rows[0].feature_score) : null;
}

async function createRun(repoKey, source) {
  const { rows } = await pg.query(
    `INSERT INTO public.feature_benchmark_runs (repo_key, source, run_date)
     VALUES ($1, $2, CURRENT_DATE)
     RETURNING id`,
    [repoKey, source]
  );
  return rows[0].id;
}

async function insertScore(runId, row) {
  await pg.query(
    `INSERT INTO public.feature_benchmark_scores
      (run_id, repo_key, feature_key, feature_label, feature_score, exemplar_mean_score, exemplar_top_score,
       compared_repo_count, compared_repo_keys, previous_score, delta_score, improved, benchmark_payload)
     VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9::text[],$10,$11,$12,$13::jsonb)`,
    [
      runId,
      row.repo_key,
      row.feature_key,
      row.feature_label,
      row.feature_score,
      row.exemplar_mean_score,
      row.exemplar_top_score,
      row.compared_repo_count,
      row.compared_repo_keys,
      row.previous_score,
      row.delta_score,
      row.improved,
      JSON.stringify(row.benchmark_payload || {}),
    ]
  );
}

async function main() {
  const target = readIndex(REPO);
  if (!target) throw new Error(`index_not_found:${repoIndexPath(REPO)}`);

  const selected = FEATURE_ARG
    ? FEATURE_CATALOG.filter((f) => f.key === FEATURE_ARG)
    : FEATURE_CATALOG;
  if (!selected.length) throw new Error(`unknown_feature:${FEATURE_ARG}`);

  const runRows = [];
  const runId = WRITE_DB ? await createRun(REPO, SOURCE) : null;

  for (const feature of selected) {
    const targetRaw = rawFeatureScore(target, feature);
    const exemplarRepos = pickTopExemplars(feature, TOP_N).filter((r) => r !== REPO);
    const exemplarStats = exemplarRepos
      .map((repo) => ({ repo, index: readIndex(repo) }))
      .filter((x) => !!x.index)
      .map((x) => ({ repo: x.repo, raw: rawFeatureScore(x.index, feature).raw }))
      .sort((a, b) => b.raw - a.raw)
      .slice(0, TOP_N);

    const exemplarScores = exemplarStats.map((x) => x.raw);
    const exemplarMean = exemplarScores.length
      ? exemplarScores.reduce((a, b) => a + b, 0) / exemplarScores.length
      : 1;
    const exemplarTop = exemplarScores.length ? Math.max(...exemplarScores) : exemplarMean;
    const normalized = exemplarMean > 0 ? Math.min(100, (targetRaw.raw / exemplarMean) * 100) : targetRaw.raw;
    const prev = WRITE_DB ? await previousScore(REPO, feature.key) : null;
    const delta = prev == null ? null : normalized - prev;
    const nearCeiling = prev != null && prev >= 99.5;
    const improved = prev == null ? true : (nearCeiling ? normalized >= prev - 0.1 : delta > MIN_DELTA);

    const row = {
      repo_key: REPO,
      feature_key: feature.key,
      feature_label: feature.label,
      feature_score: round2(normalized),
      exemplar_mean_score: round2(exemplarMean),
      exemplar_top_score: round2(exemplarTop),
      compared_repo_count: exemplarStats.length,
      compared_repo_keys: exemplarStats.map((x) => x.repo),
      previous_score: prev == null ? null : round2(prev),
      delta_score: delta == null ? null : round2(delta),
      improved,
      benchmark_payload: {
        min_delta: MIN_DELTA,
        near_ceiling_rule_applied: nearCeiling,
        target_raw: round2(targetRaw.raw),
        target_matched_symbols: targetRaw.matched,
        target_symbol_count: targetRaw.symbols,
        target_avg_depth: round2(targetRaw.depth),
        exemplar_raw_scores: exemplarStats.map((x) => ({ repo: x.repo, raw: round2(x.raw) })),
      },
    };

    if (WRITE_DB && runId) await insertScore(runId, row);
    runRows.push(row);
  }

  const report = {
    ok: true,
    generated_at: new Date().toISOString(),
    repo: REPO,
    source: SOURCE,
    run_id: runId,
    top_n: TOP_N,
    min_delta: MIN_DELTA,
    rows: runRows,
  };
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((err) => {
    console.error("[feature-benchmark-score] fatal:", err.message);
    process.exit(1);
  })
  .finally(async () => {
    await pg.end().catch(() => {});
  });
