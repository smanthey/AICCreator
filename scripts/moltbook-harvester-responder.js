#!/usr/bin/env node
"use strict";

/**
 * moltbook-harvester-responder.js
 *
 * White-hat lead harvesting for bot communities:
 * - Pulls fresh Moltbook (and optional Reddit fallback) posts
 * - Scores buyer intent
 * - Drafts compliant first replies
 * - Queues only high-score leads into existing outreach pipeline (bot_leads)
 */

require("dotenv").config({ override: true });

const https = require("https");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { saveLead } = require("./bot-lead-discovery");

const ROOT = path.join(__dirname, "..");
const REPORTS_DIR = path.join(ROOT, "reports");
const STATE_DIR = path.join(ROOT, "agent-state", "moltbook-harvester");
const STATE_FILE = path.join(STATE_DIR, "state.json");

const MOLTBOOK_API_KEY = String(process.env.MOLTBOOK_API_KEY || "").trim();
const MOLTBOOK_API_BASE = (process.env.MOLTBOOK_API_BASE || "https://api.moltbook.com").replace(/\/$/, "");
const REDDIT_CLIENT_ID = String(process.env.REDDIT_CLIENT_ID || "").trim();
const REDDIT_CLIENT_SECRET = String(process.env.REDDIT_CLIENT_SECRET || "").trim();
const REDDIT_USER_AGENT = String(process.env.REDDIT_USER_AGENT || "OpenClawBot/1.0").trim();

const SOURCE_LIST = String(process.env.MOLTBOOK_HARVEST_SOURCES || "moltbook,reddit")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const MAX_POSTS = Math.max(10, Number(process.env.MOLTBOOK_HARVEST_MAX_POSTS || "120"));
const MIN_INTENT_SCORE = Math.max(1, Math.min(100, Number(process.env.MOLTBOOK_MIN_INTENT_SCORE || "70")));
const AUTO_REPLY = String(process.env.MOLTBOOK_AUTO_REPLY || "false").toLowerCase() === "true";
const MAX_REPLIES = Math.max(0, Number(process.env.MOLTBOOK_MAX_REPLIES || "15"));

const BUYER_KEYWORDS = [
  "buy",
  "purchase",
  "pay",
  "payment",
  "checkout",
  "stripe",
  "billing",
  "invoice",
  "subscription",
  "api credits",
  "prompt",
  "protocol",
  "agent commerce",
  "bot commerce",
  "accept ach",
  "accept card",
  "apple pay",
  "google pay",
  "crypto",
  "usdc",
  "btc",
  "eth",
];

const URGENCY_KEYWORDS = [
  "today",
  "now",
  "urgent",
  "asap",
  "launch",
  "production",
  "need help",
  "looking for",
  "who can",
  "anyone know",
];

const LOW_SIGNAL_KEYWORDS = [
  "meme",
  "shitpost",
  "joke",
  "offtopic",
  "hiring",
  "job",
  "resume",
  "giveaway",
  "airdrop",
  "nsfw",
];

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeString(v) {
  return String(v || "").trim();
}

function hashId(input) {
  return crypto.createHash("sha1").update(String(input || "")).digest("hex").slice(0, 20);
}

function textForScoring(post) {
  return [post.title, post.body, post.tags?.join(" "), post.channel].filter(Boolean).join("\n").toLowerCase();
}

function countMatches(text, words) {
  return words.reduce((acc, w) => (text.includes(w) ? acc + 1 : acc), 0);
}

function scoreBuyerIntent(post) {
  const text = textForScoring(post);
  const buyerHits = countMatches(text, BUYER_KEYWORDS);
  const urgencyHits = countMatches(text, URGENCY_KEYWORDS);
  const lowSignalHits = countMatches(text, LOW_SIGNAL_KEYWORDS);

  let score = 15;
  score += buyerHits * 12;
  score += urgencyHits * 7;
  score -= lowSignalHits * 10;

  if (/\$\s?1\b/.test(text) || /one\s+dollar/.test(text)) score += 8;
  if (/\b(ach|credit|debit|apple pay|google pay|crypto|usdc|btc|eth)\b/.test(text)) score += 10;
  if (safeString(post.author).toLowerCase().includes("bot")) score += 6;

  const finalScore = Math.max(1, Math.min(100, score));
  const reasons = [];
  if (buyerHits) reasons.push(`buyer_terms:${buyerHits}`);
  if (urgencyHits) reasons.push(`urgency_terms:${urgencyHits}`);
  if (lowSignalHits) reasons.push(`low_signal_terms:${lowSignalHits}`);
  if (/\$\s?1\b/.test(text) || /one\s+dollar/.test(text)) reasons.push("mentions_price_point");
  if (/\b(ach|credit|debit|apple pay|google pay|crypto|usdc|btc|eth)\b/.test(text)) reasons.push("mentions_payment_rails");

  return { score: finalScore, reasons };
}

