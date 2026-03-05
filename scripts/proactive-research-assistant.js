#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const pg = require("../infra/postgres");

let google;
try {
  google = require("googleapis").google;
} catch {
  google = null;
}

const ARGS = process.argv.slice(2);
const DRY_RUN = ARGS.includes("--dry-run");
const IGNORE_HISTORY = ARGS.includes("--ignore-history");
const CAL_HOURS = Math.max(12, Number(arg("--calendar-hours", "72")) || 72);
const MAX_EMAIL = Math.max(10, Number(arg("--email-limit", "30")) || 30);
const MAX_TRIGGERS = Math.max(5, Number(arg("--max-triggers", "20")) || 20);
const REPORT_DIR = path.join(__dirname, "reports");
const STATE_DIR = path.join(__dirname, "..", "artifacts", "proactive-research");
const STATE_FILE = path.join(STATE_DIR, "state.json");

function arg(flag, fallback = null) {
  const i = ARGS.indexOf(flag);
  return i >= 0 ? ARGS[i + 1] : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function toTs(s) {
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.getTime() : null;
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { seen: {} };
  }
}

function saveState(state) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function pruneState(state, keepDays = 10) {
  const keepMs = keepDays * 86400000;
  const now = Date.now();
  const out = { seen: {} };
  for (const [k, v] of Object.entries(state.seen || {})) {
    const t = toTs(v);
    if (t && now - t <= keepMs) out.seen[k] = v;
  }
  return out;
}

function fp(obj) {
  return crypto.createHash("sha256").update(JSON.stringify(obj)).digest("hex");
}

function inferCompetitors(text) {
  const known = [
    "openai", "anthropic", "google", "meta", "microsoft", "perplexity", "notion", "airtable",
    "zapier", "make", "clickup", "asana", "monday", "hubspot", "salesforce", "shopify", "ebay", "etsy",
  ];
  const t = String(text || "").toLowerCase();
  return known.filter((k) => t.includes(k));
}

function isLikelyMarketingEmail(msg) {
  const from = String(msg.from || "").toLowerCase();
  const subject = String(msg.subject || "").toLowerCase();
  const snippet = String(msg.snippet || "").toLowerCase();
  const text = `${subject} ${snippet}`;
  if (/(noreply|no-reply|newsletter|marketing|mailer-daemon)/.test(from)) return true;
  if (/(unsubscribe|view in browser|manage preferences)/.test(text)) return true;
  if (/(sale|off\\s|last call|limited time|shop now|new arrivals|deal)/.test(text)) return true;
  return false;
}

function normalizeTopic(text) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, 140);
}

function getGoogleClient() {
  const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  const REFRESH_TOKEN = process.env.GOOGLE_OAUTH_REFRESH_TOKEN || process.env.GOOGLE_REFRESH_TOKEN;
  const REDIRECT_URI = process.env.GOOGLE_OAUTH_REDIRECT_URI || "urn:ietf:wg:oauth:2.0:oob";

  if (!google || !CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) return null;

  const auth = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
  auth.setCredentials({ refresh_token: REFRESH_TOKEN });
  return auth;
}

async function fetchCalendarSignals(auth) {
  if (!auth) return { enabled: false, events: [], error: "google_oauth_missing" };
  try {
    const cal = google.calendar({ version: "v3", auth });
    const timeMin = new Date();
    const timeMax = new Date(Date.now() + CAL_HOURS * 3600000);
    const res = await cal.events.list({
      calendarId: "primary",
      singleEvents: true,
      orderBy: "startTime",
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      maxResults: 30,
    });
    const items = Array.isArray(res.data.items) ? res.data.items : [];
    const events = items.map((e) => ({
      id: e.id,
      summary: e.summary || "(untitled)",
      start: e.start?.dateTime || e.start?.date || null,
      attendees: (e.attendees || []).map((a) => a.email).filter(Boolean),
      location: e.location || "",
      description: e.description || "",
    }));
    return { enabled: true, events };
  } catch (err) {
    return { enabled: true, events: [], error: err.message };
  }
}

