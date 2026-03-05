#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "../.env") });

const ROOT = path.join(__dirname, "..");
const REPORT_DIR = path.join(ROOT, "scripts", "reports");
const ARGS = process.argv.slice(2);

const LIMIT = Number(getArg("--limit", process.env.SAAS_PAIN_LIMIT || "120")) || 120;
const REDDIT_LIMIT_PER_QUERY = Math.max(10, Math.min(100, Number(getArg("--reddit-limit", "40")) || 40));
const X_LIMIT_PER_QUERY = Math.max(10, Math.min(100, Number(getArg("--x-limit", "40")) || 40));
const TOP_N = Math.max(10, Math.min(60, Number(getArg("--top", "25")) || 25));
const SKIP_X = String(getArg("--skip-x", "false")).toLowerCase() === "true";
const SKIP_WEB = String(getArg("--skip-web", "false")).toLowerCase() === "true";
const X_MAX_QUERIES = Math.max(1, Number(getArg("--x-max-queries", process.env.SAAS_PAIN_X_MAX_QUERIES || "6")) || 6);
const REDDIT_MAX_REQUESTS = Math.max(5, Number(getArg("--reddit-max-requests", process.env.SAAS_PAIN_REDDIT_MAX_REQUESTS || "36")) || 36);
const WEB_MAX_REQUESTS = Math.max(3, Number(getArg("--web-max-requests", process.env.SAAS_PAIN_WEB_MAX_REQUESTS || "8")) || 8);
const MAX_RUNTIME_MS = Math.max(60000, Number(getArg("--max-runtime-ms", process.env.SAAS_PAIN_MAX_RUNTIME_MS || "420000")) || 420000);

const REDDIT_SUBS = [
  "smallbusiness",
  "Entrepreneur",
  "freelance",
  "content_marketing",
  "youtubers",
  "LocalLLaMA",
  "AI_Agents",
  "LLMDevs",
  "openclaw",
  "ClaudeCode",
  "moltiverse",
];

const PAIN_QUERIES = [
  "i wish there was",
  "why doesn't",
  "manual process",
  "repetitive task",
  "not automated",
  "missing feature",
  "too expensive software",
  "switching between tools",
  "wasting time every day",
  "business bottleneck",
  "small business problem",
  "freelancer workflow",
  "creator workflow",
  "missedsaas",
];

const TARGET_KEYWORDS = [
  "small business", "smallbiz", "smb", "freelance", "freelancer", "creator", "agency", "solo founder", "consultant", "content",
  "marketing", "client", "invoic", "scheduling", "crm", "lead", "email", "social", "analytics", "reporting",
];

const X_NITTER_INSTANCES = [
  "https://nitter.net",
  "https://nitter.poast.org",
  "https://nitter.privacydev.net",
];

const TARGET_SUBS = new Set(["smallbusiness", "entrepreneur", "freelance", "content_marketing", "youtubers"]);

function getArg(flag, fallback = null) {
  const idx = ARGS.indexOf(flag);
  if (idx < 0 || idx + 1 >= ARGS.length) return fallback;
  return ARGS[idx + 1];
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url, opts = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs || 20000);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: opts.headers || {},
      signal: controller.signal,
    });
    if (!res.ok) {
      return { ok: false, status: res.status, error: `http_${res.status}`, data: null };
    }
    return { ok: true, status: res.status, data: await res.json(), error: null };
  } catch (err) {
    return { ok: false, status: 0, error: err.message || "fetch_error", data: null };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchText(url, opts = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs || 20000);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: opts.headers || {},
      signal: controller.signal,
    });
    if (!res.ok) {
      return { ok: false, status: res.status, error: `http_${res.status}`, data: null };
    }
    return { ok: true, status: res.status, data: await res.text(), error: null };
  } catch (err) {
    return { ok: false, status: 0, error: err.message || "fetch_error", data: null };
  } finally {
    clearTimeout(timeout);
  }
}

