#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const REPORT_DIR = path.join(__dirname, "reports");
const MEM_PATH = path.join(__dirname, "..", "agent-state", "agents", "reddit", "MEMORY.md");
const DAILY_MEM_DIR = path.join(__dirname, "..", "agent-state", "agents", "reddit", "memory");
const STATE_PATH = path.join(__dirname, "..", "agent-state", "agents", "reddit", "source-health-state.json");
const LATEST_JSON_PATH = path.join(REPORT_DIR, "reddit-digest-latest.json");
const LATEST_MD_PATH = path.join(REPORT_DIR, "reddit-digest-latest.md");

const SUBS = [
  "clawdbot",
  "AI_Agents",
  "LLMDevs",
  "openclaw",
  "LocalLLaMA",
  "AgentsOfAI",
  "moltiverse",
  "OpenclawBot",
  "Moltbook",
  "ClaudeCode",
];

const SOURCE_ORDER = ["reddit_top", "old_reddit_top", "hot", "new", "rss"];

const SOURCE_FAILURE_BREAKER = Math.max(2, Number(process.env.REDDIT_SOURCE_FAILURE_BREAKER || "3") || 3);
const SOURCE_NO_PROGRESS_BREAKER = Math.max(2, Number(process.env.REDDIT_SOURCE_NO_PROGRESS_BREAKER || "2") || 2);
const SOURCE_COOLDOWN_BASE_MS = Math.max(30_000, Number(process.env.REDDIT_SOURCE_COOLDOWN_BASE_MS || "900000") || 900000);
const SOURCE_COOLDOWN_MAX_MS = Math.max(SOURCE_COOLDOWN_BASE_MS, Number(process.env.REDDIT_SOURCE_COOLDOWN_MAX_MS || "21600000") || 21600000);
const ADAPTIVE_BACKOFF_BASE_MS = Math.max(80, Number(process.env.REDDIT_ADAPTIVE_BACKOFF_BASE_MS || "200") || 200);
const ADAPTIVE_BACKOFF_MAX_MS = Math.max(ADAPTIVE_BACKOFF_BASE_MS, Number(process.env.REDDIT_ADAPTIVE_BACKOFF_MAX_MS || "3500") || 3500);
const REQUEST_TIMEOUT_MS = Math.max(1000, Number(process.env.REDDIT_REQUEST_TIMEOUT_MS || "9000") || 9000);

const DEFAULT_USER_AGENT = process.env.REDDIT_USER_AGENT || "claw-architect/1.0";
const USER_AGENT_PROFILES = parseEnvList(process.env.REDDIT_USER_AGENTS || process.env.REDDIT_USER_AGENT_PROFILES);
const ACCESS_TOKEN_PROFILES = parseEnvList(process.env.REDDIT_ACCESS_TOKENS || process.env.REDDIT_ACCESS_TOKEN_PROFILES);

const DEFAULT_RULES = {
  bannedKeywords: ["meme"],
  preferredKeywords: ["benchmark", "guide", "workflow", "architecture", "postmortem", "launch"],
  avoidTitlePatterns: ["you won't believe", "insane", "cancel and delete", "is dead", "nukes", "🚨", "😱"],
  minScore: 5,
  minComments: 2,
  minRankScore: 8,
};

function parseEnvList(raw) {
  return String(raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))));
}

function arg(flag, fallback = null) {
  const args = process.argv.slice(2);
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
}