async function fetchGmailSignals(auth) {
  if (!auth) return { enabled: false, emails: [], error: "google_oauth_missing" };
  try {
    const gmail = google.gmail({ version: "v1", auth });
    const list = await gmail.users.messages.list({
      userId: "me",
      maxResults: MAX_EMAIL,
      q: "newer_than:3d in:inbox -category:promotions -category:social -category:updates",
    });
    const msgs = Array.isArray(list.data.messages) ? list.data.messages : [];
    const out = [];
    for (const m of msgs.slice(0, MAX_EMAIL)) {
      const msg = await gmail.users.messages.get({
        userId: "me",
        id: m.id,
        format: "metadata",
        metadataHeaders: ["From", "Subject", "Date"],
      });
      const h = {};
      for (const x of (msg.data.payload?.headers || [])) h[x.name.toLowerCase()] = x.value;
      out.push({
        id: m.id,
        from: h.from || "",
        subject: h.subject || "",
        date: h.date || "",
        snippet: msg.data.snippet || "",
      });
    }
    return { enabled: true, emails: out };
  } catch (err) {
    return { enabled: true, emails: [], error: err.message };
  }
}

async function fetchProjectSignals() {
  const [plans, tasks, repo] = await Promise.all([
    pg.query(
      `SELECT id, goal, status, created_at
         FROM plans
        WHERE created_at >= NOW() - INTERVAL '3 days'
        ORDER BY created_at DESC
        LIMIT 30`
    ).catch(() => ({ rows: [] })),
    pg.query(
      `SELECT id, type, status, created_at, payload
         FROM tasks
        WHERE created_at >= NOW() - INTERVAL '3 days'
        ORDER BY created_at DESC
        LIMIT 60`
    ).catch(() => ({ rows: [] })),
    pg.query(
      `SELECT v.repo_name, v.code, v.severity, v.detail
         FROM github_repo_violations v
         JOIN github_repo_scan_runs r ON r.id = v.run_id
        WHERE r.finished_at >= NOW() - INTERVAL '3 days'
        ORDER BY r.finished_at DESC
        LIMIT 40`
    ).catch(() => ({ rows: [] })),
  ]);

  return {
    plans: plans.rows || [],
    tasks: tasks.rows || [],
    violations: repo.rows || [],
  };
}

