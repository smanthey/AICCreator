#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { Pool } = require("pg");

require("dotenv").config({ path: path.join(__dirname, "../.env") });

const ROOT = path.join(__dirname, "..");
const REPORT_DIR = path.join(ROOT, "scripts", "reports");
const OUT_DIR = path.join(os.homedir(), "notes", "briefs", "weekly");
const ARGS = process.argv.slice(2);
const SHOULD_REFRESH = hasArg("--refresh");

function hasArg(flag) {
  return ARGS.includes(flag);
}

function runNode(scriptPath, args = []) {
  const res = spawnSync("node", [scriptPath, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
  });
  return {
    ok: res.status === 0,
    code: res.status,
    stdout: (res.stdout || "").trim(),
    stderr: (res.stderr || "").trim(),
    cmd: `node ${scriptPath} ${args.join(" ")}`.trim(),
  };
}

function isoWeekInfo(inputDate = new Date()) {
  const date = new Date(inputDate);
  date.setHours(0, 0, 0, 0);
  const day = (date.getDay() + 6) % 7; // Monday=0 ... Sunday=6
  date.setDate(date.getDate() - day + 3); // Thursday in current week
  const firstThursday = new Date(date.getFullYear(), 0, 4);
  const firstDay = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstDay + 3);
  const week = 1 + Math.round((date - firstThursday) / 604800000);
  const year = date.getFullYear();
  const weekStr = String(week).padStart(2, "0");
  return {
    year,
    week,
    key: `${year}-${weekStr}`,
  };
}

function latestReport(suffix) {
  if (!fs.existsSync(REPORT_DIR)) return null;
  const matches = fs.readdirSync(REPORT_DIR).filter((f) => f.endsWith(suffix)).sort();
  if (!matches.length) return null;
  return path.join(REPORT_DIR, matches[matches.length - 1]);
}