function parseCsvRule(raw) {
  return String(raw || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function extractRule(text, key) {
  const re = new RegExp(`${key}:\\s*(.+)`, "i");
  const match = text.match(re);
  return match ? match[1] : null;
}

function extractNumericRule(text, key, fallback) {
  const raw = extractRule(text, key);
  if (!raw) return fallback;
  const v = Number(raw.trim());
  return Number.isFinite(v) ? v : fallback;
}

function readRulesFromMemory() {
  try {
    const txt = fs.readFileSync(MEM_PATH, "utf8");
    const bannedKeywords = parseCsvRule(extractRule(txt, "banned_keywords")) || DEFAULT_RULES.bannedKeywords;
    const preferredKeywords = parseCsvRule(extractRule(txt, "preferred_keywords")) || DEFAULT_RULES.preferredKeywords;
    const avoidTitlePatterns = parseCsvRule(extractRule(txt, "avoid_title_patterns")) || DEFAULT_RULES.avoidTitlePatterns;
    const minScore = extractNumericRule(txt, "min_score", DEFAULT_RULES.minScore);
    const minComments = extractNumericRule(txt, "min_comments", DEFAULT_RULES.minComments);
    const minRankScore = extractNumericRule(txt, "min_rank_score", DEFAULT_RULES.minRankScore);

    return {
      bannedKeywords: bannedKeywords.length ? bannedKeywords : DEFAULT_RULES.bannedKeywords,
      preferredKeywords: preferredKeywords.length ? preferredKeywords : DEFAULT_RULES.preferredKeywords,
      avoidTitlePatterns: avoidTitlePatterns.length ? avoidTitlePatterns : DEFAULT_RULES.avoidTitlePatterns,
      minScore,
      minComments,
      minRankScore,
    };
  } catch {
    return { ...DEFAULT_RULES };
  }
}

function buildAuthProfiles() {
  const explicitRaw = String(process.env.REDDIT_AUTH_PROFILES || "").trim();
  if (explicitRaw) {
    try {
      const parsed = JSON.parse(explicitRaw);
      if (Array.isArray(parsed) && parsed.length) {
        const cleaned = parsed
          .map((p, i) => ({
            id: String(p.id || `profile_${i + 1}`),
            userAgent: String(p.userAgent || p.user_agent || DEFAULT_USER_AGENT),
            accessToken: String(p.accessToken || p.access_token || ""),
          }))
          .filter((p) => p.userAgent || p.accessToken);
        if (cleaned.length) return cleaned;
      }
    } catch {
      // fall through to env-list based profiles
    }
  }

  const uas = USER_AGENT_PROFILES.length ? USER_AGENT_PROFILES : [DEFAULT_USER_AGENT];
  const tokens = ACCESS_TOKEN_PROFILES.length ? ACCESS_TOKEN_PROFILES : [""];
  const size = Math.max(uas.length, tokens.length);
  const profiles = [];
  for (let i = 0; i < size; i += 1) {
    profiles.push({
      id: `profile_${i + 1}`,
      userAgent: uas[i % uas.length] || DEFAULT_USER_AGENT,
      accessToken: tokens[i % tokens.length] || "",
    });
  }
  return profiles;
}

function toNow() {
  return Date.now();
}

function emptySourceState() {
  return {
    state: "closed",
    blocked_until: 0,
    opened_at: 0,
    cooldown_ms: SOURCE_COOLDOWN_BASE_MS,
    attempts_total: 0,
    successes_total: 0,
    failures_total: 0,
    failure_streak: 0,
    no_progress_streak: 0,
    last_result_hash: "",
    last_error: null,
    last_status_code: 0,
    last_latency_ms: 0,
    last_success_at: null,
    last_failure_at: null,
  };
}

function emptyRunHealth() {
  return {
    attempts: 0,
    successes: 0,
    failures: 0,
    blocked_hits: 0,
    latency_sum_ms: 0,
    avg_latency_ms: 0,
    last_error: null,
    status: "missing",
  };
}

function loadPersistentState() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
    const sources = {};
    for (const source of SOURCE_ORDER) {
      sources[source] = { ...emptySourceState(), ...(raw?.sources?.[source] || {}) };
    }
    const profileStats = {};
    for (const p of AUTH_PROFILES) {
      profileStats[p.id] = {
        attempts: 0,
        successes: 0,
        failures: 0,
        last_error: null,
        ...(raw?.auth_profiles?.[p.id] || {}),
      };
    }
    return {
      version: 1,
      updated_at: raw?.updated_at || null,
      sources,
      auth_profiles: profileStats,
    };
  } catch {
    const sources = {};
    for (const source of SOURCE_ORDER) {
      sources[source] = emptySourceState();
    }
    const profileStats = {};
    for (const p of AUTH_PROFILES) {
      profileStats[p.id] = { attempts: 0, successes: 0, failures: 0, last_error: null };
    }
    return {
      version: 1,
      updated_at: null,
      sources,
      auth_profiles: profileStats,
    };
  }
}

function savePersistentState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(
    STATE_PATH,
    JSON.stringify(
      {
        version: 1,
        updated_at: new Date().toISOString(),
        sources: state.sources,
        auth_profiles: state.auth_profiles,
      },
      null,
      2
    )
  );
}