let redditTokenCache = null;
async function getRedditAppToken() {
  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  const userAgent = process.env.REDDIT_USER_AGENT || "server:claw-architect:1.0 (by /u/tatsheen)";
  if (!clientId || !clientSecret) return null;

  if (redditTokenCache && redditTokenCache.expiresAt > Date.now() + 30000) {
    return redditTokenCache.token;
  }

  const body = new URLSearchParams({ grant_type: "client_credentials" }).toString();
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": userAgent,
      },
      body,
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.access_token) return null;
    const ttl = Number(data.expires_in || 3600);
    redditTokenCache = { token: data.access_token, expiresAt: Date.now() + ttl * 1000 };
    return redditTokenCache.token;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function redditOauthSearch(sub, query, limit) {
  const token = await getRedditAppToken();
  if (!token) return { ok: false, error: "reddit_oauth_unavailable", data: null };
  const userAgent = process.env.REDDIT_USER_AGENT || "server:claw-architect:1.0 (by /u/tatsheen)";
  const url = `https://oauth.reddit.com/r/${encodeURIComponent(sub)}/search?q=${encodeURIComponent(query)}&restrict_sr=1&sort=top&t=week&limit=${limit}&raw_json=1`;
  return fetchJson(url, {
    timeoutMs: 9000,
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": userAgent,
    },
  });
}

