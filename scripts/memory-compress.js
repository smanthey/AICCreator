#!/usr/bin/env node
"use strict";

/**
 * memory-compress.js
 *
 * Nightly synthesis job. Reads an agent's recent daily log files,
 * calls Gemini Flash (via infra/model-router) to produce a concise,
 * actionable MEMORY.md, then writes it back — replacing hollow
 * boilerplate with real learnings.
 *
 * Usage:
 *   node scripts/memory-compress.js --agent roblox_game_growth
 *   node scripts/memory-compress.js --all
 *   node scripts/memory-compress.js --all --lookback 14
 *   node scripts/memory-compress.js --agent quantfusion_algo_dev --dry-run
 */

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { chat } = require("../infra/model-router");

const {
  STATE_ROOT,
  listKnownAgents,
  readText,
  ensureDir,
  getAgentStats,
} = require("../control/agent-memory");

// ─── Arg helpers ─────────────────────────────────────────────────────────────

function arg(flag, fallback = null) {
  const args = process.argv.slice(2);
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
}

function has(flag) {
  return process.argv.slice(2).includes(flag);
}

// ─── Log reader ───────────────────────────────────────────────────────────────

function readAgentDir(agent) {
  // Construct agentDir path directly (agentDir is a function in module)
  return path.join(STATE_ROOT, "agents", String(agent || "unknown").trim().toLowerCase());
}

/**
 * Reads daily log files for an agent within lookbackDays.
 * Returns combined text capped at ~8000 chars (Haiku context friendly).
 */
function loadRecentLogs(agent, lookbackDays = 7) {
  const dir = path.join(readAgentDir(agent), "memory");
  if (!fs.existsSync(dir)) return "";

  const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  const files = fs.readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .filter((f) => new Date(`${f.slice(0, 10)}T00:00:00Z`).getTime() >= cutoff)
    .sort()
    .reverse(); // most recent first

  const parts = [];
  let totalChars = 0;
  const MAX_CHARS = 8000;

  for (const file of files) {
    const content = readText(path.join(dir, file), "").trim();
    if (!content) continue;
    if (totalChars + content.length > MAX_CHARS) {
      // Include truncated version of oldest files
      parts.push(content.slice(0, MAX_CHARS - totalChars));
      break;
    }
    parts.push(content);
    totalChars += content.length;
  }

  return parts.join("\n\n---\n\n");
}

function loadCurrentMemory(agent) {
  const memPath = path.join(readAgentDir(agent), "MEMORY.md");
  return readText(memPath, "").trim();
}

function loadSoul(agent) {
  const soulPath = path.join(readAgentDir(agent), "SOUL.md");
  return readText(soulPath, "").trim();
}

// ─── Synthesis prompt ─────────────────────────────────────────────────────────

function buildPrompt(agent, soul, currentMemory, recentLogs, stats) {
  const statsBlock = stats
    ? `Agent run stats (last ${stats.total_runs} runs): success=${stats.success_runs} fail=${stats.fail_runs} rate=${stats.success_rate}%`
    : "";

  const openLoopsBlock = stats && stats.open_loops.length > 0
    ? `Open loops identified:\n${stats.open_loops.slice(0, 5).map((l) => `- ${l}`).join("\n")}`
    : "";

  return `You are a memory synthesizer for an AI agent named "${agent}".

Your job: read the agent's recent run logs and write a concise, actionable MEMORY.md that will be injected before every future run as the agent's persistent context.

AGENT SOUL (identity):
${soul || "(none defined yet)"}

${statsBlock}

${openLoopsBlock}

CURRENT MEMORY.md (may be empty boilerplate):
${currentMemory || "(empty)"}

RECENT RUN LOGS (newest first):
${recentLogs || "(no logs found)"}

---

Write a new MEMORY.md with these sections:

## What This Agent Actually Does
(1-2 sentences describing observed behavior from the logs, not just the job description)

## Key Learnings
(5-10 bullet points of specific, actionable learnings from recent runs. Cite actual numbers. Skip generic tips.)

## Recurring Patterns
(What succeeds consistently? What fails repeatedly? What is idle most of the time?)

## Open Loops
(Unresolved issues, missing outcome capture, things that need follow-up)

## Watch Metrics
(The specific numbers or signals this agent should track each run)

Rules:
- Be specific. "Queued 3 tasks per run on average" beats "tasks are queued".
- If logs only say "Command completed" — note this as a CRITICAL gap: the script needs JSON writeback.
- Keep total under 400 words.
- Do not include generic advice or placeholder text.
- Write MEMORY.md content only — no preamble, no commentary.`;
}

