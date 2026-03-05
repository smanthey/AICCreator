"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const STATE_ROOT = path.join(ROOT, "agent-state");

// ─── Utilities ────────────────────────────────────────────────────────────────

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function readText(filePath, fallback = "") {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return fallback;
  }
}

function writeIfMissing(filePath, content) {
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, content);
}

function dateKey(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function yesterdayKey(d = new Date()) {
  const y = new Date(d.getTime() - 24 * 60 * 60 * 1000);
  return dateKey(y);
}

function agentDir(agent) {
  return path.join(STATE_ROOT, "agents", String(agent || "unknown").trim().toLowerCase());
}

function todayLogPath(agent) {
  return path.join(agentDir(agent), "memory", `${dateKey()}.md`);
}

// ─── Text Metric Extraction ───────────────────────────────────────────────────
// Parses plain-text stdout/stderr for meaningful numbers and signals
// so agents that don't emit JSON still produce real memory entries.

const METRIC_PATTERNS = [
  // Counts
  { re: /(\d+)\s+tasks?\s+queued/i,          label: "tasks_queued" },
  { re: /queued\s+(\d+)\s+tasks?/i,          label: "tasks_queued" },
  { re: /(\d+)\s+repos?\s+(processed|scanned|synced|found|updated)/i, label: "repos" },
  { re: /(\d+)\s+(errors?|failures?|failed)/i, label: "errors" },
  { re: /(\d+)\s+(warnings?)/i,              label: "warnings" },
  { re: /(\d+)\s+leads?\s+(found|added|enriched)/i, label: "leads" },
  { re: /(\d+)\s+records?/i,                 label: "records" },
  { re: /found\s+(\d+)\s+high/i,             label: "high_findings" },
  { re: /(\d+)\s+findings?/i,                label: "findings" },
  { re: /(\d+)\s+signals?/i,                 label: "signals" },
  { re: /(\d+)\s+(files?|items?)\s+(processed|indexed|synced)/i, label: "files" },
  { re: /sharpe[:\s]+([0-9.]+)/i,            label: "sharpe" },
  { re: /\$([0-9,]+\.?\d*)\s+(mrr|arr|revenue)/i, label: "revenue" },
  { re: /([0-9]+\.?\d*)\s*%\s+(success|pass|open)\s+rate/i, label: "rate_pct" },
  { re: /pass(?:ed)?[:\s]+(\d+)/i,           label: "passed" },
  { re: /fail(?:ed)?[:\s]+(\d+)/i,           label: "failed" },
  // Status words
  { re: /\b(complete[d]?|success(?:ful)?|done)\b/i, label: "status", value: "ok" },
  { re: /\b(no\s+new|nothing\s+to\s+do|up.to.date|idle)\b/i, label: "status", value: "idle" },
  { re: /\b(skipped?|dry.run)\b/i,           label: "status", value: "dry_run" },
];

/**
 * Extracts meaningful metrics from plain stdout/stderr text.
 * Returns { metrics: {key: value}, summary_line: string, meaningful: bool }
 */
function extractTextMetrics(stdout = "", stderr = "") {
  const combined = [stdout, stderr].filter(Boolean).join("\n");
  const lines = combined.split("\n").filter((l) => l.trim());

  const metrics = {};

  for (const { re, label, value } of METRIC_PATTERNS) {
    const m = combined.match(re);
    if (m) {
      metrics[label] = value !== undefined ? value : (isNaN(m[1]) ? m[1] : Number(m[1]));
    }
  }

  // Extract first substantive stdout line (skip boilerplate)
  const boilerplate = /^(>|npm|node|=+|---|\s*$|warning:|info:|debug:|\[dotenv@|time=\d{4}-\d{2}-\d{2}|https?:\/\/|tip:)/i;
  const firstReal = lines.find((l) => !boilerplate.test(l) && l.length > 10) || "";

  const metricParts = Object.entries(metrics)
    .filter(([k]) => k !== "status")
    .map(([k, v]) => `${k}=${v}`);

  const status = metrics.status || (stderr && !stdout ? "warn" : "ok");
  const summaryParts = [`status=${status}`, ...metricParts];
  const summary_line = summaryParts.join(" | ");

  const meaningful = metricParts.length > 0 || (firstReal.length > 20 && !firstReal.match(/command completed/i));

  return { metrics, summary_line, firstReal, meaningful };
}

/**
 * Builds a human-readable "learned" string from stdout/stderr
 * when no structured JSON was emitted by the script.
 */
function buildLearnedFromText(stdout = "", stderr = "", agentId = "") {
  const { metrics, firstReal, meaningful } = extractTextMetrics(stdout, stderr);
  const hollow = /^(command completed\.?|done\.?|ok\.?)$/i;

  if (!meaningful && !Object.keys(metrics).length) {
    // Last resort: grab first 300 chars of any output
    const raw = (stdout || stderr || "").slice(0, 300).trim();
    if (raw && !raw.match(/^(npm|node|>)/i) && !hollow.test(raw)) return raw;
    return `${agentId} ran but emitted no structured outcome. Add JSON writeback to the script for compounding memory.`;
  }

  const parts = [];
  if (metrics.tasks_queued)  parts.push(`Queued ${metrics.tasks_queued} tasks`);
  if (metrics.repos)         parts.push(`${metrics.repos} repos touched`);
  if (metrics.errors)        parts.push(`${metrics.errors} errors`);
  if (metrics.high_findings) parts.push(`${metrics.high_findings} high-priority findings`);
  if (metrics.findings)      parts.push(`${metrics.findings} findings`);
  if (metrics.leads)         parts.push(`${metrics.leads} leads`);
  if (metrics.signals)       parts.push(`${metrics.signals} signals`);
  if (metrics.sharpe)        parts.push(`Sharpe ${metrics.sharpe}`);
  if (metrics.passed)        parts.push(`${metrics.passed} passed`);
  if (metrics.failed)        parts.push(`${metrics.failed} failed`);
  if (metrics.status === "idle") parts.push("Nothing new to process");

  if (parts.length) return parts.join(". ") + (firstReal ? `. Context: ${firstReal.slice(0, 120)}` : "");
  return firstReal.slice(0, 300) || "Script completed; no metrics extracted.";
}

// ─── Recent Insights ──────────────────────────────────────────────────────────

/**
 * Reads recent daily log files and extracts all "learned:" lines.
 * Returns deduplicated list of real insights for prelude injection.
 */
function getRecentInsights(agent, lookbackDays = 7) {
  const dir = path.join(agentDir(agent), "memory");
  if (!fs.existsSync(dir)) return [];

  const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  const files = fs.readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .filter((f) => new Date(`${f.slice(0, 10)}T00:00:00Z`).getTime() >= cutoff)
    .sort()
    .reverse();

  const seen = new Set();
  const insights = [];
  const hollow = /command completed|no structured outcome|emitted no|command failed; no output/i;

  for (const file of files) {
    const content = readText(path.join(dir, file), "");
    const matches = content.match(/^- learned: (.+)$/gm) || [];
    for (const m of matches) {
      const val = m.replace(/^- learned: /, "").trim();
      if (!hollow.test(val) && !seen.has(val) && val.length > 10) {
        seen.add(val);
        insights.push(val);
      }
    }
  }

  return insights;
}

/**
 * Returns a stats summary for an agent over lookbackDays.
 * { total_runs, success_runs, fail_runs, success_rate, open_loops }
 */
function getAgentStats(agent, lookbackDays = 7) {
  const dir = path.join(agentDir(agent), "memory");
  if (!fs.existsSync(dir)) return null;

  const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  const files = fs.readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .filter((f) => new Date(`${f.slice(0, 10)}T00:00:00Z`).getTime() >= cutoff);

  let total = 0, success = 0, fail = 0;
  const openLoops = new Set();

  for (const file of files) {
    const content = readText(path.join(dir, file), "");
    const summaries = content.match(/^- summary: (.+)$/gm) || [];
    const loops = content.match(/^- open_loop: (.+)$/gm) || [];
    for (const s of summaries) {
      total++;
      if (/status=ok/i.test(s)) success++;
      else fail++;
    }
    for (const l of loops) {
      openLoops.add(l.replace(/^- open_loop: /, "").trim());
    }
  }

  return {
    total_runs: total,
    success_runs: success,
    fail_runs: fail,
    success_rate: total > 0 ? Math.round((success / total) * 100) : null,
    open_loops: [...openLoops],
  };
}

// ─── Agent Prelude ────────────────────────────────────────────────────────────

async function loadAgentPrelude(agent, opts = {}) {
  const aDir = agentDir(agent);
  const files = [
    path.join(aDir, "SOUL.md"),
    path.join(STATE_ROOT, "USER.md"),
    path.join(aDir, "AGENTS.md"),
    path.join(aDir, "MEMORY.md"),
    path.join(aDir, "memory", `${dateKey()}.md`),
    path.join(aDir, "memory", `${yesterdayKey()}.md`),
    path.join(STATE_ROOT, "shared-context", "FEEDBACK-LOG.md"),
  ];

  const handoffs = Array.isArray(opts.handoffs) ? opts.handoffs : [];
  for (const h of handoffs) files.push(path.join(STATE_ROOT, "handoffs", h));

  const chunks = [];
  const sources = [];
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    const txt = readText(f, "").trim();
    if (!txt) continue;
    chunks.push(`\n[${path.relative(ROOT, f)}]\n${txt}`);
    sources.push(path.relative(ROOT, f));
  }

  // Inject recent non-hollow insights as a compact block
  if (!opts.skipInsights) {
    const insights = getRecentInsights(agent, opts.insightDays || 7);
    if (insights.length > 0) {
      const block = `\n[recent-insights/${agent}]\n${insights.slice(0, 10).map((i) => `- ${i}`).join("\n")}`;
      chunks.push(block);
    }
  }
  
  // Inject SQL memory insights if available
  try {
    const sqlMemory = require("./agent-memory-sql");
    const sqlMemories = await sqlMemory.getRecentMemories(agent, 10, opts.insightDays || 7);
    if (sqlMemories.length > 0) {
      const sqlBlock = `\n[sql-memory/${agent}]\n${sqlMemories
        .filter(m => m.importance_score >= 0.6)
        .slice(0, 5)
        .map((m) => `- [${m.content_type}] ${m.content}`)
        .join("\n")}`;
      chunks.push(sqlBlock);
      sources.push(`sql-memory/${agent}`);
    }
  } catch (err) {
    // SQL memory is optional
    console.warn(`[agent-memory] SQL memory load failed for ${agent}:`, err.message);
  }

  let text = chunks.join("\n\n").trim();
  const maxChars = Number(opts.maxChars || process.env.AGENT_MEMORY_PRELUDE_MAX_CHARS || 12000);
  if (Number.isFinite(maxChars) && maxChars > 0 && text.length > maxChars) {
    text = text.slice(text.length - maxChars);
  }

  return { text, sources };
}

// ─── Log Writing ──────────────────────────────────────────────────────────────

async function appendAgentDailyLog(agent, entry = {}) {
  const aDir = agentDir(agent);
  ensureDir(path.join(aDir, "memory"));
  const f = todayLogPath(agent);
  if (!fs.existsSync(f)) {
    fs.writeFileSync(f, `# ${dateKey()} ${agent}\n\n`);
  }

  const now = new Date().toISOString();
  const lines = [];
  lines.push(`## ${now}`);
  if (entry.goal)           lines.push(`- goal: ${entry.goal}`);
  if (entry.task_type)      lines.push(`- task_type: ${entry.task_type}`);
  if (entry.actions_taken)  lines.push(`- actions_taken: ${entry.actions_taken}`);
  if (entry.summary)        lines.push(`- summary: ${entry.summary}`);
  if (entry.learned)        lines.push(`- learned: ${entry.learned}`);
  if (entry.metrics) {
    const m = typeof entry.metrics === "object"
      ? Object.entries(entry.metrics).map(([k, v]) => `${k}=${v}`).join(" | ")
      : String(entry.metrics);
    if (m) lines.push(`- metrics: ${m}`);
  }
  if (entry.blocker)        lines.push(`- blocker: ${entry.blocker}`);
  if (entry.next_focus)     lines.push(`- next_focus: ${entry.next_focus}`);
  if (entry.tags) {
    const tags = Array.isArray(entry.tags) ? entry.tags : [entry.tags];
    if (tags.filter(Boolean).length) lines.push(`- tags: ${tags.filter(Boolean).join(", ")}`);
  }
  if (entry.model_used)     lines.push(`- model_used: ${entry.model_used}`);
  if (entry.cost_usd != null) lines.push(`- cost_usd: ${entry.cost_usd}`);
  if (entry.open_loops) {
    const loops = Array.isArray(entry.open_loops) ? entry.open_loops : [entry.open_loops];
    for (const loop of loops.filter(Boolean)) lines.push(`- open_loop: ${loop}`);
  }
  lines.push("");
  fs.appendFileSync(f, `${lines.join("\n")}\n`);
  
  // Also store in SQL memory for semantic search
  try {
    const sqlMemory = require("./agent-memory-sql");
    const tags = Array.isArray(entry.tags) ? entry.tags : (entry.tags ? [entry.tags] : []);
    
    // Store learned insights
    if (entry.learned) {
      await sqlMemory.storeMemory({
        agent_id: agent,
        content: entry.learned,
        content_type: "learned",
        metadata: {
          goal: entry.goal,
          task_type: entry.task_type,
          summary: entry.summary,
          metrics: entry.metrics,
        },
        tags: tags,
        task_id: entry.task_id,
        plan_id: entry.plan_id,
        run_id: entry.run_id,
        source: "agent",
      });
    }
    
    // Store blockers
    if (entry.blocker) {
      await sqlMemory.storeMemory({
        agent_id: agent,
        content: entry.blocker,
        content_type: "blocker",
        metadata: { goal: entry.goal, task_type: entry.task_type },
        tags: tags,
        importance_score: 0.8,
      });
    }
    
    // Store strategies/next focus
    if (entry.next_focus) {
      await sqlMemory.storeMemory({
        agent_id: agent,
        content: entry.next_focus,
        content_type: "strategy",
        metadata: { goal: entry.goal },
        tags: tags,
        importance_score: 0.7,
      });
    }
  } catch (err) {
    // SQL memory is optional, don't fail if it's not available
    console.warn(`[agent-memory] SQL storage failed for ${agent}:`, err.message);
  }
  
  return { log_file: path.relative(ROOT, f) };
}

// ─── Feedback ─────────────────────────────────────────────────────────────────

async function addFeedback({ agent = "shared", text = "", source = "manual" }) {
  const clean = String(text || "").trim();
  if (!clean) throw new Error("feedback text is required");

  const now = new Date().toISOString();
  const sharedPath = path.join(STATE_ROOT, "shared-context", "FEEDBACK-LOG.md");
  ensureDir(path.dirname(sharedPath));
  writeIfMissing(sharedPath, "# Feedback Log\n\n");
  fs.appendFileSync(sharedPath, `- ${now} [agent:${agent}] [source:${source}] ${clean}\n`);

  const aDir = agentDir(agent);
  ensureDir(aDir);
  const memPath = path.join(aDir, "MEMORY.md");
  if (!fs.existsSync(memPath)) fs.writeFileSync(memPath, `# ${agent} Memory\n\n`);
  const existing = readText(memPath, "");
  if (!existing.includes(clean)) {
    fs.appendFileSync(memPath, `- ${clean}\n`);
  }

  return {
    feedback_file: path.relative(ROOT, sharedPath),
    memory_file: path.relative(ROOT, memPath),
  };
}

// ─── Compaction ───────────────────────────────────────────────────────────────

function compactAgentMemory(agent, keepDays = 7) {
  const dir = path.join(agentDir(agent), "memory");
  const archive = path.join(agentDir(agent), "archive");
  ensureDir(dir);
  ensureDir(archive);

  const files = fs.readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .sort();
  const cutoff = new Date(Date.now() - keepDays * 24 * 60 * 60 * 1000);
  let moved = 0;
  for (const f of files) {
    const d = new Date(`${f.slice(0, 10)}T00:00:00Z`);
    if (d < cutoff) {
      const from = path.join(dir, f);
      const to = path.join(archive, f);
      fs.renameSync(from, to);
      moved += 1;
    }
  }
  return { moved };
}

// ─── Agent Registry ───────────────────────────────────────────────────────────

function listKnownAgents() {
  const d = path.join(STATE_ROOT, "agents");
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d)
    .filter((x) => fs.statSync(path.join(d, x)).isDirectory())
    .sort();
}

// ─── Exports ──────────────────────────────────────────────────────────────────

// ─── SQL Memory Integration ────────────────────────────────────────────────────

async function searchAgentMemory(agent, query, opts = {}) {
  try {
    const sqlMemory = require("./agent-memory-sql");
    return await sqlMemory.searchMemories({
      agent_id: agent,
      query: query,
      ...opts,
    });
  } catch (err) {
    console.warn(`[agent-memory] SQL search failed for ${agent}:`, err.message);
    return [];
  }
}

module.exports = {
  ROOT,
  STATE_ROOT,
  dateKey,
  yesterdayKey,
  agentDir,
  todayLogPath,
  listKnownAgents,
  loadAgentPrelude,
  appendAgentDailyLog,
  addFeedback,
  compactAgentMemory,
  writeIfMissing,
  ensureDir,
  readText,
  // New exports
  extractTextMetrics,
  buildLearnedFromText,
  getRecentInsights,
  getAgentStats,
  searchAgentMemory,
};