function cleanText(txt) {
  return String(txt || "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function targetRelevance(text) {
  const t = text.toLowerCase();
  let score = 0;
  for (const kw of TARGET_KEYWORDS) {
    if (t.includes(kw)) score += 1;
  }
  return score;
}

function isPainSignal(text) {
  const t = String(text || "").toLowerCase();
  return /(i wish there was|why doesn(?:'|’)t|why does no one|there should be|i hate|too expensive|not automated|manual(?:ly)?|repetitive|wasting time|missing feature|frustrat|pain point|annoying|struggl|challenge|bottleneck|problem is|biggest problem|broken workflow|time sink|too many tools|context switch)/.test(t);
}

function extractPainSnippet(text) {
  const t = cleanText(text);
  const patterns = [
    /i wish there was[^.!?]{10,220}/i,
    /why doesn(?:'|’)t[^.!?]{8,220}/i,
    /why does no one[^.!?]{8,220}/i,
    /there should be[^.!?]{8,220}/i,
    /i hate[^.!?]{8,220}/i,
    /too expensive[^.!?]{8,220}/i,
    /not automated[^.!?]{8,220}/i,
    /manual(?:ly)?[^.!?]{8,220}/i,
    /repetitive[^.!?]{8,220}/i,
    /takes (?:too )?long[^.!?]{8,220}/i,
    /missing feature[^.!?]{8,220}/i,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m) return m[0].trim();
  }
  const sent = t.split(/[.!?]/).map((s) => s.trim()).filter(Boolean);
  const painLike = sent.find((s) => /(wish|why doesn|hate|manual|repetitive|not automated|too expensive|missing)/i.test(s));
  if (painLike) return painLike.slice(0, 220);
  return sent[0] ? sent[0].slice(0, 220) : "";
}

function normalizePainKey(snippet) {
  return cleanText(snippet)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\b(i|there|this|that|is|are|be|to|for|of|and|the|a|an|it|my|our|with|in|on)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function productAngles(snippet) {
  const s = snippet.toLowerCase();
  const out = [];
  if (/(invoice|billing|payment|stripe)/.test(s)) out.push("Lightweight invoicing + auto-follow-up + payment reconciliation");
  if (/(social|content|post|youtube|instagram|tiktok)/.test(s)) out.push("Content ops copilot with draft queue, approval, and channel scheduling");
  if (/(lead|crm|pipeline|client)/.test(s)) out.push("Simple CRM automation with missed follow-up detection");
  if (/(manual|repetitive|copy paste|spreadsheet)/.test(s)) out.push("Workflow automation template library for repetitive admin tasks");
  if (/(scheduling|calendar|appointment|booking)/.test(s)) out.push("Booking + reminder + no-show recovery automation");
  if (/(email|inbox)/.test(s)) out.push("Inbox triage and response assistant with policy-safe drafts");
  if (/(analytics|report|dashboard)/.test(s)) out.push("One-screen metrics dashboard with anomaly alerts for non-technical owners");
  if (!out.length) out.push("Micro-SaaS focused on one painful manual step with clear ROI in first week");
  return out.slice(0, 3);
}

function parseRssItems(xml) {
  const items = [];
  const chunks = String(xml || "").split(/<item>/i).slice(1);
  for (const c of chunks) {
    const title = (c.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/i)?.[1] || c.match(/<title>(.*?)<\/title>/i)?.[1] || "").trim();
    const link = (c.match(/<link>(.*?)<\/link>/i)?.[1] || "").trim();
    const desc = (c.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/i)?.[1] || "").trim();
    const pubDate = (c.match(/<pubDate>(.*?)<\/pubDate>/i)?.[1] || "").trim();
    items.push({ title: cleanText(title), link, text: cleanText(`${title}. ${desc}`), pubDate });
  }
  return items;
}

async function redditSearch() {
  const records = [];
  const errors = [];
  const diagnostics = [];
  const seen = new Set();
  const startedAt = Date.now();
  let requests = 0;
  const canOauth = !!(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET);

  for (const sub of REDDIT_SUBS) {
    for (const q of PAIN_QUERIES) {
      if (Date.now() - startedAt > MAX_RUNTIME_MS) break;
      if (requests >= REDDIT_MAX_REQUESTS) break;

      let r = null;
      let method = "none";
      if (canOauth) {
        r = await redditOauthSearch(sub, q, REDDIT_LIMIT_PER_QUERY);
        method = "oauth";
      }

      if (!r || !r.ok) {
        const fallbackUrl = `https://www.reddit.com/r/${encodeURIComponent(sub)}/search.json?q=${encodeURIComponent(q)}&restrict_sr=1&sort=top&t=week&limit=${REDDIT_LIMIT_PER_QUERY}&raw_json=1`;
        r = await fetchJson(fallbackUrl, {
          headers: { "User-Agent": process.env.REDDIT_USER_AGENT || "server:claw-architect:1.0 (by /u/tatsheen)" },
          timeoutMs: 8000,
        });
        method = "public_json";
      }

      if (!r || !r.ok) {
        const rssUrl = `https://www.reddit.com/r/${encodeURIComponent(sub)}/search.rss?q=${encodeURIComponent(q)}&restrict_sr=1&sort=top&t=week`;
        const rss = await fetchText(rssUrl, {
          headers: { "User-Agent": process.env.REDDIT_USER_AGENT || "server:claw-architect:1.0 (by /u/tatsheen)" },
          timeoutMs: 8000,
        });
        if (rss.ok && rss.data) {
          const items = parseRssItems(rss.data).slice(0, REDDIT_LIMIT_PER_QUERY);
          r = {
            ok: true,
            status: 200,
            data: {
              data: {
                children: items.map((it) => ({
                  data: {
                    title: it.title,
                    selftext: it.text,
                    permalink: it.link.startsWith("https://www.reddit.com/") ? it.link.replace("https://www.reddit.com", "") : "",
                    url: it.link,
                    score: 0,
                    num_comments: 0,
                    created_utc: it.pubDate ? Math.floor(new Date(it.pubDate).getTime() / 1000) : 0,
                  },
                })),
              },
            },
            error: null,
          };
          method = "rss";
        }
      }

      requests += 1;
      if (!r || !r.ok) {
        errors.push({ source: "reddit", subreddit: sub, query: q, error: r?.error || "unknown" });
        continue;
      }

      const children = r.data?.data?.children || [];
      diagnostics.push({ source: "reddit", subreddit: sub, query: q, method, hits: children.length });

      for (const c of children) {
        const d = c?.data || {};
        const body = cleanText(`${d.title || ""}. ${d.selftext || ""}`);
        if (!body) continue;
        const relevance = targetRelevance(body) + (TARGET_SUBS.has(String(sub).toLowerCase()) ? 2 : 0);
        if (relevance < 1) continue;
        if (!isPainSignal(body)) continue;
        const link = d.permalink ? `https://www.reddit.com${d.permalink}` : d.url || "";
        if (!link || seen.has(link)) continue;
        seen.add(link);
        records.push({
          source: "reddit",
          channel: `r/${sub}`,
          query: q,
          title: cleanText(d.title || ""),
          text: body,
          link,
          score: Number(d.score || 0),
          comments: Number(d.num_comments || 0),
          created_utc: Number(d.created_utc || 0),
          relevance,
        });
      }

      await sleep(120);
      if (records.length >= LIMIT * 3) break;
    }
    if (records.length >= LIMIT * 3 || requests >= REDDIT_MAX_REQUESTS || (Date.now() - startedAt > MAX_RUNTIME_MS)) break;
  }

  return { records, errors, diagnostics };
}

async function xSearchApi(query) {
  const token = process.env.X_BEARER_TOKEN || process.env.TWITTER_BEARER_TOKEN;
  if (!token) return { ok: false, error: "missing_x_bearer" };
  const url = `https://api.x.com/2/tweets/search/recent?max_results=${X_LIMIT_PER_QUERY}&tweet.fields=created_at,public_metrics,lang&expansions=author_id&user.fields=username,name&query=${encodeURIComponent(query + " -is:retweet lang:en")}`;
  const res = await fetchJson(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return { ok: false, error: res.error };

  const users = new Map((res.data?.includes?.users || []).map((u) => [u.id, u]));
  const rows = (res.data?.data || []).map((t) => {
    const u = users.get(t.author_id) || {};
    return {
      source: "x",
      channel: `@${u.username || "unknown"}`,
      query,
      title: cleanText(t.text || "").slice(0, 140),
      text: cleanText(t.text || ""),
      link: u.username ? `https://x.com/${u.username}/status/${t.id}` : `https://x.com/i/web/status/${t.id}`,
      score: Number(t.public_metrics?.like_count || 0) + Number(t.public_metrics?.retweet_count || 0),
      comments: Number(t.public_metrics?.reply_count || 0),
      created_utc: t.created_at ? Math.floor(new Date(t.created_at).getTime() / 1000) : 0,
      relevance: targetRelevance(t.text || ""),
    };
  });

  return { ok: true, records: rows };
}

async function xSearchNitter(query) {
  for (const inst of X_NITTER_INSTANCES) {
    const url = `${inst}/search/rss?f=tweets&q=${encodeURIComponent(query)}`;
    const r = await fetchText(url, { timeoutMs: 8000 });
    if (!r.ok || !r.data) continue;
    const items = parseRssItems(r.data).slice(0, X_LIMIT_PER_QUERY);
    return {
      ok: true,
      via: inst,
      records: items.map((it) => ({
        source: "x",
        channel: "x-search",
        query,
        title: it.title.slice(0, 140),
        text: it.text,
        link: it.link,
        score: 0,
        comments: 0,
        created_utc: it.pubDate ? Math.floor(new Date(it.pubDate).getTime() / 1000) : 0,
        relevance: targetRelevance(it.text),
      })),
    };
  }
  return { ok: false, error: "x_unavailable" };
}

async function xSearch() {
  if (SKIP_X) return { records: [], errors: [{ source: "x", query: "*", error: "skipped_by_flag" }], diagnostics: [] };

  const records = [];
  const errors = [];
  const diagnostics = [];
  const seen = new Set();
  const startedAt = Date.now();
  const hasToken = !!(process.env.X_BEARER_TOKEN || process.env.TWITTER_BEARER_TOKEN);
  let fallbackFailures = 0;
  let processed = 0;

  for (const q of PAIN_QUERIES) {
    if (Date.now() - startedAt > MAX_RUNTIME_MS) break;
    if (processed >= X_MAX_QUERIES) break;

    let r = await xSearchApi(q);
    let method = "api";
    if (!r.ok) {
      const fallback = await xSearchNitter(q);
      if (!fallback.ok) {
        errors.push({ source: "x", query: q, error: `${r.error}|${fallback.error}` });
        fallbackFailures += 1;
        if (!hasToken && fallbackFailures >= 2) break;
        continue;
      }
      r = fallback;
      method = `nitter:${fallback.via || "instance"}`;
    }

    diagnostics.push({ source: "x", query: q, method, hits: (r.records || []).length });
    for (const row of r.records || []) {
      if ((row.relevance || 0) < 1) continue;
      if (!isPainSignal(`${row.title}. ${row.text}`)) continue;
      if (row.link && seen.has(row.link)) continue;
      if (row.link) seen.add(row.link);
      records.push(row);
    }

    await sleep(180);
    processed += 1;
    if (records.length >= LIMIT * 2) break;
  }

  return { records, errors, diagnostics };
}

async function webSearchHn(query) {
  const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=30`;
  const res = await fetchJson(url, { timeoutMs: 9000 });
  if (!res.ok) return { ok: false, error: res.error, records: [] };
  const hits = res.data?.hits || [];
  const rows = hits.map((h) => {
    const title = cleanText(h.title || h.story_title || "");
    const text = cleanText(`${h.story_text || ""}. ${h.comment_text || ""}`);
    const link = h.url || (h.objectID ? `https://news.ycombinator.com/item?id=${h.objectID}` : "");
    return {
      source: "web",
      channel: "hn",
      query,
      title: title.slice(0, 140),
      text: text || title,
      link,
      score: Number(h.points || 0),
      comments: Number(h.num_comments || 0),
      created_utc: h.created_at_i ? Number(h.created_at_i) : 0,
      relevance: targetRelevance(`${title}. ${text}`),
    };
  });
  return { ok: true, records: rows };
}

async function webSearchGithubIssues(query) {
  const token = process.env.GITHUB_TOKEN || "";
  const q = `${query} in:title,body is:issue is:public`;
  const url = `https://api.github.com/search/issues?q=${encodeURIComponent(q)}&sort=comments&order=desc&per_page=20`;
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "claw-architect-saas-pain-report",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetchJson(url, { timeoutMs: 9000, headers });
  if (!res.ok) return { ok: false, error: res.error, records: [] };
  const items = res.data?.items || [];
  const rows = items.map((it) => {
    const title = cleanText(it.title || "");
    const text = cleanText(`${it.body || ""}`);
    return {
      source: "web",
      channel: "github_issues",
      query,
      title: title.slice(0, 140),
      text: text.slice(0, 1200),
      link: it.html_url || "",
      score: Number(it.score || 0),
      comments: Number(it.comments || 0),
      created_utc: it.created_at ? Math.floor(new Date(it.created_at).getTime() / 1000) : 0,
      relevance: targetRelevance(`${title}. ${text}`),
    };
  });
  return { ok: true, records: rows };
}

async function webResearchFallback() {
  if (SKIP_WEB) return { records: [], errors: [{ source: "web", query: "*", error: "skipped_by_flag" }], diagnostics: [] };

  const records = [];
  const errors = [];
  const diagnostics = [];
  let requests = 0;

  for (const q of PAIN_QUERIES) {
    if (requests >= WEB_MAX_REQUESTS) break;
    const enriched = `${q} saas small business freelancer creator`;
    const [hn, gh] = await Promise.all([
      webSearchHn(enriched),
      webSearchGithubIssues(enriched),
    ]);
    requests += 1;

    if (!hn.ok && !gh.ok) {
      errors.push({ source: "web", query: q, error: `${hn.error || "hn_fail"}|${gh.error || "gh_fail"}` });
      continue;
    }

    diagnostics.push({ source: "web", query: q, method: "hn_algolia", hits: (hn.records || []).length });
    diagnostics.push({ source: "web", query: q, method: "github_issues", hits: (gh.records || []).length });
    const webRows = [...(hn.records || []), ...(gh.records || [])];
    for (const row of webRows) {
      const combined = `${row.title}. ${row.text}`;
      if ((row.relevance || 0) < 1 && !isPainSignal(combined)) continue;
      if (!isPainSignal(combined) && !/(alternative|replace|frustrat|manual|workflow|expensive|tooling|integration|automation)/i.test(combined)) continue;
      records.push(row);
    }

    if (records.length >= LIMIT) break;
    await sleep(100);
  }

  return { records, errors, diagnostics };
}

function clusterPainPoints(items) {
  const map = new Map();
  for (const it of items) {
    const snippet = extractPainSnippet(`${it.title}. ${it.text}`);
    if (!snippet) continue;
    if (!isPainSignal(snippet) && !/(manual|repetitive|workflow|problem|frustrat|missing)/i.test(snippet)) continue;
    const key = normalizePainKey(snippet);
    if (!key || key.length < 12) continue;

    if (!map.has(key)) {
      map.set(key, {
        key,
        summary: snippet,
        frequency: 0,
        source_breakdown: { reddit: 0, x: 0, web: 0 },
        examples: [],
        angles: productAngles(snippet),
      });
    }

    const row = map.get(key);
    row.frequency += 1;
    row.source_breakdown[it.source] = (row.source_breakdown[it.source] || 0) + 1;
    if (row.examples.length < 6 && it.link) {
      row.examples.push({ source: it.source, channel: it.channel, title: it.title.slice(0, 180), link: it.link });
    }
  }

  return Array.from(map.values())
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, TOP_N);
}

