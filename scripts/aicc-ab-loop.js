#!/usr/bin/env node
"use strict";

/**
 * aicc-ab-loop.js
 * Scores campaign variants from retention/CTR metrics and promotes winners.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const REPORTS = path.join(ROOT, "reports");

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  if (i < 0 || i + 1 >= process.argv.length) return fallback;
  return String(process.argv[i + 1] || "").trim() || fallback;
}

function readJson(file, fallback = null) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function normalizeMetric(m, key) {
  const v = Number(m?.[key]);
  return Number.isFinite(v) ? v : 0;
}

function scoreMetricSet(metric) {
  const retention = normalizeMetric(metric, "retention_30s_pct");
  const ctr = normalizeMetric(metric, "ctr_pct");
  const watch = normalizeMetric(metric, "avg_watch_sec");
  return retention * 0.5 + ctr * 0.3 + watch * 0.2;
}

function main() {
  const campaignFile = arg("--campaign", path.join(REPORTS, "aicc-campaign-latest.json"));
  const metricsFile = arg("--metrics", path.join(REPORTS, "aicc-metrics-latest.json"));
  const out = arg("--out", path.join(REPORTS, "aicc-ab-results-latest.json"));
  const championOut = arg("--champion-out", path.join(REPORTS, "aicc-promoted-variant-latest.json"));

  const campaign = readJson(campaignFile, null);
  if (!campaign || !Array.isArray(campaign.variants)) {
    throw new Error(`invalid campaign file: ${campaignFile}`);
  }

  const metrics = readJson(metricsFile, { variants: [] });
  const metricRows = Array.isArray(metrics?.variants) ? metrics.variants : [];
  const byId = new Map(metricRows.map((m) => [m.variant_id, m]));

  const scored = campaign.variants.map((v) => {
    const m = byId.get(v.id) || {};
    const score = scoreMetricSet(m);
    return {
      variant_id: v.id,
      title: v.title,
      niche_pack: v.niche_pack,
      score,
      retention_30s_pct: normalizeMetric(m, "retention_30s_pct"),
      ctr_pct: normalizeMetric(m, "ctr_pct"),
      avg_watch_sec: normalizeMetric(m, "avg_watch_sec"),
      impressions: normalizeMetric(m, "impressions"),
      clicks: normalizeMetric(m, "clicks"),
    };
  }).sort((a, b) => b.score - a.score);

  const winner = scored[0] || null;
  const result = {
    generated_at: new Date().toISOString(),
    campaign_topic: campaign.topic,
    scored_variants: scored,
    winner,
    recommendation: winner
      ? `Promote variant ${winner.variant_id} and down-rank variants below score delta 10.`
      : "No winner available",
  };

  writeJson(out, result);
  if (winner) {
    writeJson(championOut, {
      generated_at: new Date().toISOString(),
      campaign_topic: campaign.topic,
      winner,
      action: "auto-promote",
    });
  }

  console.log(`[aicc-ab-loop] wrote ${out}`);
  if (winner) {
    console.log(`[aicc-ab-loop] winner=${winner.variant_id} score=${winner.score.toFixed(2)}`);
  }
}

try {
  main();
} catch (err) {
  console.error(`[aicc-ab-loop] fatal: ${err.message}`);
  process.exit(1);
}