function buildTriggers(calendarData, gmailData, projectData) {
  const out = [];

  for (const e of calendarData.events || []) {
    const personDomains = (e.attendees || [])
      .map((x) => String(x).split("@")[1] || "")
      .filter((d) => d && !["gmail.com", "yahoo.com", "outlook.com", "icloud.com"].includes(d));

    out.push({
      kind: "meeting_prep",
      title: `Prepare research brief for meeting: ${normalizeTopic(e.summary)}`,
      trigger: `Calendar event at ${e.start || "unknown"}`,
      topic: normalizeTopic(`${e.summary} ${e.location} ${e.description}`),
      competitors: inferCompetitors(`${e.summary} ${e.description}`),
      entities: [...new Set(personDomains)].slice(0, 5),
      priority: 1,
    });
  }

  for (const m of gmailData.emails || []) {
    if (isLikelyMarketingEmail(m)) continue;
    const text = `${m.subject} ${m.snippet}`;
    const t = text.toLowerCase();

    if (/(meeting|call|intro|sync|discussion|tomorrow|next week)/i.test(text)) {
      out.push({
        kind: "meeting_context",
        title: `Research context from email thread: ${normalizeTopic(m.subject)}`,
        trigger: `Email from ${m.from}`,
        topic: normalizeTopic(text),
        competitors: inferCompetitors(text),
        entities: [],
        priority: 2,
      });
    }

    if (/(blog|post|newsletter|landing page|copy|script|thread|proposal)/i.test(text)) {
      out.push({
        kind: "writing_prep",
        title: `Prepare source pack for writing topic: ${normalizeTopic(m.subject)}`,
        trigger: `Email writing signal from ${m.from}`,
        topic: normalizeTopic(text),
        competitors: inferCompetitors(text),
        entities: [],
        priority: 2,
      });
    }

    if (/(competitor|alternative|vs\.?|compare|switching from|moving from)/i.test(t)) {
      out.push({
        kind: "competitor_watch",
        title: `Competitor mention detected: ${normalizeTopic(m.subject)}`,
        trigger: `Email competitor signal from ${m.from}`,
        topic: normalizeTopic(text),
        competitors: inferCompetitors(text),
        entities: [],
        priority: 1,
      });
    }
  }

  for (const p of projectData.plans || []) {
    const g = String(p.goal || "");
    if (!g) continue;
    if (/(inventory|dashboard|shopify|ebay|etsy|channel|catalog|listing|order)/i.test(g)) {
      out.push({
        kind: "project_goal",
        title: `Project research needed: ${normalizeTopic(g)}`,
        trigger: `Plan ${p.id} (${p.status})`,
        topic: normalizeTopic(g),
        competitors: inferCompetitors(g),
        entities: [],
        priority: 2,
      });
    }
  }

  for (const v of projectData.violations || []) {
    const d = `${v.code || ""} ${v.detail || ""}`;
    out.push({
      kind: "repo_risk",
      title: `Repo issue research: ${v.repo_name} ${v.code}`,
      trigger: `Repo violation ${v.severity || "unknown"}`,
      topic: normalizeTopic(d),
      competitors: [],
      entities: [v.repo_name].filter(Boolean),
      priority: 1,
    });
  }

  const dedup = new Map();
  for (const t of out) {
    const key = fp([t.kind, t.title, t.topic]);
    if (!dedup.has(key)) dedup.set(key, { ...t, key });
  }

  return [...dedup.values()]
    .sort((a, b) => a.priority - b.priority)
    .slice(0, MAX_TRIGGERS);
}

function computeQueries(trigger) {
  const q = [];
  q.push(`${trigger.topic} market context 2026`);
  q.push(`${trigger.topic} implementation patterns`);
  if (trigger.entities?.length) {
    for (const e of trigger.entities.slice(0, 2)) q.push(`${e} company profile latest`);
  }
  if (trigger.competitors?.length) {
    for (const c of trigger.competitors.slice(0, 2)) q.push(`${c} pricing features comparison`);
  }
  return [...new Set(q)].slice(0, 6);
}

function buildBrief(triggers) {
  return triggers.map((t, i) => ({
    rank: i + 1,
    kind: t.kind,
    title: t.title,
    trigger: t.trigger,
    topic: t.topic,
    competitors: t.competitors,
    entities: t.entities,
    research_queries: computeQueries(t),
    action_items: [
      "Collect 3-5 primary sources and one benchmark.",
      "Draft concise findings with direct decision impact.",
      "Queue follow-up tasks for implementation or copy updates.",
    ],
  }));
}

function runResearchPipelines(triggers) {
  if (!triggers.length) return [];
  const actions = [];
  const cmds = [
    "npm run -s research:sync -- --limit 40 --days 30",
    "npm run -s research:signals -- --limit 300 --days 30",
  ];
  for (const cmd of cmds) {
    const r = spawnSync("bash", ["-lc", cmd], {
      cwd: path.join(__dirname, ".."),
      encoding: "utf8",
      timeout: 20 * 60 * 1000,
      env: { ...process.env, CI: "1" },
    });
    actions.push({
      command: cmd,
      ok: Number(r.status || 0) === 0,
      code: Number(r.status || 0),
      stdout_tail: String(r.stdout || "").slice(-1000),
      stderr_tail: String(r.stderr || "").slice(-1000),
    });
  }
  return actions;
}

