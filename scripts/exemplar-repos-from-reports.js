#!/usr/bin/env node
"use strict";

/**
 * Build data/exemplar-repos.json from benchmark + scout + optional Reddit.
 * Run after: npm run oss:dashboard:benchmark && npm run dashboard:repo:scout (and optionally reddit:search).
 * Consumed by: daily-feature-rotation.js, feature-benchmark-score.js, symbolic-qa-hub.js, control/symbol-context.js
 *
 * Indexing: When you add a new repo from scout/benchmark (e.g. clone and add to managed_repos),
 * run `npm run index:all` or use jCodeMunch index_folder for that path so feature-benchmark-score
 * and symbolic-qa-hub can use its symbols. context_repos in this file lists repo keys that
 * should have indexes when used for scoring/context.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const BENCHMARK_PATH = path.join(ROOT, "reports", "oss-dashboard-benchmark-latest.json");
const SCOUT_PATH = path.join(ROOT, "scripts", "reports", "dashboard-chatbot-repo-scout-latest.json");
const REDDIT_PATH = path.join(ROOT, "reports", "reddit-search-research-latest.json");
const OUT_PATH = path.join(ROOT, "data", "exemplar-repos.json");

// Mirror of tag->repos used by daily-feature-rotation / feature-benchmark-score so by_feature_tags is consistent
const FALLBACK_LIBRARY = [
  { name: "autopay_ui", repo: "local/autopay_ui", url: "https://github.com/smanthey/autopay_ui", tags: ["stripe", "telnyx", "webhook", "sms", "checkout"] },
  { name: "CaptureInbound", repo: "local/CaptureInbound", url: "https://github.com/smanthey/CaptureInbound", tags: ["stripe", "email", "queue", "api"] },
  { name: "veritap_2026", repo: "local/veritap_2026", url: "https://github.com/smanthey/veritap", tags: ["auth", "webhook", "api", "logging"] },
  { name: "openclaw", repo: "local/claw-architect", url: "https://github.com/openclaw/openclaw", tags: ["queue", "pm2", "dispatcher", "observability"] },
  { name: "trigger.dev", repo: "triggerdotdev/trigger.dev", url: "https://github.com/triggerdotdev/trigger.dev", tags: ["queue", "workflow", "retry", "durable"] },
  { name: "medusajs", repo: "medusajs/medusa", url: "https://github.com/medusajs/medusa", tags: ["checkout", "payment", "api", "auth"] },
  { name: "supabase", repo: "supabase/supabase", url: "https://github.com/supabase/supabase", tags: ["auth", "database", "api"] },
  { name: "cal.com", repo: "calcom/cal.com", url: "https://github.com/calcom/cal.com", tags: ["scheduling", "api", "webhook", "email"] },
  { name: "directus", repo: "directus/directus", url: "https://github.com/directus/directus", tags: ["api", "schema", "auth", "observability"] },
  { name: "appsmith", repo: "appsmithorg/appsmith", url: "https://github.com/appsmithorg/appsmith", tags: ["observability", "api", "auth"] },
  { name: "cypress", repo: "cypress-io/cypress", url: "https://github.com/cypress-io/cypress", tags: ["qa", "assertion", "retry", "browser"] },
  { name: "webdriverio", repo: "webdriverio/webdriverio", url: "https://github.com/webdriverio/webdriverio", tags: ["qa", "browser", "mobile", "retry"] },
  { name: "selenium", repo: "seleniumhq/selenium", url: "https://github.com/SeleniumHQ/selenium", tags: ["qa", "webdriver", "browser"] },
  { name: "puppeteer", repo: "puppeteer/puppeteer", url: "https://github.com/puppeteer/puppeteer", tags: ["browser", "cdp", "qa"] },
  { name: "testcafe", repo: "DevExpress/testcafe", url: "https://github.com/DevExpress/testcafe", tags: ["qa", "assertion", "browser"] },
  { name: "backstopjs", repo: "garris/BackstopJS", url: "https://github.com/garris/BackstopJS", tags: ["visual", "regression", "qa", "snapshot"] },
  { name: "k6-browser", repo: "grafana/k6", url: "https://github.com/grafana/k6", tags: ["performance", "browser", "qa", "cdp"] },
];

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function buildByFeatureTags() {
  const byFeatureTags = {};
  for (const e of FALLBACK_LIBRARY) {
    for (const tag of e.tags || []) {
      const t = String(tag).toLowerCase();
      if (!byFeatureTags[t]) byFeatureTags[t] = [];
      if (!byFeatureTags[t].some((x) => x.repo === e.repo)) {
        byFeatureTags[t].push({ name: e.name, repo: e.repo || "", url: e.url || "" });
      }
    }
  }
  return byFeatureTags;
}

function buildDashboardChat() {
  const seen = new Set();
  const out = [];

  const benchmark = readJson(BENCHMARK_PATH);
  const ranking = Array.isArray(benchmark?.ranking) ? benchmark.ranking : [];
  for (const r of ranking.slice(0, 10)) {
    const fn = r.full_name;
    if (!fn || seen.has(fn)) continue;
    seen.add(fn);
    out.push({
      full_name: fn,
      html_url: r.html_url || `https://github.com/${fn}`,
      stars: Number(r.stars || 0),
      score: Number(r.benchmark_score || 0),
      source: "benchmark",
    });
  }

  const scout = readJson(SCOUT_PATH);
  const topSelected = Array.isArray(scout?.top_selected) ? scout.top_selected : [];
  for (const r of topSelected) {
    const fn = r.full_name;
    if (!fn || seen.has(fn)) continue;
    seen.add(fn);
    out.push({
      full_name: fn,
      html_url: r.html_url || r.clone_url || `https://github.com/${fn}`,
      stars: Number(r.stars || 0),
      score: Number(r.rank_score || 0),
      source: "scout",
    });
  }

  out.sort((a, b) => (b.score || b.stars) - (a.score || a.stars));
  return out.slice(0, 15);
}

function buildRedditContext() {
  const reddit = readJson(REDDIT_PATH);
  const recs = reddit?.summary?.top_recommendations;
  if (!Array.isArray(recs)) return [];
  return recs.slice(0, 5).map((r) => ({
    title: r.title || "",
    subreddit: r.subreddit || "",
    rank_score: Number(r.rank_score || 0),
    permalink: r.permalink || "",
  }));
}

function main() {
  const dashboard_chat = buildDashboardChat();
  const by_feature_tags = buildByFeatureTags();
  const reddit_context = buildRedditContext();
  const context_repos = [...new Set(FALLBACK_LIBRARY.map((e) => e.repo).filter(Boolean))];

  const payload = {
    generated_at: new Date().toISOString(),
    dashboard_chat,
    by_feature_tags,
    reddit_context,
    context_repos,
  };

  const dataDir = path.dirname(OUT_PATH);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2), "utf8");
  console.log(`exemplar-repos: wrote ${OUT_PATH} (dashboard_chat=${dashboard_chat.length}, reddit_context=${reddit_context.length})`);
}

main();