function buildReport(reddit, xset, webset, topPain) {
  const totalRaw = reddit.records.length + xset.records.length + webset.records.length;
  const seen = new Set();

  const all = [...reddit.records, ...xset.records, ...webset.records]
    .filter((r) => {
      const key = `${r.source}:${r.link || r.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (b.relevance - a.relevance) || (b.score - a.score))
    .slice(0, LIMIT * 2);

  return {
    generated_at: new Date().toISOString(),
    focus: ["small business", "freelancers", "content creators"],
    search_queries: PAIN_QUERIES,
    collection: {
      total_records: totalRaw,
      included_records: all.length,
      reddit_records: reddit.records.length,
      x_records: xset.records.length,
      web_records: webset.records.length,
      reddit_errors: reddit.errors,
      x_errors: xset.errors,
      web_errors: webset.errors,
      source_diagnostics: {
        reddit: reddit.diagnostics || [],
        x: xset.diagnostics || [],
        web: webset.diagnostics || [],
      },
    },
    top_pain_points: topPain,
    raw_sample: all.slice(0, 60),
    notes: [
      "Frequency is based on collected weekly mentions across searched channels.",
      "X data uses API when token exists, otherwise Nitter RSS fallback when available.",
      "When social sources are weak, a web fallback search is used to avoid zero-signal reports.",
      "Use top pain points as weekly product-idea intake for repo/research team.",
    ],
  };
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("# SaaS Pain Point Opportunity Report");
  lines.push("");
  lines.push(`Generated: ${report.generated_at}`);
  lines.push("");
  lines.push("## Scope");
  lines.push(`- Focus: ${report.focus.join(", ")}`);
  lines.push(`- Records: ${report.collection.included_records}/${report.collection.total_records} used`);
  lines.push(`- Reddit: ${report.collection.reddit_records} | X: ${report.collection.x_records} | Web fallback: ${report.collection.web_records}`);
  lines.push("");
  lines.push("## Top Pain Points");
  lines.push("");
  lines.push("| # | Pain summary | Frequency | Product angles |");
  lines.push("|---|---|---:|---|");
  report.top_pain_points.forEach((p, idx) => {
    lines.push(`| ${idx + 1} | ${p.summary.replace(/\|/g, "\\|")} | ${p.frequency} | ${(p.angles || []).join("; ").replace(/\|/g, "\\|")} |`);
  });
  lines.push("");
  lines.push("## Evidence Links");
  lines.push("");
  report.top_pain_points.forEach((p, idx) => {
    lines.push(`### ${idx + 1}. ${p.summary}`);
    lines.push(`- Frequency: ${p.frequency} (reddit=${p.source_breakdown.reddit || 0}, x=${p.source_breakdown.x || 0}, web=${p.source_breakdown.web || 0})`);
    (p.examples || []).slice(0, 5).forEach((e) => {
      lines.push(`- [${e.source} ${e.channel}](${e.link}) - ${e.title}`);
    });
    lines.push("- Product angles:");
    (p.angles || []).forEach((a) => lines.push(`  - ${a}`));
    lines.push("");
  });

  lines.push("## Query Set");
  report.search_queries.forEach((q) => lines.push(`- ${q}`));
  lines.push("");

  if (report.collection.reddit_errors.length || report.collection.x_errors.length || report.collection.web_errors.length) {
    lines.push("## Collection Errors");
    [...report.collection.reddit_errors, ...report.collection.x_errors, ...report.collection.web_errors].slice(0, 20).forEach((e) => {
      lines.push(`- ${e.source} ${e.query || e.subreddit || ""}: ${e.error}`);
    });
    lines.push("");
  }

  lines.push("## Source Diagnostics");
  ["reddit", "x", "web"].forEach((src) => {
    const rows = report.collection.source_diagnostics[src] || [];
    lines.push(`- ${src}: ${rows.length} request(s)`);
  });
  lines.push("");

  return lines.join("\n");
}