(async function main() {
  try {
  const state0 = IGNORE_HISTORY ? { seen: {} } : pruneState(loadState());
  const auth = getGoogleClient();

  const [calendarData, gmailData, projectData] = await Promise.all([
    fetchCalendarSignals(auth),
    fetchGmailSignals(auth),
    fetchProjectSignals(),
  ]);

  const triggersRaw = buildTriggers(calendarData, gmailData, projectData);
  const freshTriggers = [];
  for (const t of triggersRaw) {
    if (!state0.seen[t.key]) freshTriggers.push(t);
  }

  const brief = buildBrief(freshTriggers);
  const pipelineRuns = DRY_RUN ? [] : runResearchPipelines(freshTriggers);

  const report = {
    generated_at: nowIso(),
    dry_run: DRY_RUN,
    sources: {
      calendar_enabled: calendarData.enabled,
      calendar_error: calendarData.error || null,
      calendar_events: (calendarData.events || []).length,
      gmail_enabled: gmailData.enabled,
      gmail_error: gmailData.error || null,
      gmail_messages: (gmailData.emails || []).length,
      plans: (projectData.plans || []).length,
      tasks: (projectData.tasks || []).length,
      repo_violations: (projectData.violations || []).length,
    },
    triggers_detected: triggersRaw.length,
    triggers_new: freshTriggers.length,
    brief,
    pipeline_runs: pipelineRuns,
    feedback_prompt: "Did this proactive research pack help? What should be prioritized next?",
  };

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = Date.now();
  const jsonPath = path.join(REPORT_DIR, `${stamp}-proactive-research-assistant.json`);
  const mdPath = path.join(REPORT_DIR, `${stamp}-proactive-research-assistant.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  const md = [];
  md.push("# Proactive Research Assistant");
  md.push("");
  md.push(`Generated: ${report.generated_at}`);
  md.push(`New triggers: ${report.triggers_new} / ${report.triggers_detected}`);
  md.push("");
  md.push("## Source Health");
  md.push(`- Calendar: ${report.sources.calendar_enabled ? "enabled" : "disabled"} (events=${report.sources.calendar_events})${report.sources.calendar_error ? ` error=${report.sources.calendar_error}` : ""}`);
  md.push(`- Gmail: ${report.sources.gmail_enabled ? "enabled" : "disabled"} (messages=${report.sources.gmail_messages})${report.sources.gmail_error ? ` error=${report.sources.gmail_error}` : ""}`);
  md.push(`- Project plans: ${report.sources.plans}`);
  md.push(`- Repo violations: ${report.sources.repo_violations}`);
  md.push("");
  md.push("## Ready Research Briefs");
  if (!brief.length) {
    md.push("- No new triggers detected in this run.");
  } else {
    for (const b of brief) {
      md.push(`### ${b.rank}. ${b.title}`);
      md.push(`- Trigger: ${b.trigger}`);
      md.push(`- Topic: ${b.topic}`);
      if (b.competitors?.length) md.push(`- Competitors: ${b.competitors.join(", ")}`);
      if (b.entities?.length) md.push(`- Entities: ${b.entities.join(", ")}`);
      md.push("- Queries:");
      for (const q of b.research_queries) md.push(`  - ${q}`);
      md.push("- Action items:");
      for (const a of b.action_items) md.push(`  - ${a}`);
      md.push("");
    }
  }
  md.push(`Feedback: ${report.feedback_prompt}`);
  fs.writeFileSync(mdPath, md.join("\n"));

  for (const t of freshTriggers) state0.seen[t.key] = nowIso();
  saveState(state0);

  console.log("=== Proactive Research Assistant ===");
  console.log(`report_json: ${jsonPath}`);
  console.log(`report_md: ${mdPath}`);
  console.log(`new_triggers: ${freshTriggers.length}`);
  } catch (err) {
    console.error("[proactive-research-assistant] fatal:", err.message);
    process.exitCode = 1;
  } finally {
    try { await pg.end(); } catch {}
    process.exit(process.exitCode || 0);
  }
})();
