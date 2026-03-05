#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const pg = require("../infra/postgres");

const ROOT = path.join(__dirname, "..");
const REPORT_PATH = path.join(ROOT, "reports", "pattern-robust-builder-latest.json");

const FEATURE_DOMAIN_HINTS = {
  symbol_failure_mapping: ["qa", "agent", "queue"],
  cdp_network_contracts: ["qa", "stripe", "queue"],
  auto_wait_stability: ["qa", "agent"],
  selector_resilience: ["qa", "agent"],
  visual_regression_baselines: ["qa"],
  trace_replay_debug: ["qa", "queue", "agent"],
};

function overlap(tokensA, tokensB) {
  const a = new Set(tokensA);
  let n = 0;
  for (const t of tokensB) {
    if (a.has(t)) n += 1;
  }
  return n;
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9_ -]/g, " ")
    .split(/\s+/)
    .filter((x) => x && x.length >= 3)
    .slice(0, 80);
}

async function ensureSchema() {
  await pg.query(`
    CREATE TABLE IF NOT EXISTS pattern_insights (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      feature_key TEXT NOT NULL,
      domain TEXT NOT NULL,
      insight TEXT NOT NULL,
      confidence INTEGER NOT NULL DEFAULT 0,
      source_keys TEXT[] NOT NULL DEFAULT '{}',
      evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function main() {
  await ensureSchema();

  const report = {
    ok: true,
    generated_at: new Date().toISOString(),
    playbooks_updated: [],
  };

  const { rows: features } = await pg.query(
    `SELECT feature_key, title, summary
       FROM symbol_feature_playbooks
      ORDER BY feature_key`
  );

  const { rows: sourceRows } = await pg.query(
    `SELECT source_key, source_type, domain, title, url, summary, score, metadata
       FROM knowledge_sources
      WHERE status = 'active'`
  );

  const sourceByDomain = new Map();
  for (const s of sourceRows) {
    const key = String(s.domain || "general");
    if (!sourceByDomain.has(key)) sourceByDomain.set(key, []);
    sourceByDomain.get(key).push(s);
  }

  for (const f of features) {
    const featureKey = String(f.feature_key);
    const domainHints = FEATURE_DOMAIN_HINTS[featureKey] || ["agent", "qa"];
    const featureTokens = tokenize(`${f.title || ""} ${f.summary || ""} ${featureKey}`);

    const { rows: symbols } = await pg.query(
      `SELECT repo_key, symbol_name, symbol_file, score
         FROM symbol_exemplar_symbols
        WHERE feature_key = $1
        ORDER BY score DESC, updated_at DESC
        LIMIT 20`,
      [featureKey]
    );

    let candidateSources = [];
    for (const d of domainHints) {
      candidateSources = candidateSources.concat(sourceByDomain.get(d) || []);
    }
    candidateSources = [...new Map(candidateSources.map((c) => [c.source_key, c])).values()];

    const rankedSources = candidateSources
      .map((s) => {
        const text = `${s.title || ""} ${s.summary || ""} ${(s.metadata && JSON.stringify(s.metadata)) || ""}`;
        const score = Number(s.score || 0) + overlap(featureTokens, tokenize(text)) * 6;
        return { ...s, robust_score: score };
      })
      .sort((a, b) => b.robust_score - a.robust_score);

    const topRepos = rankedSources.filter((x) => x.source_type === "repo").slice(0, 4);
    const topPapers = rankedSources.filter((x) => x.source_type === "paper").slice(0, 4);
    const topMixed = [
      ...topRepos.slice(0, 2),
      ...topPapers.slice(0, 4),
      ...topRepos.slice(2, 4),
    ].slice(0, 8);

    const recommendedStack = [
      "symbol-first-failure-mapping",
      "targeted-probe-before-broad-suite",
      "closed-8-step-self-correction-loop",
      ...topRepos.map((r) => `repo:${r.source_key.replace(/^repo:/, "")}`),
      ...topPapers.map((p) => `paper:${p.source_key.replace(/^paper:/, "")}`),
    ].slice(0, 10);

    const insight =
      `Robust pattern for ${featureKey}: prioritize symbols ${symbols.slice(0, 5).map((s) => `${s.symbol_name}@${s.repo_key}`).join(", ")}; ` +
      `cross-check against top repos (${topRepos.map((r) => r.source_key.replace(/^repo:/, "")).join(", ") || "none"}) ` +
      `and papers (${topPapers.map((p) => p.title).join(" | ") || "none"}).`;

    const confidence = Math.max(
      50,
      Math.min(98, Math.round((symbols.slice(0, 8).reduce((n, s) => n + Number(s.score || 0), 0) / 2) + (rankedSources[0]?.robust_score || 0) / 3))
    );

    const evidence = {
      feature_key: featureKey,
      top_symbols: symbols.slice(0, 8),
      top_sources: topMixed.map((s) => ({
        source_key: s.source_key,
        source_type: s.source_type,
        domain: s.domain,
        score: s.score,
        robust_score: s.robust_score,
        url: s.url,
      })),
      generated_at: new Date().toISOString(),
    };

    await pg.query(
      `UPDATE symbol_feature_playbooks
          SET recommended_stack = $2::jsonb,
              implementation_notes = $3,
              updated_at = NOW()
        WHERE feature_key = $1`,
      [featureKey, JSON.stringify(recommendedStack), JSON.stringify(evidence)]
    );

    await pg.query(
      `INSERT INTO pattern_insights
        (feature_key, domain, insight, confidence, source_keys, evidence)
       VALUES
        ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        featureKey,
        domainHints[0] || "general",
        insight,
        confidence,
        topMixed.map((r) => r.source_key),
        JSON.stringify(evidence),
      ]
    );

    report.playbooks_updated.push({
      feature_key: featureKey,
      confidence,
      top_repo_sources: topRepos.map((r) => r.source_key),
      top_paper_sources: topPapers.map((p) => p.source_key),
    });
  }

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((err) => {
    console.error("[pattern-robust-builder] fatal:", err.message);
    process.exit(1);
  })
  .finally(async () => {
    await pg.end().catch(() => {});
  });
