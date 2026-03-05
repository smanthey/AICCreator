#!/usr/bin/env node
"use strict";

/**
 * reddit-search-research
 * ----------------------
 * Query-driven Reddit research for product/repo intelligence.
 * Produces machine-readable + human-readable reports with ranking signals.
 */

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const https = require("https");
const { execFileSync } = require("child_process");

function arg(flag, fallback = null) {
  const args = process.argv.slice(2);
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
}

function parseList(raw, fallback = []) {
  return String(raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .length
    ? String(raw || "").split(",").map((s) => s.trim()).filter(Boolean)
    : fallback;
}

function fetchJson(url, { userAgent, accessToken, timeoutMs = 12000 }) {
  return new Promise((resolve, reject) => {
    const headers = {
      "User-Agent": userAgent || process.env.REDDIT_USER_AGENT || "claw-architect-reddit-search/1.0",
      Accept: "application/json",
    };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    const req = https.get(url, { headers, timeout: timeoutMs }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (d) => (body += d));
      res.on("end", () => {
        if ((res.statusCode || 500) >= 400) {
          return reject(new Error(`HTTP ${res.statusCode} ${url}`));
        }
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(new Error(`invalid_json ${url}: ${err.message}`));
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error(`timeout ${url}`)));
    req.on("error", reject);
  });
}

function fetchJsonViaCurl(url, { userAgent, accessToken, timeoutMs = 12000 }) {
  const args = [
    "-sS",
    "--max-time",
    String(Math.max(3, Math.ceil(timeoutMs / 1000))),
    "-H",
    `User-Agent: ${userAgent || process.env.REDDIT_USER_AGENT || "claw-architect-reddit-search/1.0"}`,
    "-H",
    "Accept: application/json",
  ];
  if (accessToken) {
    args.push("-H", `Authorization: Bearer ${accessToken}`);
  }
  args.push(url);
  const out = execFileSync("curl", args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  return JSON.parse(String(out || ""));
}

function normalizePost(child) {
  const d = child?.data || {};
  return {
    id: d.id || null,
    title: d.title || "",
    subreddit: d.subreddit || null,
    author: d.author || null,
    permalink: d.permalink ? `https://www.reddit.com${d.permalink}` : null,
    url: d.url || null,
    selftext: d.selftext || "",
    created_utc: d.created_utc || null,
    score: Number(d.score || 0),
    comments: Number(d.num_comments || 0),
    upvote_ratio: Number(d.upvote_ratio || 0),
    over_18: !!d.over_18,
    is_self: !!d.is_self,
  };
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9+._-]+/g)
    .filter((t) => t && t.length >= 3);
}

function scorePost(post, queryTokens) {
  const blob = `${post.title} ${post.selftext}`.toLowerCase();
  const tokenHits = queryTokens.filter((t) => blob.includes(t));
  const engagement = Math.log10(Math.max(1, post.score + 1)) * 30 + Math.log10(Math.max(1, post.comments + 1)) * 20;
  const freshness = post.created_utc
    ? Math.max(0, 25 - Math.min(25, (Date.now() / 1000 - post.created_utc) / (3600 * 24 * 14)))
    : 0;
  const quality = (post.upvote_ratio || 0) * 20;
  const nsfwPenalty = post.over_18 ? -25 : 0;
  const total = Math.max(0, engagement + freshness + quality + tokenHits.length * 10 + nsfwPenalty);
  return {
    ...post,
    rank_score: Math.round(total * 100) / 100,
    matched_terms: tokenHits.slice(0, 12),
  };
}

function toMarkdown(summary, rows) {
  const lines = [
    "# Reddit Search Research",
    "",
    `Generated: ${summary.generated_at}`,
    `Query: ${summary.query}`,
    `Subreddits: ${summary.subreddits.join(", ")}`,
    "",
    "## Top Findings",
    "",
  ];

  if (!rows.length) {
    lines.push("No results captured. Check query/subreddit list or Reddit access constraints.");
    return `${lines.join("\n")}\n`;
  }

  rows.slice(0, 20).forEach((r, idx) => {
    lines.push(`${idx + 1}. [${r.title}](${r.permalink || r.url || "https://reddit.com"})`);
    lines.push(`   - r/${r.subreddit} | score=${r.score} comments=${r.comments} rank=${r.rank_score}`);
    lines.push(`   - matched: ${r.matched_terms.join(", ") || "none"}`);
  });

  return `${lines.join("\n")}\n`;
}

