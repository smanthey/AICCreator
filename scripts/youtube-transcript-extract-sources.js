#!/usr/bin/env node
"use strict";

/**
 * youtube-transcript-extract-sources.js
 * Reads reports/youtube-transcript-visual-index-latest.json and extracts
 * Reddit (subreddits) and GitHub (owner/repo) references from all transcript text.
 * Output: reports/youtube-transcript-discovered-sources.json for indexing and benchmarking.
 *
 * Usage:
 *   node scripts/youtube-transcript-extract-sources.js
 *   node scripts/youtube-transcript-extract-sources.js --in ./reports/youtube-transcript-visual-index-latest.json --out ./reports/youtube-transcript-discovered-sources.json
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DEFAULT_IN = path.join(ROOT, "reports", "youtube-transcript-visual-index-latest.json");
const DEFAULT_OUT = path.join(ROOT, "reports", "youtube-transcript-discovered-sources.json");

function getArg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  if (i < 0 || i + 1 >= process.argv.length) return fallback;
  return String(process.argv[i + 1] || "").trim() || fallback;
}

// GitHub: github.com/owner/repo (with optional protocol and trailing path/fragment)
const GITHUB_RE = /(?:https?:\/\/)?(?:www\.)?github\.com\/[\s]*([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)(?:\/[^\s]*|)/gi;
// Reddit: r/subreddit or reddit.com/r/subreddit
const REDDIT_SUB_RE = /reddit\.com\/r\/([a-zA-Z0-9_]+)|(?:^|[\s\/])r\/([a-zA-Z0-9_]{2,25})(?=[\s\/\)]|$)/gi;

function extractGitHub(text) {
  const seen = new Set();
  const repos = [];
  let m;
  GITHUB_RE.lastIndex = 0;
  while ((m = GITHUB_RE.exec(text)) !== null) {
    const owner = (m[1] || "").trim();
    const repo = (m[2] || "").trim().replace(/\/.*$/, "").replace(/#.*$/, "");
    if (!owner || !repo || repo.toLowerCase() === "blog" || repo.toLowerCase() === "org") continue;
    const key = `${owner}/${repo}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    repos.push({ owner, repo, key });
  }
  return repos;
}

function extractReddit(text) {
  const seen = new Set();
  const subs = [];
  let m;
  REDDIT_SUB_RE.lastIndex = 0;
  while ((m = REDDIT_SUB_RE.exec(text)) !== null) {
    const sub = (m[1] || m[2] || "").trim();
    if (!sub || sub.length < 2) continue;
    const lower = sub.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    subs.push(lower);
  }
  return subs;
}

function main() {
  const inPath = getArg("--in", DEFAULT_IN);
  const outPath = getArg("--out", DEFAULT_OUT);

  if (!fs.existsSync(inPath)) {
    console.error("Input not found:", inPath);
    process.exit(1);
  }

  const raw = fs.readFileSync(inPath, "utf8");
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error("Invalid JSON:", inPath, e.message);
    process.exit(1);
  }

  const rows = Array.isArray(data.rows) ? data.rows : [];
  const allGitHub = new Map();
  const allReddit = new Map();
  const searchTerms = new Map(); // term -> { video_ids, source: 'tag'|'title'|'transcript' }

  function addTerm(term, videoId, title, source) {
    const t = String(term).trim().toLowerCase();
    if (t.length < 2 || t.length > 60) return;
    if (/^https?:\/\//i.test(t)) return;
    if (!searchTerms.has(t)) searchTerms.set(t, { video_ids: [], titles: [], sources: [] });
    const r = searchTerms.get(t);
    if (!r.video_ids.includes(videoId)) {
      r.video_ids.push(videoId);
      r.titles.push(title);
      r.sources.push(source);
    }
  }

  for (const row of rows) {
    const videoId = row.video_id || row.metadata?.id;
    const title = row.metadata?.title || videoId;
    const meta = row.metadata || {};
    const tags = Array.isArray(meta.tags) ? meta.tags : [];
    for (const t of tags) addTerm(t, videoId, title, "tag");
    if (meta.title) addTerm(meta.title, videoId, title, "title");

    if (!row.error && row.transcript) {
      const segments = row.transcript.segments || [];
      const text = segments.map((s) => (s && s.text) || "").join(" ");
      if (text) {
        for (const { owner, repo, key } of extractGitHub(text)) {
          if (!allGitHub.has(key)) allGitHub.set(key, { owner, repo, video_ids: [], titles: [], mention_count: 0 });
          const r = allGitHub.get(key);
          r.mention_count += 1;
          if (!r.video_ids.includes(videoId)) {
            r.video_ids.push(videoId);
            r.titles.push(title);
          }
        }
        for (const sub of extractReddit(text)) {
          if (!allReddit.has(sub)) allReddit.set(sub, { video_ids: [], titles: [], mention_count: 0 });
          const r = allReddit.get(sub);
          r.mention_count += 1;
          if (!r.video_ids.includes(videoId)) {
            r.video_ids.push(videoId);
            r.titles.push(title);
          }
        }
        // Extract tool/product-like tokens (words that might be repo or subreddit names)
        const words = text.toLowerCase().replace(/[^\w\s.-]/g, " ").split(/\s+/).filter((w) => w.length >= 2 && w.length <= 40);
        for (const w of words) {
          if (/^(n8n|make\.com|zapier|veo|openai|midjourney|runway|canva|huggingface|replicate|together\.ai|anthropic|claude|chatgpt|automation|workflow)$/i.test(w)) addTerm(w, videoId, title, "transcript");
        }
      }
    }
  }

  const githubList = [...allGitHub.entries()]
    .map(([key, v]) => ({ ...v, key }))
    .sort((a, b) => (b.mention_count - a.mention_count) || (b.video_ids.length - a.video_ids.length));
  const redditList = [...allReddit.entries()]
    .map(([sub, v]) => ({ sub, ...v }))
    .sort((a, b) => (b.mention_count - a.mention_count) || (b.video_ids.length - a.video_ids.length));

  const searchTermList = [...searchTerms.entries()]
    .map(([term, v]) => ({ term, video_ids: v.video_ids, titles: v.titles, sources: v.sources }))
    .sort((a, b) => b.video_ids.length - a.video_ids.length);

  const payload = {
    generated_at: new Date().toISOString(),
    source_index: inPath,
    video_count: rows.length,
    with_transcript: rows.filter((r) => r.transcript?.has_transcript).length,
    github_repos: githubList,
    reddit_subreddits: redditList,
    github_repo_keys: githubList.map((r) => r.key),
    reddit_subs: redditList.map((r) => r.sub),
    search_terms: searchTermList,
    search_terms_for_reddit: [...new Set(searchTermList.map((s) => s.term).filter((t) => t.length >= 3))].slice(0, 50),
    search_terms_for_github: [...new Set(searchTermList.map((s) => s.term).filter((t) => t.length >= 2))].slice(0, 30),
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log("Wrote:", outPath);
  console.log("GitHub repos:", githubList.length);
  console.log("Reddit subreddits:", redditList.length);
  console.log("Search terms (for Reddit/GitHub search):", payload.search_terms_for_reddit.length);
  if (githubList.length) console.log("Top GitHub:", githubList.slice(0, 15).map((r) => r.key).join(", "));
  if (redditList.length) console.log("Top Reddit:", redditList.slice(0, 15).map((r) => r.sub).join(", "));
  if (payload.search_terms_for_reddit.length) console.log("Sample search terms:", payload.search_terms_for_reddit.slice(0, 20).join(", "));
}

main();
