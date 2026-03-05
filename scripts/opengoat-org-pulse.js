#!/usr/bin/env node
"use strict";

/**
 * opengoat-org-pulse.js
 *
 * Nightly at 2:00 AM: each executive agent reads recent activity signals and
 * evolves the organizational files they own. The CEO does a final synthesis
 * across all files to ensure coherence.
 *
 * Evolution rules:
 *   - STRATEGY.md  → updated by CEO based on what's working/failing
 *   - KPIs.md      → updated by CFO with latest metrics from DB/logs
 *   - ROADMAP.md   → updated by CPO: move completed items, add new based on signals
 *   - MISSION.md   → rarely changed; CEO only updates if a fundamental shift happened
 *   - VISION.md    → CEO/CPO update when long-term thinking shifts
 *
 * Each agent writes a "rationale" comment alongside each change so the
 * evolution history is auditable.
 *
 * Required env:
 *   ANTHROPIC_API_KEY
 *
 * Optional:
 *   OPENGOAT_ORG_PULSE_DRY_RUN  — 'true' to preview changes without writing
 */

require("dotenv").config();

const fsp = require("fs/promises");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const Anthropic = require("@anthropic-ai/sdk");
const { notifyMonitoring } = require("../control/monitoring-notify");
const { getAgentPrinciplesPrompt } = require("./agent-toolkit");

const ROOT = path.join(__dirname, "..");
const ORG_DIR = path.join(ROOT, "org");
const REPORTS_DIR = path.join(ROOT, "scripts", "reports");
const DRY_RUN = String(process.env.OPENGOAT_ORG_PULSE_DRY_RUN || "").toLowerCase() === "true";
const MODEL = process.env.OPENGOAT_ORG_MODEL || "claude-sonnet-4-5-20250929";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const PRINCIPLES = getAgentPrinciplesPrompt();

function sh(cmd, timeoutMs = 20_000) {
  const r = spawnSync("bash", ["-lc", cmd], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: timeoutMs,
    env: { ...process.env, PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" },
  });
  return String(r.stdout || "") + String(r.stderr || "");
}

async function readOrgFile(name) {
  try {
    return await fsp.readFile(path.join(ORG_DIR, name), "utf8");
  } catch {
    return `(${name} not found)`;
  }
}

async function writeOrgFile(name, content) {
  const filePath = path.join(ORG_DIR, name);
  await fsp.writeFile(filePath, content);
  // Also update repo root copy
  const rootCopy = path.join(ROOT, name);
  try { await fsp.writeFile(rootCopy, content); } catch {}
}

// ─── Gather activity signals ──────────────────────────────────────────────────

async function gatherActivitySignals() {
  const signals = {};

  // Recent git commits across repos
  signals.recentCommits = sh("git log --oneline --since='7 days ago' 2>/dev/null | head -20");

  // PM2 process health
  signals.pm2Health = sh(`pm2 jlist 2>/dev/null | node -e "
    process.stdin.resume();
    let d = '';
    process.stdin.on('data', c => d += c);
    process.stdin.on('end', () => {
      try {
        const apps = JSON.parse(d);
        const summary = apps.map(a => ({
          name: a.name,
          status: a.pm2_env?.status,
          restarts: a.pm2_env?.restart_time,
          uptime: a.pm2_env?.pm_uptime
        }));
        const down = summary.filter(a => a.status !== 'online').length;
        const up = summary.filter(a => a.status === 'online').length;
        console.log(JSON.stringify({ up, down, restarts_total: summary.reduce((s,a) => s+(a.restarts||0),0) }));
      } catch { console.log('{}'); }
    });
  " 2>/dev/null`);

  // Latest security council report
  try {
    const sc = JSON.parse(await fsp.readFile(path.join(REPORTS_DIR, "security-council-latest.json"), "utf8"));
    signals.securityStatus = `critical=${sc.critical_count} high=${sc.high_count} ml=${sc.medium_low_count} (${sc.generated_at?.slice(0,10)})`;
  } catch {
    signals.securityStatus = "no report yet";
  }

  // Latest Greptile review
  try {
    const gr = JSON.parse(await fsp.readFile(path.join(REPORTS_DIR, "greptile-review-latest.json"), "utf8"));
    signals.greptileStatus = `reviewed ${gr.repos_reviewed?.length || 0} repos (${gr.generated_at?.slice(0,10)})`;
  } catch {
    signals.greptileStatus = "no review yet";
  }

  // Mission control task stats
  signals.missionControlStats = sh("ls -t scripts/reports/*mission* 2>/dev/null | head -3 | xargs -I{} sh -c 'tail -1 {}' 2>/dev/null | head -20");

  // Dead letter / error counts
  signals.recentErrors = sh("pm2 logs --lines 50 --nostream 2>&1 | grep -i 'error\\|fatal\\|crash' | tail -15");

  // Current org run history
  try {
    const learnings = JSON.parse(await fsp.readFile(path.join(ROOT, "agent-state", "security", "learnings.json"), "utf8"));
    signals.securityLearnings = JSON.stringify(learnings.run_history?.slice(0, 5) || [], null, 2);
    signals.focusAreas = (learnings.focus_areas_next_run || []).join("; ");
  } catch {
    signals.securityLearnings = "none";
    signals.focusAreas = "none";
  }

  return signals;
}