function readJsonMaybe(filePath) {
  if (!filePath) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function loadSignalSummary() {
  const host = process.env.POSTGRES_HOST || process.env.CLAW_DB_HOST;
  const password = process.env.POSTGRES_PASSWORD || process.env.CLAW_DB_PASSWORD;
  if (!host || !password) {
    return { enabled: false, reason: "db_env_missing", counts: [], high: [] };
  }

  const pool = new Pool({
    host,
    port: parseInt(process.env.POSTGRES_PORT || process.env.CLAW_DB_PORT || "15432", 10),
    user: process.env.POSTGRES_USER || process.env.CLAW_DB_USER || "claw",
    password,
    database: process.env.POSTGRES_DB || process.env.CLAW_DB_NAME || "claw_architect",
    max: 2,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 5000,
  });

  try {
    const countsRes = await pool.query(
      `SELECT signal_type, COUNT(*)::int AS count
         FROM external_update_signals
        WHERE created_at >= NOW() - INTERVAL '7 days'
        GROUP BY signal_type
        ORDER BY count DESC
        LIMIT 8`
    );

    const highRes = await pool.query(
      `SELECT s.signal_type, s.urgency, s.summary, COALESCE(u.url, '') AS url
         FROM external_update_signals s
         LEFT JOIN external_updates u ON u.id = s.update_id
        WHERE s.created_at >= NOW() - INTERVAL '7 days'
        ORDER BY
          CASE s.urgency
            WHEN 'critical' THEN 4
            WHEN 'high' THEN 3
            WHEN 'medium' THEN 2
            ELSE 1
          END DESC,
          s.created_at DESC
        LIMIT 8`
    );

    return {
      enabled: true,
      counts: countsRes.rows || [],
      high: highRes.rows || [],
    };
  } catch (err) {
    return {
      enabled: false,
      reason: `db_query_failed:${err.message}`,
      counts: [],
      high: [],
    };
  } finally {
    await pool.end().catch(() => {});
  }
}

function lineOrNA(value) {
  if (value === null || value === undefined || value === "") return "n/a";
  return String(value);
}

async function main() {
  const startedAt = new Date();
  const week = isoWeekInfo(startedAt);
  const outputPath = path.join(OUT_DIR, `${week.key}.md`);
  const sourceLog = [];

  const refreshResults = [];
  if (SHOULD_REFRESH) {
    // Keep this deterministic and bounded: refresh source signals + latest opportunity artifacts.
    refreshResults.push(runNode("scripts/research-signals.js", ["--days", "14", "--limit", "500"]));
    refreshResults.push(runNode("scripts/saas-opportunity-researcher.js"));
    refreshResults.push(runNode("scripts/affiliate-rollout-research.js"));
    refreshResults.push(runNode("scripts/saas-pain-opportunity-report.js", ["--limit", "160"]));
  }

  const saasPath = latestReport("-saas-opportunity-research.json");
  const affiliatePath = latestReport("-affiliate-rollout-research.json");
  const painPath = latestReport("-saas-pain-opportunity-report.json");

  const saas = readJsonMaybe(saasPath) || {};
  const affiliate = readJsonMaybe(affiliatePath) || {};
  const pain = readJsonMaybe(painPath) || {};
  const signals = await loadSignalSummary();

  if (saasPath) sourceLog.push({ type: "report", path: saasPath });
  if (affiliatePath) sourceLog.push({ type: "report", path: affiliatePath });
  if (painPath) sourceLog.push({ type: "report", path: painPath });
  if (signals.enabled) sourceLog.push({ type: "database", path: "external_update_signals (7d window)" });

  const topSaas = Array.isArray(saas.top) ? saas.top.slice(0, 8) : [];
  const painPoints = Array.isArray(pain.top_pain_points) ? pain.top_pain_points.slice(0, 8) : [];
  const affiliatePlans = Array.isArray(affiliate.site_rollout_plans) ? affiliate.site_rollout_plans.slice(0, 6) : [];
  const affiliateNext = Array.isArray(affiliate.recommended_next_actions)
    ? affiliate.recommended_next_actions.slice(0, 6)
    : [];

  const buildNowCount = topSaas.filter((x) => x.recommendation === "build_now").length;
  const prototypeCount = topSaas.filter((x) => x.recommendation === "prototype_next").length;
  const watchCount = topSaas.filter((x) => x.recommendation === "watchlist").length;

  const lines = [];
  lines.push("# Weekly Trends Brief (AI + SaaS)");
  lines.push("");
  lines.push(`- Week: \`${week.key}\``);
  lines.push(`- Generated: \`${new Date().toISOString()}\``);
  lines.push(`- Refresh mode: \`${SHOULD_REFRESH ? "on" : "off"}\``);
  lines.push("");

  lines.push("## Executive Summary");
  lines.push(`- Opportunity scan loaded \`${topSaas.length}\` candidate SaaS opportunities.`);
  lines.push(`- Opportunity mix: \`${buildNowCount}\` build-now, \`${prototypeCount}\` prototype-next, \`${watchCount}\` watchlist.`);
  lines.push(`- Pain report contributed \`${painPoints.length}\` recurring user pain patterns from social/web sources.`);
  lines.push(`- Affiliate rollout feed includes \`${affiliatePlans.length}\` site rollout plan(s) and \`${affiliateNext.length}\` next action(s).`);
  if (signals.enabled) {
    lines.push(`- External update signals (7d): \`${signals.counts.reduce((n, x) => n + Number(x.count || 0), 0)}\` classified updates.`);
  } else {
    lines.push(`- External update signal summary unavailable (\`${lineOrNA(signals.reason)}\`).`);
  }
  lines.push("");

  lines.push("## SaaS Opportunities");
  if (!topSaas.length) {
    lines.push("- No opportunity rows found in latest report.");
  } else {
    lines.push("| Opportunity | Demand | Readiness | Total | Recommendation |");
    lines.push("|---|---:|---:|---:|---|");
    for (const row of topSaas) {
      lines.push(
        `| ${lineOrNA(row.id)} | ${lineOrNA(row.demand_score)} | ${lineOrNA(row.readiness_score)} | ${lineOrNA(row.total_score)} | ${lineOrNA(row.recommendation)} |`
      );
    }
  }
  lines.push("");

  lines.push("## Pain Patterns (What Users Keep Complaining About)");
  if (!painPoints.length) {
    lines.push("- No pain patterns found in latest pain report.");
  } else {
    lines.push("| Pain point | Frequency | Example source |");
    lines.push("|---|---:|---|");
    for (const p of painPoints) {
      const example = Array.isArray(p.examples) && p.examples[0] ? p.examples[0] : null;
      const exText = example ? `[${lineOrNA(example.channel || example.source)}](${lineOrNA(example.link)})` : "n/a";
      lines.push(`| ${lineOrNA(p.summary || p.key)} | ${lineOrNA(p.frequency)} | ${exText} |`);
    }
  }
  lines.push("");

  lines.push("## AI/SaaS Trend Signals (External Updates)");
  if (!signals.enabled || !signals.counts.length) {
    lines.push("- No DB-backed signal summary available for this run.");
  } else {
    lines.push("### Signal Type Counts (7d)");
    for (const c of signals.counts) {
      lines.push(`- ${lineOrNA(c.signal_type)}: ${lineOrNA(c.count)}`);
    }
    lines.push("");
    lines.push("### Highest-urgency Items");
    for (const h of signals.high) {
      const urlPart = h.url ? ` ([source](${h.url}))` : "";
      lines.push(`- [${lineOrNA(h.urgency)}] ${lineOrNA(h.signal_type)} - ${lineOrNA(h.summary)}${urlPart}`);
    }
  }
  lines.push("");

  lines.push("## Weekly Execution Opportunities");
  if (!affiliatePlans.length && !affiliateNext.length) {
    lines.push("- No affiliate rollout actions found.");
  } else {
    for (const plan of affiliatePlans) {
      lines.push(`- Site: \`${lineOrNA(plan.host)}\` | Stack hint: \`${lineOrNA(plan.affiliate_stack_hint)}\``);
      const steps = Array.isArray(plan.implementation_steps) ? plan.implementation_steps.slice(0, 3) : [];
      for (const s of steps) lines.push(`  - ${s}`);
    }
    if (affiliateNext.length) {
      lines.push("");
      lines.push("Priority next actions:");
      for (const action of affiliateNext) lines.push(`- ${action}`);
    }
  }
  lines.push("");

  if (refreshResults.length) {
    lines.push("## Refresh Run Log");
    for (const r of refreshResults) {
      lines.push(`- \`${r.cmd}\` -> ${r.ok ? "ok" : `fail(${lineOrNA(r.code)})`}`);
      if (!r.ok && r.stderr) lines.push(`  - stderr: ${r.stderr.slice(0, 400)}`);
    }
    lines.push("");
  }

  lines.push("## Sources");
  if (!sourceLog.length) {
    lines.push("- No source artifacts found.");
  } else {
    for (const s of sourceLog) {
      lines.push(`- [${s.type}] ${s.path}`);
    }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(outputPath, lines.join("\n") + "\n");

  console.log("=== Weekly Trends Brief ===");
  console.log(`week=${week.key}`);
  console.log(`output=${outputPath}`);
  if (SHOULD_REFRESH) {
    const ok = refreshResults.filter((x) => x.ok).length;
    console.log(`refresh=${ok}/${refreshResults.length} succeeded`);
  }
}

main().catch((err) => {
  console.error(`[weekly-trends-brief] fatal: ${err.message}`);
  process.exit(1);
});

