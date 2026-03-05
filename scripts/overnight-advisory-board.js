#!/usr/bin/env node
"use strict";

/**
 * Overnight Advisory Board
 *
 * Midnight run:
 * - Collects analytics + system health + notes context
 * - Runs 8 expert roles (independent analysis)
 * - Council moderator reconciles disagreements and ranks recommendations
 * - Writes full report to: ~/notes/advisory/YYYY-MM-DD.md
 * - Sends Telegram summary with top 5 recommendations + file path
 *
 * Read-only policy:
 * - This script only reads APIs/files and writes local report artifacts.
 * - Never submits forms/purchases/deletes.
 */

require("dotenv").config();

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const os = require("os");
const Anthropic = require("@anthropic-ai/sdk");
const pg = require("../infra/postgres");
const { notifyMonitoring } = require("../control/monitoring-notify");
const { fetchWithFallback, getAgentPrinciplesPrompt } = require("./agent-toolkit");

const ARGS = process.argv.slice(2);
const DRY_RUN = ARGS.includes("--dry-run");
const SKIP_LLM = DRY_RUN || String(process.env.ADVISORY_SKIP_LLM || "").toLowerCase() === "true";
const TZ = process.env.TZ || "America/Phoenix";
const MODEL_EXPERT = process.env.ADVISORY_MODEL_EXPERT || "claude-sonnet-4-5-20250929";
const MODEL_MODERATOR = process.env.ADVISORY_MODEL_MODERATOR || "claude-opus-4-5-20251101";
const MAX_NOTES_BYTES = 120_000;

const NOTES_ROOT = path.join(os.homedir(), "notes");
const ADVISORY_DIR = path.join(NOTES_ROOT, "advisory");
const SOURCES_ROOT = path.join(NOTES_ROOT, "sources");
const PRINCIPLES = getAgentPrinciplesPrompt();

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

const ROLES = [
  { id: "finance_guardian", label: "Finance Guardian" },
  { id: "growth_strategist", label: "Growth Strategist" },
  { id: "marketing_expert", label: "Marketing Expert" },
  { id: "operations_lead", label: "Operations Lead" },
  { id: "revenue_analyst", label: "Revenue Analyst" },
  { id: "skeptical_operator", label: "Skeptical Operator" },
  { id: "team_dynamics_architect", label: "Team Dynamics Architect" },
  { id: "council_moderator", label: "Council Moderator (Opus)" },
];

function todayLocalDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date());
}

function clamp(text, max = 4000) {
  const s = String(text || "");
  return s.length <= max ? s : `${s.slice(0, max)}\n...[truncated]`;
}