async function main() {
  console.log("[saas-pain-opportunity-report] start");
  const reddit = await redditSearch();
  const xset = await xSearch();

  let webset = { records: [], errors: [], diagnostics: [] };
  const preCount = reddit.records.length + xset.records.length;
  if (preCount < Math.max(30, TOP_N * 2)) {
    webset = await webResearchFallback();
  }

  const topPain = clusterPainPoints([...reddit.records, ...xset.records, ...webset.records]);
  const report = buildReport(reddit, xset, webset, topPain);

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = Date.now();
  const jsonPath = path.join(REPORT_DIR, `${stamp}-saas-pain-opportunity-report.json`);
  const mdPath = path.join(REPORT_DIR, `${stamp}-saas-pain-opportunity-report.md`);
  const latestJson = path.join(REPORT_DIR, "saas-pain-opportunity-report-latest.json");
  const latestMd = path.join(REPORT_DIR, "saas-pain-opportunity-report-latest.md");

  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(mdPath, renderMarkdown(report));
  fs.copyFileSync(jsonPath, latestJson);
  fs.copyFileSync(mdPath, latestMd);

  console.log(`[saas-pain-opportunity-report] json=${jsonPath}`);
  console.log(`[saas-pain-opportunity-report] md=${mdPath}`);
  console.log(`[saas-pain-opportunity-report] top=${report.top_pain_points.length} records=${report.collection.included_records}`);
}

main().catch((err) => {
  console.error("[saas-pain-opportunity-report] fatal:", err.message);
  process.exit(1);
});