function draftCompliantReply(post, scored) {
  const display = safeString(post.author) || "there";
  const line1 = `Hi ${display} - if useful, we run a $1 bot-to-bot protocol test.`;
  const line2 = "We can support ACH, cards, Apple/Google Pay, and crypto rails (USDC/BTC/ETH via Stripe setup).";
  const line3 = "If your bot can pay, reply with supported method and I can send one checkout link.";
  const line4 = "No pressure - reply STOP and we will not follow up.";
  return [line1, line2, line3, line4].join("\n");
}

async function ensureDirs() {
  await fsp.mkdir(REPORTS_DIR, { recursive: true });
  await fsp.mkdir(STATE_DIR, { recursive: true });
}

async function loadState() {
  try {
    return JSON.parse(await fsp.readFile(STATE_FILE, "utf8"));
  } catch {
    return {
      seen_post_ids: {},
      last_run_at: null,
    };
  }
}

async function saveState(state) {
  await fsp.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
            return;
          }
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
        } catch (err) {
          reject(new Error(`Invalid JSON: ${err.message}`));
        }
      });
    });
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function fetchMoltbookPosts() {
  if (!MOLTBOOK_API_KEY) return [];

  const endpoints = [
    `${MOLTBOOK_API_BASE}/api/v1/posts?sort=new&limit=${Math.min(100, MAX_POSTS)}`,
    `${MOLTBOOK_API_BASE}/api/v1/feed?sort=new&limit=${Math.min(100, MAX_POSTS)}`,
    `${MOLTBOOK_API_BASE}/api/v1/submolts/posts?sort=new&limit=${Math.min(100, MAX_POSTS)}`,
  ];

  for (const url of endpoints) {
    try {
      const data = await requestJson(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${MOLTBOOK_API_KEY}`,
          Accept: "application/json",
          "User-Agent": "OpenClawBot/1.0",
        },
      });

      const list = Array.isArray(data?.results)
        ? data.results
        : Array.isArray(data?.posts)
          ? data.posts
          : Array.isArray(data)
            ? data
            : [];

      return list.slice(0, MAX_POSTS).map((p) => ({
        source: "moltbook",
        post_id: safeString(p.id || p.post_id || p.uuid) || hashId(JSON.stringify(p).slice(0, 300)),
        title: safeString(p.title || p.subject),
        body: safeString(p.body || p.content || p.text),
        author: safeString(p.author?.username || p.author_name || p.username || p.owner?.username),
        channel: safeString(p.submolt || p.channel || p.topic),
        tags: Array.isArray(p.tags) ? p.tags.map((x) => safeString(x)).filter(Boolean) : [],
        permalink: safeString(p.permalink || p.url || p.link),
        raw: p,
      }));
    } catch {
      // try next endpoint
    }
  }

  return [];
}

async function getRedditToken() {
  if (!REDDIT_CLIENT_ID || !REDDIT_CLIENT_SECRET) return null;

  try {
    const body = "grant_type=client_credentials";
    const token = await requestJson("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": REDDIT_USER_AGENT,
        Authorization: `Basic ${Buffer.from(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`).toString("base64")}`,
      },
      body,
    });
    return token?.access_token || null;
  } catch {
    return null;
  }
}

async function fetchRedditPosts() {
  const token = await getRedditToken();
  if (!token) return [];

  const subreddits = String(process.env.MOLTBOOK_REDDIT_SUBREDDITS || "Moltbook,AI_Agents,LocalLLaMA,LLMDevs,openclaw")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 10);

  const out = [];
  for (const sr of subreddits) {
    try {
      const data = await requestJson(`https://oauth.reddit.com/r/${encodeURIComponent(sr)}/new.json?limit=25`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": REDDIT_USER_AGENT,
          Accept: "application/json",
        },
      });
      const posts = Array.isArray(data?.data?.children) ? data.data.children : [];
      for (const child of posts) {
        const p = child?.data || {};
        out.push({
          source: "reddit",
          post_id: safeString(p.id),
          title: safeString(p.title),
          body: safeString(p.selftext),
          author: safeString(p.author),
          channel: `r/${sr}`,
          tags: [],
          permalink: p.permalink ? `https://reddit.com${p.permalink}` : "",
          raw: p,
        });
      }
      await sleep(500);
    } catch {
      // continue
    }
  }

  return out.slice(0, MAX_POSTS);
}

async function maybeAutoReply(post, replyText) {
  if (!AUTO_REPLY) return { attempted: false, ok: true, skipped: true };
  if (post.source !== "moltbook") return { attempted: false, ok: true, skipped: true };
  if (!MOLTBOOK_API_KEY) return { attempted: false, ok: false, error: "missing_moltbook_api_key" };

  const endpoints = [
    `${MOLTBOOK_API_BASE}/api/v1/posts/${encodeURIComponent(post.post_id)}/reply`,
    `${MOLTBOOK_API_BASE}/api/v1/posts/${encodeURIComponent(post.post_id)}/comments`,
  ];

  for (const url of endpoints) {
    try {
      await requestJson(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${MOLTBOOK_API_KEY}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": "OpenClawBot/1.0",
        },
        body: JSON.stringify({ text: replyText }),
      });
      return { attempted: true, ok: true, endpoint: url };
    } catch {
      // try next endpoint
    }
  }

  return { attempted: true, ok: false, error: "reply_failed" };
}