function hashResult(input) {
  return crypto.createHash("sha1").update(String(input || "")).digest("hex").slice(0, 16);
}

function computeAdaptiveBackoffMs({ failureStreak = 0, sourceAttempt = 0 }) {
  const exp = Math.min(
    ADAPTIVE_BACKOFF_MAX_MS,
    ADAPTIVE_BACKOFF_BASE_MS * Math.pow(2, Math.max(0, Number(failureStreak || 0)) + Math.max(0, Number(sourceAttempt || 0)))
  );
  const jittered = Math.round(Math.random() * exp);
  return Math.max(120, jittered);
}

function passesFilters(post, rules) {
  const text = `${post.title || ""} ${post.selftext || ""}`.toLowerCase();
  const hasBannedKeyword = rules.bannedKeywords.some((k) => text.includes(k));
  const hasAvoidPattern = rules.avoidTitlePatterns.some((k) => (post.title || "").toLowerCase().includes(k));
  return !hasBannedKeyword && !hasAvoidPattern;
}

async function fetchTextWithTimeout(url, { timeoutMs = REQUEST_TIMEOUT_MS, headers = {}, userAgent = DEFAULT_USER_AGENT, accessToken = "" } = {}) {
  const ctl = new AbortController();
  const started = toNow();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const mergedHeaders = { "User-Agent": userAgent, ...headers };
    if (accessToken) mergedHeaders.Authorization = `Bearer ${accessToken}`;
    const res = await fetch(url, { signal: ctl.signal, headers: mergedHeaders });
    const body = await res.text();
    const latencyMs = toNow() - started;
    return { ok: res.ok, status: res.status, body, latencyMs };
  } catch (error) {
    const latencyMs = toNow() - started;
    return { ok: false, status: 0, body: "", error: error?.message || String(error), latencyMs };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJsonWithTimeout(url, opts = {}) {
  const res = await fetchTextWithTimeout(url, opts);
  if (!res.ok) return { ...res, data: null };
  try {
    return { ...res, data: JSON.parse(res.body || "null") };
  } catch {
    return { ...res, ok: false, data: null, error: "invalid_json" };
  }
}

function parseRssItems(xml) {
  const items = [];
  const blocks = String(xml || "").split(/<item>/i).slice(1);
  for (const block of blocks) {
    const title = (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/i) || [])[1] || "";
    const link = (block.match(/<link>(.*?)<\/link>/i) || [])[1] || "";
    const pubDate = (block.match(/<pubDate>(.*?)<\/pubDate>/i) || [])[1] || "";
    if (title && link) items.push({ title, link, pubDate });
  }
  return items;
}

function normalizeRssPost(item, subreddit) {
  return {
    id: hashResult(item.link),
    title: item.title,
    score: 0,
    num_comments: 0,
    permalink: item.link.replace(/^https?:\/\/www\.reddit\.com/i, ""),
    created_utc: item.pubDate ? Math.floor(new Date(item.pubDate).getTime() / 1000) : 0,
    subreddit,
    selftext: "",
  };
}

function shouldRetryWithNextProfile(response) {
  if (!response || response.ok) return false;
  if (response.status === 401 || response.status === 403 || response.status === 429) return true;
  if (response.status >= 500) return true;
  const msg = String(response.error || "").toLowerCase();
  return msg.includes("timeout") || msg.includes("abort") || msg.includes("network");
}

function nextAuthProfile(state) {
  const profiles = state.authProfiles;
  if (!profiles.length) {
    return { id: "profile_default", userAgent: DEFAULT_USER_AGENT, accessToken: "" };
  }
  const p = profiles[state.authCursor % profiles.length];
  state.authCursor += 1;
  return p;
}

function markAuthProfileAttempt(runtimeState, profile, result) {
  const row = runtimeState.persisted.auth_profiles[profile.id] || {
    attempts: 0,
    successes: 0,
    failures: 0,
    last_error: null,
  };
  row.attempts += 1;
  if (result.ok) {
    row.successes += 1;
    row.last_error = null;
  } else {
    row.failures += 1;
    row.last_error = result.error || `HTTP ${result.status || 0}`;
  }
  runtimeState.persisted.auth_profiles[profile.id] = row;
}

function initRunSourceHealth() {
  return Object.fromEntries(SOURCE_ORDER.map((source) => [source, emptyRunHealth()]));
}