// ─── Agent role definitions ───────────────────────────────────────────────────

const ORG_AGENTS = [
  {
    id: "cfo",
    label: "CFO",
    owns: ["KPIs.md"],
    systemPrompt: `You are the CFO of OpenClaw, an AI-native software portfolio company. Your job is to maintain KPIs.md — the organization's key performance indicators.

Review the activity signals provided and update the KPIs.md document:
1. Fill in any "Current" values you can determine from the signals (PM2 uptime, security findings count, etc.)
2. Add "Trend" indicators (↑ improving, ↓ declining, → stable, ? unknown)
3. Add new KPIs if signals reveal important metrics being tracked but not listed
4. Remove KPIs that are clearly no longer relevant
5. Add a brief CFO note at the bottom explaining significant changes

Keep the table format. Preserve the "Last evolved by" footer, updating the date.
Output ONLY the complete updated KPIs.md content — no commentary outside the document.${PRINCIPLES}`,
  },
  {
    id: "cpo",
    label: "CPO",
    owns: ["ROADMAP.md"],
    systemPrompt: `You are the CPO of OpenClaw. Your job is to maintain ROADMAP.md — the living product roadmap.

Review the activity signals provided and update ROADMAP.md:
1. Move any completed items to [x] based on evidence in git commits or PM2 processes
2. Move items that are clearly blocked or de-prioritized to a "Paused" section
3. Add new items based on patterns you see in recent commits, new scripts, or security findings
4. Reorder "Now" items by urgency based on current signals
5. Add a brief CPO note explaining your changes

Preserve the three-tier structure (Now / Next / Later). Update the "Last evolved by" footer.
Output ONLY the complete updated ROADMAP.md content — no commentary outside the document.${PRINCIPLES}`,
  },
  {
    id: "cso",
    label: "CSO",
    owns: [],  // CSO contributes to STRATEGY.md security section but doesn't own a dedicated file
    systemPrompt: null,
  },
  {
    id: "ceo",
    label: "CEO",
    owns: ["STRATEGY.md", "MISSION.md", "VISION.md"],
    systemPrompt: `You are the CEO of OpenClaw. Your job is to maintain the strategic direction of the organization through STRATEGY.md, and to review MISSION.md and VISION.md for necessary evolution.

Review all activity signals and the current state of all org files. Then:

FOR STRATEGY.md:
1. Update "Current Strategic Pillars" based on what's actually happening
2. Update "Active Bets" based on new signals (new scripts, processes, commits)
3. Update "Anti-Priorities" if new constraints have emerged
4. Add a "CEO Weekly Note" section at the bottom with 3 bullets: what's working, what's not, what needs focus this week

FOR MISSION.md and VISION.md:
Only update these if there's a clear signal that the fundamental direction has shifted. Minor operational changes don't warrant updates. If no update needed, return the originals unchanged.

Update all "Last evolved by" footers.
Output a JSON object like: { "STRATEGY.md": "<full updated content>", "MISSION.md": "<content>", "VISION.md": "<content>" }
Do not include any text outside the JSON.${PRINCIPLES}`,
  },
];

// ─── Run agent evolution ──────────────────────────────────────────────────────