async function queueLeadFromPost(post, scored, replyDraft) {
  const botId = `${post.source}_${safeString(post.author) || "unknown"}_${hashId(post.post_id || post.permalink || post.title)}`;
  await saveLead({
    platform: "moltbook",
    botId,
    botUsername: safeString(post.author) || botId,
    botDisplayName: safeString(post.author) || botId,
    contactInfo: post.permalink || post.post_id || botId,
    guildId: post.channel || null,
    guildName: post.channel || null,
    notes: {
      discovered_via: `${post.source}_harvest`,
      post_id: post.post_id,
      post_url: post.permalink || null,
      post_title: post.title || null,
      intent_score: scored.score,
      intent_reasons: scored.reasons,
      drafted_reply: replyDraft,
      compliant: true,
      harvested_at: nowIso(),
    },
  });
}

async function writeReport(report) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(REPORTS_DIR, `${stamp}-moltbook-harvester.json`);
  const latest = path.join(REPORTS_DIR, "moltbook-harvester-latest.json");
  await fsp.writeFile(file, JSON.stringify(report, null, 2));
  await fsp.writeFile(latest, JSON.stringify(report, null, 2));
  return { file, latest };
}

async function main() {
  await ensureDirs();
  const state = await loadState();

  const harvest = [];
  if (SOURCE_LIST.includes("moltbook")) {
    const posts = await fetchMoltbookPosts();
    harvest.push(...posts);
  }
  if (SOURCE_LIST.includes("reddit")) {
    const posts = await fetchRedditPosts();
    harvest.push(...posts);
  }

  const unique = [];
  const seenIds = new Set();
  for (const post of harvest) {
    const key = `${post.source}:${post.post_id || post.permalink || hashId(JSON.stringify(post))}`;
    if (seenIds.has(key)) continue;
    seenIds.add(key);
    unique.push(post);
  }

  let queued = 0;
  let repliesAttempted = 0;
  let repliesSucceeded = 0;
  const scoredOut = [];

  for (const post of unique) {
    const stateKey = `${post.source}:${post.post_id}`;
    if (state.seen_post_ids[stateKey]) continue;

    const scored = scoreBuyerIntent(post);
    const replyDraft = draftCompliantReply(post, scored);
    const qualified = scored.score >= MIN_INTENT_SCORE;

    const row = {
      source: post.source,
      post_id: post.post_id,
      author: post.author,
      channel: post.channel,
      permalink: post.permalink,
      score: scored.score,
      reasons: scored.reasons,
      qualified,
      drafted_reply: replyDraft,
    };

    if (qualified) {
      await queueLeadFromPost(post, scored, replyDraft);
      queued += 1;

      if (repliesAttempted < MAX_REPLIES) {
        const rr = await maybeAutoReply(post, replyDraft);
        if (rr.attempted) repliesAttempted += 1;
        if (rr.ok && rr.attempted) repliesSucceeded += 1;
        row.reply = rr;
      } else {
        row.reply = { attempted: false, ok: true, skipped: true, reason: "max_replies_reached" };
      }
    }

    scoredOut.push(row);
    state.seen_post_ids[stateKey] = nowIso();
  }

  // keep state bounded
  const entries = Object.entries(state.seen_post_ids);
  if (entries.length > 5000) {
    entries.sort((a, b) => new Date(a[1]).getTime() - new Date(b[1]).getTime());
    state.seen_post_ids = Object.fromEntries(entries.slice(-4000));
  }
  state.last_run_at = nowIso();
  await saveState(state);

  const report = {
    ok: true,
    generated_at: nowIso(),
    config: {
      sources: SOURCE_LIST,
      max_posts: MAX_POSTS,
      min_intent_score: MIN_INTENT_SCORE,
      auto_reply: AUTO_REPLY,
      max_replies: MAX_REPLIES,
    },
    totals: {
      harvested: unique.length,
      scored: scoredOut.length,
      queued,
      replies_attempted: repliesAttempted,
      replies_succeeded: repliesSucceeded,
    },
    top_candidates: scoredOut
      .sort((a, b) => b.score - a.score)
      .slice(0, 50),
  };

  const files = await writeReport(report);
  console.log(JSON.stringify({ ok: true, totals: report.totals, report: files.file, latest: files.latest }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[moltbook-harvester] fatal:", err.message || String(err));
    process.exit(1);
  });
}

module.exports = {
  scoreBuyerIntent,
  draftCompliantReply,
};