// ─── Core synthesis ───────────────────────────────────────────────────────────

async function synthesizeAgent(agent, lookbackDays, dryRun) {
  const soul = loadSoul(agent);
  const currentMemory = loadCurrentMemory(agent);
  const recentLogs = loadRecentLogs(agent, lookbackDays);
  const stats = getAgentStats(agent, lookbackDays);

  if (!recentLogs && !currentMemory) {
    console.log(`  [${agent}] No logs or memory found — skipping`);
    return { agent, skipped: true, reason: "no_data" };
  }

  const prompt = buildPrompt(agent, soul, currentMemory, recentLogs, stats);

  if (dryRun) {
    console.log(`  [${agent}] DRY RUN — would call Gemini Flash via model-router (prompt ${prompt.length} chars)`);
    console.log(`  [${agent}] Stats: ${JSON.stringify(stats)}`);
    return { agent, skipped: true, reason: "dry_run" };
  }

  let newMemory;
  try {
    // Uses analyze_content task type → routes to gemini_flash per model-routing-policy
    const response = await chat("analyze_content", null, prompt, { max_tokens: 1024 });
    newMemory = (response.text || "").trim();
  } catch (err) {
    console.error(`  [${agent}] Gemini Flash call failed: ${err.message}`);
    return { agent, error: err.message };
  }

  if (!newMemory || newMemory.length < 50) {
    console.log(`  [${agent}] Gemini returned empty/short response — skipping write`);
    return { agent, skipped: true, reason: "empty_response" };
  }

  // Prepend synthesis timestamp
  const header = `# ${agent} MEMORY\n_Synthesized: ${new Date().toISOString()}_\n\n`;
  const final = header + newMemory;

  const memPath = path.join(readAgentDir(agent), "MEMORY.md");
  ensureDir(path.dirname(memPath));

  // Keep a backup of the previous version
  if (fs.existsSync(memPath)) {
    const backup = memPath.replace("MEMORY.md", `MEMORY-${new Date().toISOString().slice(0, 10)}.bak.md`);
    fs.copyFileSync(memPath, backup);
  }

  fs.writeFileSync(memPath, final);
  console.log(`  [${agent}] MEMORY.md updated (${final.length} chars)`);

  return { agent, updated: true, chars: final.length };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const agentFlag  = arg("--agent", "");
  const all        = has("--all");
  const dryRun     = has("--dry-run");
  const lookback   = Math.max(1, Number(arg("--lookback", "7")) || 7);

  if (!agentFlag && !all) {
    console.error("Usage: --agent <id>  OR  --all  [--lookback N] [--dry-run]");
    process.exit(1);
  }

  if (!process.env.GEMINI_API_KEY && !dryRun) {
    console.error("GEMINI_API_KEY not set. Use --dry-run to test without API.");
    process.exit(1);
  }

  const agents = all
    ? listKnownAgents()
    : [agentFlag.trim().toLowerCase()].filter(Boolean);

  if (!agents.length) {
    console.error("No agents found.");
    process.exit(1);
  }

  console.log(`=== Memory Compress ===`);
  console.log(`Agents: ${agents.join(", ")}`);
  console.log(`Lookback: ${lookback} days | Dry run: ${dryRun}`);
  console.log();

  const results = [];
  for (const agent of agents) {
    process.stdout.write(`Processing ${agent}...\n`);
    const result = await synthesizeAgent(agent, lookback, dryRun);
    results.push(result);
    // Brief pause between API calls to avoid rate limiting
    if (!dryRun && agents.indexOf(agent) < agents.length - 1) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  console.log("\n=== Summary ===");
  const updated  = results.filter((r) => r.updated).length;
  const skipped  = results.filter((r) => r.skipped).length;
  const errored  = results.filter((r) => r.error).length;
  console.log(`Updated: ${updated} | Skipped: ${skipped} | Errors: ${errored}`);

  if (errored) {
    results.filter((r) => r.error).forEach((r) => console.log(`  ERROR [${r.agent}]: ${r.error}`));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`memory-compress failed: ${err.message}`);
  process.exit(1);
});
