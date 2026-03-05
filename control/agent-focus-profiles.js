"use strict";

const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "..", "config", "agent-focus-profiles.json");

let _cache = null;
let _cacheMtimeMs = 0;

function uniqStrings(values) {
  const out = [];
  const seen = new Set();
  for (const v of values || []) {
    const s = String(v || "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function safeArray(values) {
  return Array.isArray(values) ? values : [];
}

function normalizeProfile(raw) {
  const id = String(raw?.id || "").trim().toLowerCase();
  if (!id) return null;

  const skills = uniqStrings(safeArray(raw.skills));
  const profile = {
    id,
    name: String(raw?.name || id).trim(),
    intent: String(raw?.intent || "").trim(),
    purpose: String(raw?.purpose || "").trim(),
    drive: String(raw?.drive || "").trim(),
    goals: uniqStrings(safeArray(raw.goals)),
    skills: skills.slice(0, 10),
    kpis: uniqStrings(safeArray(raw.kpis)),
    required_tags: uniqStrings(safeArray(raw.required_tags).map((x) => String(x || "").toLowerCase())),
    symbol_research_focus: uniqStrings(safeArray(raw.symbol_research_focus).map((x) => String(x || "").toLowerCase())),
    task_types: uniqStrings(safeArray(raw.task_types)),
    agent_selectors: uniqStrings(safeArray(raw.agent_selectors).map((x) => String(x || "").toLowerCase())),
  };

  // Enforce 7-10 skills per focus profile. Keep runtime resilient by truncating
  // or skipping invalid profiles rather than crashing the full dispatcher.
  if (profile.skills.length < 7) {
    return null;
  }

  return profile;
}

function readConfig() {
  const stat = fs.statSync(CONFIG_PATH);
  if (_cache && stat.mtimeMs === _cacheMtimeMs) {
    return _cache;
  }

  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  if (!Array.isArray(raw)) {
    throw new Error("agent-focus-profiles.json must be an array");
  }

  const normalized = [];
  const seen = new Set();
  for (const p of raw) {
    const n = normalizeProfile(p);
    if (!n) continue;
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    normalized.push(n);
  }

  if (!normalized.length) {
    throw new Error("No valid focus profiles found (need at least one with 7-10 skills)");
  }

  _cache = normalized;
  _cacheMtimeMs = stat.mtimeMs;
  return _cache;
}

function loadFocusProfiles(opts = {}) {
  if (opts?.reload) {
    _cache = null;
    _cacheMtimeMs = 0;
  }
  return readConfig();
}

function compactProfileProjection(profile, opts = {}) {
  if (!profile) return null;
  const maxGoals = Math.max(1, Number(opts.maxGoals || 3));
  const maxSkills = Math.max(1, Math.min(10, Number(opts.maxSkills || 10)));
  return {
    id: profile.id,
    name: profile.name,
    intent: profile.intent,
    purpose: profile.purpose,
    drive: profile.drive,
    goals: (profile.goals || []).slice(0, maxGoals),
    skills: (profile.skills || []).slice(0, maxSkills),
    kpis: (profile.kpis || []).slice(0, 4),
  };
}

function scoreProfile(profile, taskType, payload, opts = {}) {
  let score = 0;
  const reasons = [];
  const agentId = String(opts.agentId || "").trim().toLowerCase();

  if (profile.task_types.includes(taskType)) {
    score += 100;
    reasons.push("task_type_match");
  }

  const requiredTags = uniqStrings(safeArray(opts.requiredTags).map((x) => String(x || "").toLowerCase()));
  if (requiredTags.length && profile.required_tags.length) {
    const overlap = requiredTags.filter((t) => profile.required_tags.includes(t));
    if (overlap.length) {
      score += overlap.length * 18;
      reasons.push(`tag_overlap:${overlap.join(",")}`);
    }
  }

  if (agentId && profile.agent_selectors.includes(agentId)) {
    score += 35;
    reasons.push("agent_selector_match");
  }

  const sourceText = [
    taskType,
    opts.title || "",
    opts.goal || "",
    opts.purpose || "",
    JSON.stringify(payload || {}),
  ].join(" ").toLowerCase();

  const focusHits = profile.symbol_research_focus.filter((k) => sourceText.includes(k));
  if (focusHits.length) {
    score += Math.min(30, focusHits.length * 6);
    reasons.push(`focus_hits:${focusHits.slice(0, 4).join(",")}`);
  }

  if (taskType.includes("payclaw") && profile.id === "payclaw_collections") {
    score += 25;
    reasons.push("payclaw_bias");
  }
  if (taskType.includes("quant") && profile.id === "quantfusion_trading") {
    score += 25;
    reasons.push("quant_bias");
  }

  return { profile, score, reasons };
}

function defaultProfileFor(taskType, profiles) {
  if (taskType.startsWith("qa_")) {
    return profiles.find((p) => p.id === "qa_symbolic") || null;
  }
  if (taskType.startsWith("security_")) {
    return profiles.find((p) => p.id === "security_compliance") || null;
  }
  if (taskType.startsWith("quant_")) {
    return profiles.find((p) => p.id === "quantfusion_trading") || null;
  }
  return (
    profiles.find((p) => p.id === "repo_engineering") ||
    profiles.find((p) => p.id === "infra_reliability") ||
    profiles[0] ||
    null
  );
}

function resolveProfileForTask(taskType, payload = {}, opts = {}) {
  const profiles = loadFocusProfiles();
  const ranked = profiles
    .map((p) => scoreProfile(p, String(taskType || ""), payload, opts))
    .sort((a, b) => b.score - a.score || a.profile.id.localeCompare(b.profile.id));

  const candidates = ranked.filter((x) => x.score > 0);
  const primary = (candidates[0] && candidates[0].profile) || defaultProfileFor(taskType, profiles);

  return {
    primary,
    candidates: (candidates.length ? candidates : ranked).slice(0, 3).map((x) => x.profile),
    reasons: candidates[0]?.reasons || [],
  };
}

function resolveProfilesForAgent(agentId, agentConfig = {}) {
  const profiles = loadFocusProfiles();
  const normalizedAgentId = String(agentId || "").trim().toLowerCase();
  const explicit = uniqStrings(safeArray(agentConfig.focus_profiles).map((x) => String(x || "").toLowerCase()));

  if (explicit.length) {
    const byId = new Map(profiles.map((p) => [p.id, p]));
    const selected = explicit.map((id) => byId.get(id)).filter(Boolean);
    if (selected.length) return selected;
  }

  const selectorMatches = profiles.filter((p) => p.agent_selectors.includes(normalizedAgentId));
  if (selectorMatches.length) return selectorMatches;

  const keywordMap = [
    ["payclaw", "payclaw_collections"],
    ["quant", "quantfusion_trading"],
    ["security", "security_compliance"],
    ["research", "research_intelligence"],
    ["data", "data_pipeline"],
    ["content", "content_conversion"],
    ["code", "repo_engineering"],
    ["debug", "qa_symbolic"],
    ["system", "infra_reliability"],
  ];

  const matchedIds = keywordMap
    .filter(([needle]) => normalizedAgentId.includes(needle))
    .map(([, profileId]) => profileId);

  const matched = profiles.filter((p) => matchedIds.includes(p.id));
  if (matched.length) return matched;

  return profiles.filter((p) => ["repo_engineering", "infra_reliability"].includes(p.id)).slice(0, 2);
}

module.exports = {
  loadFocusProfiles,
  resolveProfileForTask,
  resolveProfilesForAgent,
  compactProfileProjection,
};