async function main() {
  const defaultSubs = ["AI_Agents", "LocalLLaMA", "MachineLearning", "programming", "webdev", "OpenAI", "ClaudeAI", "openclaw"];
  const query = String(arg("--query", process.env.REDDIT_RESEARCH_QUERY || "dashboard chat ui open source llm"));
  const subreddits = parseList(arg("--subs", process.env.REDDIT_RESEARCH_SUBREDDITS || ""), defaultSubs);
  const limit = Math.max(5, Math.min(100, Number(arg("--limit", process.env.REDDIT_RESEARCH_LIMIT || "25")) || 25));
  const timeWindow = String(arg("--time", process.env.REDDIT_RESEARCH_TIME || "year"));

  const outJson = path.join(__dirname, "..", "reports", "reddit-search-research-latest.json");
  const outMd = path.join(__dirname, "..", "reports", "reddit-search-research-latest.md");
  fs.mkdirSync(path.dirname(outJson), { recursive: true });

  const queryTokens = [...new Set(tokenize(query))].slice(0, 24);
  const rows = [];
  const errors = [];
  const configuredToken = process.env.REDDIT_ACCESS_TOKEN || "";

  for (const sub of subreddits) {
    const url = `https://www.reddit.com/r/${encodeURIComponent(sub)}/search.json?q=${encodeURIComponent(query)}&restrict_sr=1&sort=top&t=${encodeURIComponent(timeWindow)}&limit=${limit}`;
    try {
      let data = null;
      try {
        data = await fetchJson(url, {
          userAgent: process.env.REDDIT_USER_AGENT,
          accessToken: configuredToken,
        });
      } catch (err) {
        const msg = String(err.message || "");
        // If bearer token is stale/misconfigured, retry anonymously instead of failing the whole source.
        if (configuredToken && /HTTP 401|HTTP 403/.test(msg)) {
          try {
            data = await fetchJson(url, {
              userAgent: process.env.REDDIT_USER_AGENT,
              accessToken: "",
            });
          } catch (anonErr) {
            const anonMsg = String(anonErr.message || "");
            if (/HTTP 403/.test(anonMsg)) {
              // Node TLS fingerprinting can hit anti-bot 403s; curl succeeds more reliably for public JSON endpoints.
              data = fetchJsonViaCurl(url, {
                userAgent: process.env.REDDIT_USER_AGENT,
                accessToken: "",
              });
            } else {
              throw anonErr;
            }
          }
        } else if (/HTTP 403/.test(msg)) {
          data = fetchJsonViaCurl(url, {
            userAgent: process.env.REDDIT_USER_AGENT,
            accessToken: "",
          });
        } else {
          throw err;
        }
      }
      const children = Array.isArray(data?.data?.children) ? data.data.children : [];
      for (const child of children) rows.push(normalizePost(child));
    } catch (err) {
      errors.push({ subreddit: sub, error: err.message });
    }
  }

  const dedup = new Map();
  for (const row of rows) {
    const key = String(row.id || row.permalink || row.url || "");
    if (!key || dedup.has(key)) continue;
    dedup.set(key, scorePost(row, queryTokens));
  }

  const ranked = [...dedup.values()].sort((a, b) => b.rank_score - a.rank_score);
  const summary = {
    generated_at: new Date().toISOString(),
    query,
    subreddits,
    limit_per_subreddit: limit,
    indexed_posts: ranked.length,
    source_errors: errors,
    top_terms: queryTokens,
    top_recommendations: ranked.slice(0, 12).map((r) => ({
      title: r.title,
      subreddit: r.subreddit,
      rank_score: r.rank_score,
      permalink: r.permalink,
    })),
  };

  fs.writeFileSync(outJson, JSON.stringify({ summary, results: ranked }, null, 2));
  fs.writeFileSync(outMd, toMarkdown(summary, ranked));

  console.log("reddit_search_research complete:");
  console.log(`- ${outJson}`);
  console.log(`- ${outMd}`);
  console.log(`Indexed posts: ${summary.indexed_posts}`);
  if (errors.length) {
    console.log(`Source errors: ${errors.length}`);
  }
}

main().catch((err) => {
  console.error(`reddit_search_research failed: ${err.message}`);
  process.exit(1);
});
