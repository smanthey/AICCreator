#!/usr/bin/env node
"use strict";

/**
 * Enqueue opencode_controller tasks to close monetization gaps from repo-completion-gap rolling report.
 * P0/P1 repos only (CookiesPass, payclaw, CaptureInbound, capture, autopay_ui). Priority 9.
 * Usage: node scripts/enqueue-monetization-gap-tasks.js [--dry-run] [--max 2]
 */

const fs = require("fs");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "../.env") });

const { enqueueOnce } = require("../core/queue");

const ROOT = path.join(__dirname, "..");
const ROLLING_GAP_PATH = path.join(ROOT, "reports", "repo-completion-gap-rolling.json");
const PRIORITY_MONETIZATION = 9;
const P0_P1_REPOS = ["CookiesPass", "payclaw", "CaptureInbound", "capture", "autopay_ui"];
const ACTIVE_STATUSES = ["CREATED", "DISPATCHED", "RUNNING", "RETRY", "PENDING_APPROVAL"];

function getArg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  if (i < 0 || i + 1 >= process.argv.length) return fallback;
  const v = String(process.argv[i + 1] || "").trim();
  return v || fallback;
}

function hasArg(flag) {
  return process.argv.includes(flag);
}

function loadRolling() {
  try {
    return JSON.parse(fs.readFileSync(ROLLING_GAP_PATH, "utf8"));
  } catch {
    return [];
  }
}

async function main() {
  const dryRun = hasArg("--dry-run");
  const maxPerRepo = Math.max(1, parseInt(getArg("--max", "1"), 10) || 1);

  const rolling = loadRolling();
  if (!rolling.length) {
    console.error("No rolling gap report. Run: node scripts/repo-completion-gap-one.js --repo CookiesPass (or --next)");
    process.exit(2);
  }

  const latestByRepo = {};
  for (const r of rolling) {
    if (!r.repo || !P0_P1_REPOS.includes(r.repo)) continue;
    if (!latestByRepo[r.repo] || (r.completed_at && r.completed_at > (latestByRepo[r.repo].completed_at || ""))) {
      latestByRepo[r.repo] = r;
    }
  }

  const queued = [];
  for (const repo of P0_P1_REPOS) {
    const rec = latestByRepo[repo];
    if (!rec || !(rec.next_actions && rec.next_actions.length)) continue;

    const repoKey = repo === "payclaw" ? "local/payclaw" : `local/${repo}`;
    const objective = [
      `Monetization gap closure for ${repo}.`,
      `Complete these next actions (from repo-completion-gap):`,
      ...rec.next_actions.map((a, i) => `${i + 1}. ${a}`),
      "",
      "Use benchmark_lookup and best_case_ref from the gap report; run feature benchmark after changes.",
    ].join("\n");

    const payload = {
      repo: repoKey,
      objective,
      source: "monetization_gap_enqueue",
      force_implement: true,
      max_iterations: 2,
      gap_next_actions: rec.next_actions,
      capability_score: rec.capability_score,
    };

    if (dryRun) {
      console.log(`[dry-run] Would enqueue opencode_controller for ${repoKey}:`, payload.objective.slice(0, 120) + "...");
      queued.push({ repo: repoKey, dry: true });
      continue;
    }

    const result = await enqueueOnce({
      type: "opencode_controller",
      payload,
      priority: PRIORITY_MONETIZATION,
      activeStatuses: ACTIVE_STATUSES,
    });
    if (result && result.created) {
      console.log(`Enqueued ${repoKey} (task created)`);
      queued.push({ repo: repoKey, created: true });
    } else {
      console.log(`Skip ${repoKey} (duplicate or not created)`);
    }

    if (queued.length >= maxPerRepo * P0_P1_REPOS.length) break;
  }

  console.log(`Done. Queued: ${queued.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