function markRunSourceAttempt(runHealth, source, { ok, latencyMs = 0, error = null, blocked = false } = {}) {
  if (!runHealth[source]) return;
  const row = runHealth[source];
  row.attempts += 1;
  row.latency_sum_ms += Math.max(0, Number(latencyMs || 0));
  row.avg_latency_ms = row.attempts ? Math.round(row.latency_sum_ms / row.attempts) : 0;
  if (blocked) row.blocked_hits += 1;
  if (ok) {
    row.successes += 1;
    row.last_error = null;
  } else {
    row.failures += 1;
    row.last_error = error || row.last_error;
  }
}

function isSourceBlocked(row, nowMs) {
  if (!row) return false;
  if (row.state !== "open") return false;
  const blockedUntil = Number(row.blocked_until || 0);
  return blockedUntil > nowMs;
}

function touchHalfOpenIfReady(row, nowMs) {
  if (!row) return;
  if (row.state === "open" && Number(row.blocked_until || 0) <= nowMs) {
    row.state = "half_open";
  }
}

function markPersistentSourceAttempt(persisted, source, result) {
  const nowMs = toNow();
  const row = persisted.sources[source] || emptySourceState();

  row.attempts_total += 1;
  row.last_status_code = Number(result.status || 0);
  row.last_latency_ms = Math.max(0, Number(result.latencyMs || 0));

  if (result.blocked === true && row.state === "open" && Number(row.blocked_until || 0) > nowMs) {
    row.failures_total += 1;
    row.last_error = result.error || "blocked_by_circuit_breaker";
    row.last_failure_at = new Date(nowMs).toISOString();
    persisted.sources[source] = row;
    return;
  }

  if (result.ok) {
    row.successes_total += 1;
    row.failure_streak = 0;
    row.no_progress_streak = 0;
    row.last_error = null;
    row.last_result_hash = hashResult(`ok|${result.status || 200}`);
    row.last_success_at = new Date(nowMs).toISOString();
    row.state = "closed";
    row.blocked_until = 0;
    row.opened_at = 0;
    row.cooldown_ms = SOURCE_COOLDOWN_BASE_MS;
  } else {
    row.failures_total += 1;
    row.failure_streak += 1;
    row.last_error = result.error || `HTTP ${result.status || 0}`;
    row.last_failure_at = new Date(nowMs).toISOString();

    const resultHash = hashResult(`fail|${result.status || 0}|${row.last_error || ""}`);
    row.no_progress_streak = row.last_result_hash === resultHash ? row.no_progress_streak + 1 : 1;
    row.last_result_hash = resultHash;

    const shouldOpenCircuit =
      row.failure_streak >= SOURCE_FAILURE_BREAKER ||
      row.no_progress_streak >= SOURCE_NO_PROGRESS_BREAKER ||
      result.blocked === true;

    if (shouldOpenCircuit) {
      row.state = "open";
      row.opened_at = nowMs;
      row.cooldown_ms = Math.min(SOURCE_COOLDOWN_MAX_MS, Math.max(SOURCE_COOLDOWN_BASE_MS, Number(row.cooldown_ms || SOURCE_COOLDOWN_BASE_MS) * 2));
      row.blocked_until = nowMs + row.cooldown_ms;
    }
  }

  persisted.sources[source] = row;
}

function summarizeSourceHealth(runHealth, persisted) {
  const summary = {
    providers: [],
    counts: { ok: 0, expiring: 0, missing: 0, degraded: 0 },
  };

  for (const source of SOURCE_ORDER) {
    const run = runHealth[source] || emptyRunHealth();
    const state = persisted.sources[source] || emptySourceState();

    let status = "missing";
    if (state.state === "open" || run.blocked_hits > 0) {
      status = "degraded";
    } else if (run.successes > 0 && run.failures === 0) {
      status = "ok";
    } else if (run.successes > 0 && run.failures > 0) {
      status = "expiring";
    } else if (run.attempts > 0 && run.failures > 0) {
      status = "missing";
    }

    run.status = status;
    summary.counts[status] += 1;

    summary.providers.push({
      source,
      status,
      attempts: run.attempts,
      successes: run.successes,
      failures: run.failures,
      blocked: state.state === "open",
      blocked_until: state.blocked_until ? new Date(state.blocked_until).toISOString() : null,
      failure_streak: state.failure_streak,
      no_progress_streak: state.no_progress_streak,
      avg_latency_ms: run.avg_latency_ms,
      last_error: run.last_error || state.last_error,
    });
  }

  return summary;
}