function markdownEscape(text) {
  return String(text || "").replace(/([_*`\[])/g, "\\$1");
}

async function readJson(file) {
  try {
    return JSON.parse(await fsp.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function readText(file) {
  try {
    return await fsp.readFile(file, "utf8");
  } catch {
    return "";
  }
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

async function writeJson(file, data) {
  await ensureDir(path.dirname(file));
  await fsp.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function loadLatestReportByPrefix(prefix) {
  const reportsDir = path.join(__dirname, "reports");
  let files = [];
  try {
    files = await fsp.readdir(reportsDir);
  } catch {
    return null;
  }
  const matches = files.filter((f) => f.includes(prefix)).sort().reverse();
  if (!matches.length) return null;
  return readJson(path.join(reportsDir, matches[0]));
}

async function collectDbMetrics() {
  const out = {};
  try {
    const lead = await pg.query(
      `SELECT brand_slug, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE COALESCE(email,'')<>'')::int AS with_email
         FROM leads
        WHERE brand_slug IN ('skynpatch','blackwallstreetopoly')
        GROUP BY brand_slug
        ORDER BY brand_slug`
    );
    out.leads = lead.rows || [];
  } catch (err) {
    out.leads_error = err.message;
  }

  try {
    const email = await pg.query(
      `SELECT brand_slug,
              COUNT(*) FILTER (WHERE sent_at >= NOW() - INTERVAL '1 day')::int AS sends_24h,
              COUNT(*) FILTER (WHERE opened_at IS NOT NULL AND sent_at >= NOW() - INTERVAL '1 day')::int AS opened_24h,
              COUNT(*) FILTER (WHERE clicked_at IS NOT NULL AND sent_at >= NOW() - INTERVAL '1 day')::int AS clicked_24h
         FROM email_sends
        WHERE brand_slug IN ('skynpatch','blackwallstreetopoly')
        GROUP BY brand_slug
        ORDER BY brand_slug`
    );
    out.email = email.rows || [];
  } catch (err) {
    out.email_error = err.message;
  }

  return out;
}

function parseCronHealth(pm2Apps) {
  const apps = Array.isArray(pm2Apps) ? pm2Apps : [];
  const cron = apps.filter((a) => a?.pm2_env?.cron_restart);
  return {
    total_apps: apps.length,
    online: apps.filter((a) => a?.pm2_env?.status === "online").length,
    cron_jobs: cron.map((a) => ({
      name: a.name,
      status: a?.pm2_env?.status || "unknown",
      cron: a?.pm2_env?.cron_restart || null,
      restarts: a?.pm2_env?.restart_time ?? 0,
    })),
  };
}

async function collectPm2Health() {
  const { execSync } = require("child_process");
  try {
    const raw = execSync("pm2 jlist", { encoding: "utf8", timeout: 12_000 });
    return parseCronHealth(JSON.parse(raw));
  } catch (err) {
    return { error: err.message, total_apps: 0, online: 0, cron_jobs: [] };
  }
}

async function collectMeetingMinutes() {
  const dirs = [
    path.join(NOTES_ROOT, "meetings"),
    path.join(NOTES_ROOT, "meeting-minutes"),
    path.join(process.cwd(), "notes"),
  ];
  const found = [];
  for (const d of dirs) {
    try {
      const names = await fsp.readdir(d);
      for (const n of names) {
        if (!/\.(md|txt)$/i.test(n)) continue;
        found.push(path.join(d, n));
      }
    } catch {}
  }
  found.sort((a, b) => {
    try {
      const sa = fs.statSync(a).mtimeMs;
      const sb = fs.statSync(b).mtimeMs;
      return sb - sa;
    } catch {
      return 0;
    }
  });
  const top = found.slice(0, 8);
  const items = [];
  let used = 0;
  for (const file of top) {
    if (used > MAX_NOTES_BYTES) break;
    const txt = await readText(file);
    const clipped = clamp(txt, 6000);
    items.push({ file, text: clipped });
    used += clipped.length;
  }
  return items;
}

async function collectSlackMessages() {
  const paths = [
    process.env.SLACK_EXPORT_PATH || "",
    path.join(NOTES_ROOT, "slack"),
    path.join(process.cwd(), "artifacts", "slack"),
  ].filter(Boolean);

  const files = [];
  for (const p of paths) {
    try {
      const st = await fsp.stat(p);
      if (st.isFile()) files.push(p);
      if (st.isDirectory()) {
        const names = await fsp.readdir(p);
        for (const n of names) {
          if (/\.(json|md|txt)$/i.test(n)) files.push(path.join(p, n));
        }
      }
    } catch {}
  }
  files.sort((a, b) => {
    try {
      return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
    } catch {
      return 0;
    }
  });
  const out = [];
  for (const f of files.slice(0, 8)) {
    const txt = await readText(f);
    out.push({ file: f, text: clamp(txt, 5000) });
  }
  return out;
}

async function captureSource(service, sourceUrl, dateKey) {
  const dir = path.join(SOURCES_ROOT, service, dateKey);
  await ensureDir(dir);
  const capturedAt = new Date().toISOString();
  const method = "fetch-or-browser";
  const res = await fetchWithFallback(sourceUrl, {
    timeoutMs: 20_000,
    allowBrowser: true,
    sourceService: `advisory_${service}`,
    captureSource: true,
    readOnly: true,
    waitMs: 1200,
  });

  const metadata = {
    url: sourceUrl,
    captured_at: capturedAt,
    service,
    method_used: res.method || method,
    status: res.status,
    ok: !!res.ok,
    artifact: res.artifact || null,
  };
  await writeJson(path.join(dir, "metadata.json"), metadata);
  await writeJson(path.join(dir, "extract.json"), { data: res.data });
  return { ...metadata, extract_file: path.join(dir, "extract.json") };
}

async function collectSocialAnalytics(dateKey) {
  const configured = {
    youtube: process.env.ADVISORY_YOUTUBE_URL || "",
    instagram: process.env.ADVISORY_INSTAGRAM_URL || "",
    x: process.env.ADVISORY_X_URL || "",
    tiktok: process.env.ADVISORY_TIKTOK_URL || "",
  };
  const out = {};
  for (const [service, url] of Object.entries(configured)) {
    if (!url) {
      out[service] = { skipped: true, reason: "url_not_configured" };
      continue;
    }
    try {
      out[service] = await captureSource(service, url, dateKey);
    } catch (err) {
      out[service] = { skipped: false, ok: false, error: err.message };
    }
  }
  return out;
}

async function collectInputs(dateKey) {
  const [dbMetrics, pm2Health, meetings, slack, launchE2E, repoScan, dailyProgress, social] = await Promise.all([
    collectDbMetrics(),
    collectPm2Health(),
    collectMeetingMinutes(),
    collectSlackMessages(),
    loadLatestReportByPrefix("launch-e2e"),
    loadLatestReportByPrefix("github-observability-scan"),
    loadLatestReportByPrefix("daily-progress"),
    collectSocialAnalytics(dateKey),
  ]);

  return {
    generated_at: new Date().toISOString(),
    timezone: TZ,
    social_analytics: social,
    email_campaigns_and_revenue: dbMetrics,
    cron_task_health: pm2Health,
    meeting_minutes: meetings,
    slack_messages: slack,
    launch_e2e: launchE2E || { missing: true },
    repo_scan: repoScan || { missing: true },
    daily_progress: dailyProgress || { missing: true },
  };
}

function rolePrompt(roleLabel, inputs) {
  return [
    `You are the ${roleLabel} on an overnight advisory board.`,
    "Analyze independently and produce recommendations grounded in the provided data.",
    "Return markdown with these exact sections:",
    "1) Key Findings",
    "2) Risks",
    "3) Recommendations (numbered, include priority P1/P2/P3)",
    "4) Evidence References (source + metric)",
    "No fluff. No emojis. Keep it executive and actionable.",
    "",
    "Data snapshot:",
    clamp(JSON.stringify(inputs, null, 2), 120000),
  ].join("\n");
}

async function runExpert(role, inputs) {
  if (!anthropic || SKIP_LLM) {
    return {
      id: role.id,
      label: role.label,
      output: [
        "1) Key Findings",
        "- Anthropic API key not configured; generated deterministic fallback analysis.",
        "2) Risks",
        "- Advisory quality reduced because model analysis was unavailable.",
        "3) Recommendations (numbered, include priority P1/P2/P3)",
        "1. [P1] Configure ANTHROPIC_API_KEY for full overnight advisory synthesis.",
        "2. [P2] Ensure source URLs are configured for social analytics capture.",
        "3. [P2] Keep launch E2E and repo scans fresh before midnight runs.",
        "4) Evidence References (source + metric)",
        "- inputs.generated_at, launch_e2e, repo_scan, cron_task_health",
      ].join("\n"),
    };
  }

  const res = await anthropic.messages.create({
    model: MODEL_EXPERT,
    max_tokens: 2200,
    system: `You are ${role.label}. ${PRINCIPLES}`,
    messages: [{ role: "user", content: rolePrompt(role.label, inputs) }],
  });

  return {
    id: role.id,
    label: role.label,
    output: String(res.content?.[0]?.text || "").trim(),
  };
}

function moderatorPrompt(expertOutputs, inputs) {
  return [
    "You are Council Moderator (Opus) for an overnight advisory board.",
    "Your job:",
    "- reconcile disagreements between experts",
    "- remove duplicates",
    "- output a priority-ranked list of recommendations",
    "",
    "Return markdown with these exact sections:",
    "1) Executive Summary",
    "2) Disagreements and Resolution",
    "3) Priority-Ranked Recommendations (numbered 1..N, each with P1/P2/P3, owner, ETA)",
    "4) Top 5 Morning Actions",
    "5) Data Gaps To Fix Tomorrow",
    "",
    "Experts:",
    clamp(JSON.stringify(expertOutputs, null, 2), 120000),
    "",
    "Original inputs snapshot:",
    clamp(JSON.stringify(inputs, null, 2), 60000),
  ].join("\n");
}

async function runModerator(expertOutputs, inputs) {
  if (!anthropic || SKIP_LLM) {
    return [
      "1) Executive Summary",
      "- Advisory fallback mode executed. Core systems are still monitored.",
      "2) Disagreements and Resolution",
      "- N/A in fallback mode.",
      "3) Priority-Ranked Recommendations (numbered 1..N, each with P1/P2/P3, owner, ETA)",
      "1. [P1] owner=ops ETA=today Configure ANTHROPIC_API_KEY for full advisory quality.",
      "2. [P1] owner=growth ETA=today Configure ADVISORY_* social source URLs.",
      "3. [P2] owner=qa ETA=today Ensure launch E2E and repo scan reports are refreshed nightly.",
      "4) Top 5 Morning Actions",
      "1. Validate red/green and topology.",
      "2. Review top growth and revenue blockers.",
      "3. Confirm cron health and failed restarts.",
      "4. Review latest SkynPatch/BWS send funnel metrics.",
      "5. Queue fixes for any stale jobs.",
      "5) Data Gaps To Fix Tomorrow",
      "- Missing external social analytics endpoints.",
      "- Model-based expert synthesis unavailable.",
    ].join("\n");
  }

  const res = await anthropic.messages.create({
    model: MODEL_MODERATOR,
    max_tokens: 3200,
    system: `You are Council Moderator (Opus). ${PRINCIPLES}`,
    messages: [{ role: "user", content: moderatorPrompt(expertOutputs, inputs) }],
  });
  return String(res.content?.[0]?.text || "").trim();
}

function extractTopFive(markdownText) {
  const lines = String(markdownText || "").split("\n");
  const picks = [];
  for (const ln of lines) {
    const t = ln.trim();
    if (/^\d+\.\s/.test(t) || /^-\s/.test(t)) {
      if (/\[P[123]\]/i.test(t) || /owner=/i.test(t) || /ETA=/i.test(t)) {
        picks.push(t.replace(/^-\s*/, ""));
      }
    }
    if (picks.length >= 5) break;
  }
  return picks.slice(0, 5);
}

async function buildReport(dateKey, inputs, experts, moderatorOut) {
  await ensureDir(ADVISORY_DIR);
  const outPath = path.join(ADVISORY_DIR, `${dateKey}.md`);

  const sections = [
    `# Overnight Advisory Board — ${dateKey}`,
    "",
    `- generated_at: ${new Date().toISOString()}`,
    `- timezone: ${TZ}`,
    `- model_expert: ${MODEL_EXPERT}`,
    `- model_moderator: ${MODEL_MODERATOR}`,
    "",
    "## Input Snapshot",
    "```json",
    clamp(JSON.stringify(inputs, null, 2), 120000),
    "```",
    "",
    "## Expert Outputs",
    ...experts.flatMap((e) => [`### ${e.label}`, "", e.output, ""]),
    "## Council Moderator Output",
    "",
    moderatorOut,
    "",
  ];

  await fsp.writeFile(outPath, sections.join("\n"), "utf8");
  return outPath;
}

async function notifyTelegramSummary(dateKey, reportPath, moderatorOut) {
  const top = extractTopFive(moderatorOut);
  const summary = [
    `*Overnight Advisory Board* (${markdownEscape(dateKey)})`,
    "",
    "*Top 5 recommendations:*",
    ...top.map((x, i) => `${i + 1}. ${markdownEscape(x)}`),
    "",
    `Report: \`${markdownEscape(reportPath)}\``,
  ].join("\n");

  return notifyMonitoring(summary);
}

async function main() {
  const dateKey = todayLocalDate();
  const inputs = await collectInputs(dateKey);

  const experts = [];
  for (const role of ROLES.slice(0, 7)) {
    const out = await runExpert(role, inputs);
    experts.push(out);
  }
  const moderatorOut = await runModerator(experts, inputs);
  const reportPath = await buildReport(dateKey, inputs, experts, moderatorOut);

  const notifyRes = DRY_RUN
    ? { sent: false, configured: true, results: [{ channel: "telegram", skipped: true, reason: "dry_run" }] }
    : await notifyTelegramSummary(dateKey, reportPath, moderatorOut);

  const status = {
    ok: true,
    date: dateKey,
    report_path: reportPath,
    experts: experts.length,
    notify: notifyRes,
    dry_run: DRY_RUN,
  };
  console.log(JSON.stringify(status, null, 2));
}

main()
  .then(async () => { await pg.end(); })
  .catch(async (err) => {
    console.error("Fatal:", err.message);
    try { await pg.end(); } catch {}
    process.exit(1);
  });
