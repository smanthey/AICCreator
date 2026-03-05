#!/usr/bin/env node
"use strict";

/**
 * youtube-discovered-search-and-index.js
 * Reads reports/youtube-transcript-discovered-sources.json, runs Reddit search and
 * (if GITHUB_TOKEN) GitHub API search with the discovered terms. Writes:
 * - reports/youtube-discovered-reddit-research.json (from reddit:search with combined query)
 * - reports/youtube-discovered-github-repos.json (repos from GitHub search)
 * - reports/youtube-discovered-sources-to-index.json (subreddits + repo list for indexing/benchmark)
 * Then optionally runs index:from-master if --index and repos were added to master list.
 *
 * Usage:
 *   node scripts/youtube-discovered-search-and-index.js
 *   node scripts/youtube-discovered-search-and-index.js --no-github
 *   node scripts/youtube-discovered-search-and-index.js --reddit-query "n8n automation content"
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const fs = require("fs");
const path = require("path");
const https = require("https");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const DISCOVERED_SOURCES = path.join(ROOT, "reports", "youtube-transcript-discovered-sources.json");
const OUT_REDDIT = path.join(ROOT, "reports", "youtube-discovered-reddit-research.json");
const OUT_GITHUB = path.join(ROOT, "reports", "youtube-discovered-github-repos.json");
const OUT_TO_INDEX = path.join(ROOT, "reports", "youtube-discovered-sources-to-index.json");

function getArg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  if (i < 0 || i + 1 >= process.argv.length) return fallback;
  return String(process.argv[i + 1] || "").trim() || fallback;
}

function hasArg(flag) {
  return process.argv.includes(flag);
}

function loadDiscovered() {
  if (!fs.existsSync(DISCOVERED_SOURCES)) {
    console.error("Run scripts/youtube-transcript-extract-sources.js first.");
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(DISCOVERED_SOURCES, "utf8"));
}

function runRedditSearch(query) {
  console.log("[youtube-discovered] Reddit search:", query.slice(0, 60) + "...");
  const r = spawnSync(
    "node",
    [path.join(ROOT, "scripts", "reddit-search-research.js"), "--query", query],
    { cwd: ROOT, env: process.env, stdio: "inherit", timeout: 90000 }
  );
  if (r.status !== 0) return null;
  const redditLatest = path.join(ROOT, "reports", "reddit-search-research-latest.json");
  if (fs.existsSync(redditLatest)) {
    const data = JSON.parse(fs.readFileSync(redditLatest, "utf8"));
    const subreddits = [...new Set((data.results || []).map((p) => p.subreddit).filter(Boolean))];
    fs.writeFileSync(OUT_REDDIT, JSON.stringify({ query, subreddits, post_count: (data.results || []).length, summary: data.summary }, null, 2));
    console.log("[youtube-discovered] Reddit: found", subreddits.length, "subreddits");
    return { query, subreddits, post_count: (data.results || []).length };
  }
  return null;
}

function fetchGitHubSearch(term, token, perPage = 20) {
  return new Promise((resolve, reject) => {
    const q = encodeURIComponent(term + " in:name,description,readme");
    const url = `https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=${perPage}`;
    const headers = {
      "User-Agent": "claw-architect-youtube-discovered/1.0",
      Accept: "application/vnd.github.v3+json",
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    https.get(url, { headers, timeout: 15000 }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`GitHub API ${res.statusCode}: ${body.slice(0, 200)}`));
        }
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    }).on("error", reject);
  });
}

async function runGitHubSearch(terms, maxReposPerTerm = 15) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) {
    console.log("[youtube-discovered] No GITHUB_TOKEN; skipping GitHub search.");
    return [];
  }
  const seen = new Set();
  const repos = [];
  const topTerms = terms.slice(0, 10);
  for (const term of topTerms) {
    try {
      const data = await fetchGitHubSearch(term, token, maxReposPerTerm);
      const items = data.items || [];
      for (const item of items) {
        const full = (item.full_name || "").trim();
        if (!full || seen.has(full)) continue;
        seen.add(full);
        repos.push({
          full_name: full,
          owner: item.owner?.login,
          repo: item.name,
          stars: item.stargazers_count || 0,
          description: (item.description || "").slice(0, 200),
          search_term: term,
        });
      }
      await new Promise((r) => setTimeout(r, 800));
    } catch (err) {
      console.warn("[youtube-discovered] GitHub search failed for", term, err.message);
    }
  }
  repos.sort((a, b) => b.stars - a.stars);
  return repos;
}

async function main() {
  const discovered = loadDiscovered();
  const redditQuery = getArg("--reddit-query", null) || (discovered.search_terms_for_reddit || []).slice(0, 8).join(" ");
  const githubTerms = discovered.search_terms_for_github || discovered.search_terms_for_reddit || [];

  let redditResult = null;
  if (redditQuery) {
    redditResult = runRedditSearch(redditQuery);
  }

  let githubRepos = [];
  if (!hasArg("--no-github") && githubTerms.length) {
    githubRepos = await runGitHubSearch(githubTerms, 12);
    fs.mkdirSync(path.dirname(OUT_GITHUB), { recursive: true });
    fs.writeFileSync(OUT_GITHUB, JSON.stringify({ generated_at: new Date().toISOString(), terms: githubTerms, repos: githubRepos }, null, 2));
    console.log("[youtube-discovered] GitHub: found", githubRepos.length, "repos");
  }

  const toIndex = {
    generated_at: new Date().toISOString(),
    source: DISCOVERED_SOURCES,
    reddit: {
      query: redditQuery,
      subreddits: (redditResult && redditResult.subreddits) || [],
      research_report: OUT_REDDIT,
    },
    github: {
      repos: githubRepos.map((r) => r.full_name),
      repo_details: githubRepos,
      report: OUT_GITHUB,
    },
    next_steps: [
      "Add github.repos to config/repo-completion-master-list.local.json additional_repos after cloning into CLAW_REPOS (e.g. clone top N).",
      "Run npm run reddit:search with --subs from reddit.subreddits to deepen Reddit research.",
      "Run npm run index:from-master then repo:completion:gap for each discovered repo to benchmark.",
      "Run scripts/youtube-culled-features-report.js to generate features/flows/UI to add to ours.",
    ],
  };

  fs.mkdirSync(path.dirname(OUT_TO_INDEX), { recursive: true });
  fs.writeFileSync(OUT_TO_INDEX, JSON.stringify(toIndex, null, 2));
  console.log("[youtube-discovered] Wrote", OUT_TO_INDEX);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