async function fetchJsonWithProfileFallback(url, runtimeState, source) {
  const errors = [];
  const maxAttempts = Math.max(1, runtimeState.authProfiles.length || 1);

  for (let i = 0; i < maxAttempts; i += 1) {
    const profile = nextAuthProfile(runtimeState);
    const res = await fetchJsonWithTimeout(url, {
      timeoutMs: REQUEST_TIMEOUT_MS,
      userAgent: profile.userAgent,
      accessToken: profile.accessToken,
    });
    markAuthProfileAttempt(runtimeState, profile, res);

    if (res.ok) {
      return { ...res, profileId: profile.id, fallbackErrors: errors };
    }

    errors.push(`${profile.id}:${res.error || `HTTP ${res.status || 0}`}`);
    if (!shouldRetryWithNextProfile(res)) {
      return { ...res, profileId: profile.id, fallbackErrors: errors };
    }

    const sourceState = runtimeState.persisted.sources[source] || emptySourceState();
    const backoffMs = computeAdaptiveBackoffMs({ failureStreak: sourceState.failure_streak, sourceAttempt: i });
    await sleep(backoffMs);
  }

  return {
    ok: false,
    status: 0,
    data: null,
    error: errors.join(" | ") || "all_auth_profiles_failed",
    latencyMs: 0,
    profileId: null,
    fallbackErrors: errors,
  };
}

async function fetchTextWithProfileFallback(url, runtimeState, source) {
  const errors = [];
  const maxAttempts = Math.max(1, runtimeState.authProfiles.length || 1);

  for (let i = 0; i < maxAttempts; i += 1) {
    const profile = nextAuthProfile(runtimeState);
    const res = await fetchTextWithTimeout(url, {
      timeoutMs: REQUEST_TIMEOUT_MS,
      userAgent: profile.userAgent,
      accessToken: profile.accessToken,
    });
    markAuthProfileAttempt(runtimeState, profile, res);

    if (res.ok) {
      return { ...res, profileId: profile.id, fallbackErrors: errors };
    }

    errors.push(`${profile.id}:${res.error || `HTTP ${res.status || 0}`}`);
    if (!shouldRetryWithNextProfile(res)) {
      return { ...res, profileId: profile.id, fallbackErrors: errors };
    }

    const sourceState = runtimeState.persisted.sources[source] || emptySourceState();
    const backoffMs = computeAdaptiveBackoffMs({ failureStreak: sourceState.failure_streak, sourceAttempt: i });
    await sleep(backoffMs);
  }

  return {
    ok: false,
    status: 0,
    body: "",
    error: errors.join(" | ") || "all_auth_profiles_failed",
    latencyMs: 0,
    profileId: null,
    fallbackErrors: errors,
  };
}