async function runAgentEvolution(agent, currentFiles, signals) {
  if (!agent.systemPrompt) return {};  // skip agents without prompts

  const signalSummary = Object.entries(signals)
    .map(([k, v]) => `=== ${k.toUpperCase()} ===\n${String(v).slice(0, 800)}`)
    .join("\n\n");

  const currentFilesText = Object.entries(currentFiles)
    .map(([name, content]) => `=== CURRENT ${name} ===\n${content}`)
    .join("\n\n");

  const userMsg = `You are the ${agent.label}. Review these activity signals and current org documents, then update the documents you own.\n\n${signalSummary}\n\n${currentFilesText}`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: agent.systemPrompt,
    messages: [{ role: "user", content: userMsg }],
  });

  const output = response.content[0]?.text || "";

  // CEO returns JSON; others return raw file content
  if (agent.id === "ceo") {
    try {
      const parsed = JSON.parse(output);
      return parsed;
    } catch {
      // Try to extract JSON from output
      const jsonMatch = output.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try { return JSON.parse(jsonMatch[0]); } catch {}
      }
      console.warn("[opengoat-pulse] CEO output wasn't valid JSON, using fallback");
      return {};
    }
  }

  // Others: build a map of file→content
  const result = {};
  for (const file of agent.owns) {
    result[file] = output;
  }
  return result;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("[opengoat-pulse] starting org evolution — " + new Date().toISOString());
  await fsp.mkdir(ORG_DIR, { recursive: true });
  await fsp.mkdir(REPORTS_DIR, { recursive: true });

  // 1. Load current org files
  const orgFileNames = ["MISSION.md", "VISION.md", "STRATEGY.md", "KPIs.md", "ROADMAP.md"];
  const currentFiles = {};
  for (const name of orgFileNames) {
    currentFiles[name] = await readOrgFile(name);
  }

  // 2. Gather activity signals
  console.log("[opengoat-pulse] gathering activity signals...");
  const signals = await gatherActivitySignals();

  // 3. Run each agent (skip CEO until end)
  const allUpdates = {};
  for (const agent of ORG_AGENTS.filter((a) => a.id !== "ceo")) {
    if (!agent.owns.length) continue;
    console.log(`[opengoat-pulse] ${agent.label} evolving: ${agent.owns.join(", ")}`);
    try {
      const updates = await runAgentEvolution(agent, currentFiles, signals);
      Object.assign(allUpdates, updates);
      // Update currentFiles with evolved versions for CEO context
      for (const [file, content] of Object.entries(updates)) {
        if (content && content.length > 50) currentFiles[file] = content;
      }
      await new Promise((r) => setTimeout(r, 2000)); // stagger API calls
    } catch (err) {
      console.error(`[opengoat-pulse] ${agent.label} failed: ${err.message}`);
    }
  }

  // 4. CEO synthesizes across everything
  console.log("[opengoat-pulse] CEO synthesizing...");
  try {
    const ceoAgent = ORG_AGENTS.find((a) => a.id === "ceo");
    const ceoUpdates = await runAgentEvolution(ceoAgent, currentFiles, signals);
    Object.assign(allUpdates, ceoUpdates);
  } catch (err) {
    console.error("[opengoat-pulse] CEO synthesis failed:", err.message);
  }

  // 5. Write evolved files
  let evolved = 0;
  for (const [fileName, content] of Object.entries(allUpdates)) {
    if (!content || content.length < 50) continue;
    if (!orgFileNames.includes(fileName)) continue;
    if (!DRY_RUN) {
      await writeOrgFile(fileName, content);
      console.log(`[opengoat-pulse] wrote ${fileName} (${content.length} chars)`);
      evolved++;
    } else {
      console.log(`[dry-run] would write ${fileName} (${content.length} chars)`);
    }
  }

  // 6. Save evolution log
  const logEntry = {
    evolved_at: new Date().toISOString(),
    files_evolved: evolved,
    signals_used: Object.keys(signals),
    dry_run: DRY_RUN,
  };
  if (!DRY_RUN) {
    await fsp.appendFile(
      path.join(REPORTS_DIR, "opengoat-org-pulse.jsonl"),
      `${JSON.stringify(logEntry)}\n`
    );
  }

  // 7. Notify if significant changes
  const strategyContent = allUpdates["STRATEGY.md"] || "";
  const ceoNoteMatch = strategyContent.match(/## CEO Weekly Note\n([\s\S]+?)(?=\n---|\n##|$)/);
  const ceoNote = ceoNoteMatch ? ceoNoteMatch[1].trim().slice(0, 600) : null;

  if (!DRY_RUN && evolved > 0) {
    await notifyMonitoring(
      `🐐 **OpenGoat Org Pulse** — ${evolved} docs evolved\n` +
      (ceoNote ? `\n**CEO Note:**\n${ceoNote}` : "")
    );
  }

  console.log(`[opengoat-pulse] complete — ${evolved} files evolved`);
}

main().catch(async (err) => {
  console.error("[opengoat-pulse] fatal:", err.message);
  try {
    await notifyMonitoring(`🚨 **OpenGoat Org Pulse crashed**\n\`${err.message.slice(0, 300)}\``);
  } catch {}
  process.exit(1);
});
