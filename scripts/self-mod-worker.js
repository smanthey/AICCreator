#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const DIR = path.join(ROOT, "artifacts", "self-awareness");
const QUEUE = path.join(DIR, "self-mod-queue.json");
const HISTORY = path.join(DIR, "self-mod-history.json");
const REQUEST_MD = path.join(ROOT, "agent-state", "handoffs", "SELF-MOD-REQUEST.md");

function arg(flag, fallback = null) {
  const args = process.argv.slice(2);
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
}

function has(flag) {
  return process.argv.slice(2).includes(flag);
}

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}

function writeJson(p, v) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2));
}

function run(line, timeout = 30 * 60 * 1000, env = {}) {
  const r = spawnSync("bash", ["-lc", line], {
    cwd: ROOT,
    encoding: "utf8",
    timeout,
    env: { ...process.env, ...env, CI: "1" },
  });
  return {
    ok: Number(r.status || 0) === 0,
    code: Number(r.status || 0),
    out: String(r.stdout || "").slice(-2000),
    err: String(r.stderr || "").slice(-2000),
  };
}

function pickNext(queue) {
  const rank = { high: 1, medium: 2, low: 3 };
  return queue
    .filter((x) => x.status === "queued")
    .sort((a, b) => (rank[a.priority] || 9) - (rank[b.priority] || 9) || (new Date(a.created_at) - new Date(b.created_at)))[0] || null;
}

const dryRun = has("--dry-run");
const max = Math.max(1, Number(arg("--max", "1")) || 1);

const queue = readJson(QUEUE, []);
const hist = readJson(HISTORY, []);
let processed = 0;

while (processed < max) {
  const item = pickNext(queue);
  if (!item) break;

  item.status = "in_progress";
  item.started_at = new Date().toISOString();
  hist.push({ at: new Date().toISOString(), event: "started", id: item.id, title: item.title });

  fs.mkdirSync(path.dirname(REQUEST_MD), { recursive: true });
  fs.writeFileSync(
    REQUEST_MD,
    [
      "# Self Modification Request",
      "",
      `ID: ${item.id}`,
      `Title: ${item.title}`,
      `Priority: ${item.priority}`,
      `Created: ${item.created_at}`,
      "",
      "## Request",
      item.request,
      "",
      "## Safety",
      "- PR-only changes",
      "- No direct production deploy",
      "- Include test/status evidence in PR",
      "",
    ].join("\n")
  );

  const step1 = run("npm run -s self:aware:index", 10 * 60 * 1000);
  const branch = `codex/selfmod-${item.id}`;
  const step2 = dryRun
    ? { ok: true, code: 0, out: "dry_run", err: "" }
    : run(`npm run -s autonomy:pr -- --branch ${branch}`, 45 * 60 * 1000, {
        AUTONOMOUS_REQUEST_TEXT: item.request,
      });

  item.finished_at = new Date().toISOString();
  item.status = step1.ok && step2.ok ? "completed" : "failed";
  item.branch = branch;

  const pr = /https:\/\/github\.com\/[^\s]+\/pull\/\d+/i.exec(`${step2.out}\n${step2.err}`);
  if (pr) item.pr_url = pr[0];

  item.notes = [
    `self_aware_index: ${step1.ok ? "ok" : "fail"}`,
    `autonomy_pr: ${step2.ok ? "ok" : "fail"}`,
  ];

  hist.push({
    at: new Date().toISOString(),
    event: item.status,
    id: item.id,
    title: item.title,
    branch,
    pr_url: item.pr_url || null,
    step1_ok: step1.ok,
    step2_ok: step2.ok,
  });

  processed += 1;
}

writeJson(QUEUE, queue);
writeJson(HISTORY, hist);

console.log("=== Self Mod Worker ===");
console.log(`processed: ${processed}`);
console.log(`queue_file: ${QUEUE}`);
console.log(`history_file: ${HISTORY}`);