async function fetchTop(sub, timeWindow = "day", limit = 12, runtimeState) {
  const attempts = [
    {
      source: "reddit_top",
      url: `https://www.reddit.com/r/${encodeURIComponent(sub)}/top.json?t=${encodeURIComponent(timeWindow)}&limit=${limit}&raw_json=1`,
    },
    {
      source: "old_reddit_top",
      url: `https://old.reddit.com/r/${encodeURIComponent(sub)}/top.json?t=${encodeURIComponent(timeWindow)}&limit=${limit}&raw_json=1`,
    },
    {
      source: "hot",
      url: `https://www.reddit.com/r/${encodeURIComponent(sub)}/hot.json?limit=${limit}&raw_json=1`,
    },
    {
      source: "new",
      url: `https://www.reddit.com/r/${encodeURIComponent(sub)}/new.json?limit=${limit}&raw_json=1`,
    },
  ];

  const errors = [];
  for (let i = 0; i < attempts.length; i += 1) {
    const attempt = attempts[i];
    const sourceState = runtimeState.persisted.sources[attempt.source] || emptySourceState();
    const nowMs = toNow();
    touchHalfOpenIfReady(sourceState, nowMs);

    if (isSourceBlocked(sourceState, nowMs)) {
      const err = "blocked_by_circuit_breaker";
      errors.push(`${attempt.source}:${err}`);
      markRunSourceAttempt(runtimeState.runSourceHealth, attempt.source, { ok: false, blocked: true, error: err });
      markPersistentSourceAttempt(runtimeState.persisted, attempt.source, { ok: false, status: 0, error: err, blocked: true, latencyMs: 0 });
      continue;
    }

    const res = await fetchJsonWithProfileFallback(attempt.url, runtimeState, attempt.source);
    if (!res.ok) {
      const err = res.error || `HTTP ${res.status || 0}`;
      errors.push(`${attempt.source}:${err}`);
      markRunSourceAttempt(runtimeState.runSourceHealth, attempt.source, { ok: false, latencyMs: res.latencyMs, error: err });
      markPersistentSourceAttempt(runtimeState.persisted, attempt.source, {
        ok: false,
        status: res.status,
        error: err,
        latencyMs: res.latencyMs,
      });

      const backoffMs = computeAdaptiveBackoffMs({
        failureStreak: runtimeState.persisted.sources[attempt.source]?.failure_streak || 1,
        sourceAttempt: i,
      });
      await sleep(backoffMs);
      continue;
    }

    const posts = (res.data?.data?.children || []).map((c) => c.data || {}).filter((p) => p && p.title);
    if (!posts.length) {
      const err = "empty";
      errors.push(`${attempt.source}:${err}`);
      markRunSourceAttempt(runtimeState.runSourceHealth, attempt.source, { ok: false, latencyMs: res.latencyMs, error: err });
      markPersistentSourceAttempt(runtimeState.persisted, attempt.source, {
        ok: false,
        status: res.status,
        error: err,
        latencyMs: res.latencyMs,
      });
      continue;
    }

    markRunSourceAttempt(runtimeState.runSourceHealth, attempt.source, { ok: true, latencyMs: res.latencyMs });
    markPersistentSourceAttempt(runtimeState.persisted, attempt.source, {
      ok: true,
      status: res.status,
      latencyMs: res.latencyMs,
    });

    return { subreddit: sub, ok: true, source: attempt.source, status: res.status, posts, errors };
  }

  const rssSource = "rss";
  const rssState = runtimeState.persisted.sources[rssSource] || emptySourceState();
  const nowMs = toNow();
  touchHalfOpenIfReady(rssState, nowMs);

  if (isSourceBlocked(rssState, nowMs)) {
    const err = "blocked_by_circuit_breaker";
    errors.push(`${rssSource}:${err}`);
    markRunSourceAttempt(runtimeState.runSourceHealth, rssSource, { ok: false, blocked: true, error: err });
    markPersistentSourceAttempt(runtimeState.persisted, rssSource, { ok: false, status: 0, error: err, blocked: true, latencyMs: 0 });
    return {
      subreddit: sub,
      ok: false,
      status: 0,
      source: "none",
      posts: [],
      error: errors.join(" | ") || "all_fallbacks_failed",
      errors,
    };
  }

  const rssUrl = `https://www.reddit.com/r/${encodeURIComponent(sub)}/top.rss?t=${encodeURIComponent(timeWindow)}`;
  const rssRes = await fetchTextWithProfileFallback(rssUrl, runtimeState, rssSource);
  if (!rssRes.ok) {
    const err = rssRes.error || `HTTP ${rssRes.status || 0}`;
    errors.push(`${rssSource}:${err}`);
    markRunSourceAttempt(runtimeState.runSourceHealth, rssSource, { ok: false, latencyMs: rssRes.latencyMs, error: err });
    markPersistentSourceAttempt(runtimeState.persisted, rssSource, {
      ok: false,
      status: rssRes.status,
      error: err,
      latencyMs: rssRes.latencyMs,
    });
    return {
      subreddit: sub,
      ok: false,
      status: 0,
      source: "none",
      posts: [],
      error: errors.join(" | ") || "all_fallbacks_failed",
      errors,
    };
  }

  const items = parseRssItems(rssRes.body).slice(0, limit);
  if (!items.length) {
    const err = "empty";
    errors.push(`${rssSource}:${err}`);
    markRunSourceAttempt(runtimeState.runSourceHealth, rssSource, { ok: false, latencyMs: rssRes.latencyMs, error: err });
    markPersistentSourceAttempt(runtimeState.persisted, rssSource, {
      ok: false,
      status: rssRes.status,
      error: err,
      latencyMs: rssRes.latencyMs,
    });
    return {
      subreddit: sub,
      ok: false,
      status: 0,
      source: "none",
      posts: [],
      error: errors.join(" | ") || "all_fallbacks_failed",
      errors,
    };
  }

  markRunSourceAttempt(runtimeState.runSourceHealth, rssSource, { ok: true, latencyMs: rssRes.latencyMs });
  markPersistentSourceAttempt(runtimeState.persisted, rssSource, {
    ok: true,
    status: rssRes.status,
    latencyMs: rssRes.latencyMs,
  });

  return {
    subreddit: sub,
    ok: true,
    source: rssSource,
    status: rssRes.status,
    posts: items.map((it) => normalizeRssPost(it, sub)),
    errors,
  };
}

function rankScore(p) {
  return Number(p.score || 0) * 1 + Number(p.num_comments || 0) * 0.25;
}

function qualityBoost(post, rules) {
  const txt = `${post.title || ""} ${post.selftext || ""}`.toLowerCase();
  let boost = 0;
  for (const k of rules.preferredKeywords) {
    if (txt.includes(k)) boost += 20;
  }
  return boost;
}

function qualityScore(post, rules) {
  return rankScore(post) + qualityBoost(post, rules);
}

function toItem(p) {
  return {
    id: p.id,
    title: p.title,
    score: Number(p.score || 0),
    comments: Number(p.num_comments || 0),
    url: `https://reddit.com${p.permalink || ""}`,
    created_utc: Number(p.created_utc || 0),
    subreddit: p.subreddit,
    rank_score: rankScore(p),
  };
}

function toTopicHints(posts, rules) {
  const hits = new Map();
  for (const p of posts) {
    const txt = `${p.title || ""} ${p.selftext || ""}`.toLowerCase();
    for (const k of rules.preferredKeywords) {
      if (txt.includes(k)) {
        hits.set(k, (hits.get(k) || 0) + 1);
      }
    }
  }
  return Array.from(hits.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k]) => k);
}

function appendDailyMemory(out) {
  const day = out.generated_at.slice(0, 10);
  const dailyPath = path.join(DAILY_MEM_DIR, `${day}.md`);
  fs.mkdirSync(DAILY_MEM_DIR, { recursive: true });
  const lines = [];
  lines.push(`\n- ${out.generated_at} digest_run: window=${out.window} per_subreddit=${out.per_subreddit}`);
  lines.push(`  selected_posts=${out.results.reduce((sum, r) => sum + (r.posts?.length || 0), 0)} subreddits=${out.results.length}`);
  lines.push(`  blocked_by_rules=${out.metrics.blocked_by_rules} blocked_by_threshold=${out.metrics.blocked_by_threshold}`);
  lines.push(`  source_health=${JSON.stringify(out.source_health_summary.counts)}`);
  lines.push(`  top_topic_hints=${out.topic_hints.join(", ") || "none"}`);
  fs.appendFileSync(dailyPath, lines.join("\n") + "\n");
}

const AUTH_PROFILES = buildAuthProfiles();

(async function main() {
  const t = arg("--window", "day");
  const perSub = Math.max(1, Number(arg("--per-subreddit", "3")) || 3);
  const rules = readRulesFromMemory();

  const runtimeState = {
    persisted: loadPersistentState(),
    runSourceHealth: initRunSourceHealth(),
    authProfiles: AUTH_PROFILES,
    authCursor: 0,
  };

  const all = [];
  let blockedByRules = 0;
  let blockedByThreshold = 0;

  for (const s of SUBS) {
    try {
      const r = await fetchTop(s, t, 12, runtimeState);
      if (!r.ok) {
        all.push({ subreddit: s, source: r.source || "none", error: r.error || `HTTP ${r.status || 0}`, posts: [] });
        continue;
      }

      const filteredByRules = r.posts.filter((p) => {
        const pass = passesFilters(p, rules);
        if (!pass) blockedByRules += 1;
        return pass;
      });

      const ranked = filteredByRules
        .map((p) => ({ post: p, q: qualityScore(p, rules) }))
        .sort((a, b) => b.q - a.q);

      const thresholded = ranked.filter((x) => {
        const p = x.post;
        const pass =
          Number(p.score || 0) >= rules.minScore &&
          Number(p.num_comments || 0) >= rules.minComments &&
          x.q >= rules.minRankScore;
        if (!pass) blockedByThreshold += 1;
        return pass;
      });

      const selected = thresholded.slice(0, perSub).map((x) => toItem(x.post));
      const topicHints = toTopicHints(selected, rules);
      all.push({
        subreddit: s,
        source: r.source || "unknown",
        why_it_matters: topicHints.length
          ? `Signal leaning toward: ${topicHints.join(", ")}`
          : "No strong tactical signal in current top posts.",
        posts: selected,
      });
    } catch (e) {
      all.push({ subreddit: s, source: "none", error: e.message, posts: [] });
    }
  }

  const sourceHealthSummary = summarizeSourceHealth(runtimeState.runSourceHealth, runtimeState.persisted);

  const out = {
    generated_at: new Date().toISOString(),
    window: t,
    per_subreddit: perSub,
    rules: {
      banned_keywords: rules.bannedKeywords,
      preferred_keywords: rules.preferredKeywords,
      avoid_title_patterns: rules.avoidTitlePatterns,
      min_score: rules.minScore,
      min_comments: rules.minComments,
      min_rank_score: rules.minRankScore,
    },
    metrics: {
      blocked_by_rules: blockedByRules,
      blocked_by_threshold: blockedByThreshold,
      source_status_counts: sourceHealthSummary.counts,
      auth_profile_count: runtimeState.authProfiles.length,
    },
    source_health_summary: sourceHealthSummary,
    auth_profile_health: runtimeState.persisted.auth_profiles,
    topic_hints: toTopicHints(
      all.flatMap((r) => (r.posts || []).map((p) => ({ title: p.title, selftext: "" }))),
      rules
    ),
    results: all,
    feedback_prompt: "Did you like this list? What should be added/removed tomorrow?",
  };

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = Date.now();
  const jsonPath = path.join(REPORT_DIR, `${stamp}-reddit-digest.json`);
  const mdPath = path.join(REPORT_DIR, `${stamp}-reddit-digest.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2));
  fs.writeFileSync(LATEST_JSON_PATH, JSON.stringify(out, null, 2));

  const md = [];
  md.push("# Reddit Digest");
  md.push("");
  md.push(`Generated: ${out.generated_at}`);
  md.push(`Window: ${out.window}`);
  md.push(`Filter: banned keywords = ${rules.bannedKeywords.join(", ")}`);
  md.push(`Preference boost: ${rules.preferredKeywords.join(", ")}`);
  md.push(`Thresholds: min_score=${rules.minScore}, min_comments=${rules.minComments}, min_rank_score=${rules.minRankScore}`);
  md.push(`Dropped: rule_filter=${blockedByRules}, threshold_filter=${blockedByThreshold}`);
  md.push("");
  md.push("## Source Health");
  md.push(`Status counts: ${JSON.stringify(sourceHealthSummary.counts)}`);
  for (const row of sourceHealthSummary.providers) {
    md.push(
      `- ${row.source}: status=${row.status}, attempts=${row.attempts}, successes=${row.successes}, failures=${row.failures}, blocked=${row.blocked ? "yes" : "no"}, failure_streak=${row.failure_streak}, no_progress_streak=${row.no_progress_streak}`
    );
  }
  md.push("");

  for (const r of all) {
    md.push(`## r/${r.subreddit}`);
    if (r.source) md.push(`- Source: ${r.source}`);
    if (r.error) {
      md.push(`- Error: ${r.error}`);
      md.push("");
      continue;
    }
    if (r.why_it_matters) md.push(`- Why it matters: ${r.why_it_matters}`);
    if (!r.posts.length) {
      md.push("- No qualifying posts.");
      md.push("");
      continue;
    }
    for (const p of r.posts) {
      md.push(`- [${p.title}](${p.url}) · score ${p.score} · comments ${p.comments}`);
    }
    md.push("");
  }
  md.push(`**Feedback:** ${out.feedback_prompt}`);
  fs.writeFileSync(mdPath, md.join("\n"));
  fs.writeFileSync(LATEST_MD_PATH, md.join("\n"));

  appendDailyMemory(out);
  savePersistentState(runtimeState.persisted);

  console.log("=== Reddit Digest ===");
  console.log(`report_json: ${jsonPath}`);
  console.log(`report_md: ${mdPath}`);
  console.log(`latest_json: ${LATEST_JSON_PATH}`);
  console.log(`latest_md: ${LATEST_MD_PATH}`);
  console.log(`state: ${STATE_PATH}`);
  console.log(`feedback: ${out.feedback_prompt}`);
})();
