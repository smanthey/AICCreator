#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const RUNS_DIR = path.join(ROOT, "artifacts", "autonomy", "pr-runs");
const HANDOFF = path.join("agent-state", "handoffs", "AUTONOMOUS-OVERNIGHT.md");

function arg(flag, fallback = null) {
  const args = process.argv.slice(2);
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
}

function has(flag) {
  return process.argv.slice(2).includes(flag);
}

function nowIso() {
  return new Date().toISOString();
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd || ROOT,
    encoding: "utf8",
    timeout: opts.timeoutMs || 20 * 60 * 1000,
    env: { ...process.env, ...(opts.env || {}), CI: "1" },
  });
  return {
    ok: Number(r.status || 0) === 0,
    code: Number(r.status || 0),
    stdout: String(r.stdout || ""),
    stderr: String(r.stderr || ""),
  };
}

function must(result, label) {
  if (!result.ok) {
    const msg = `[autonomy-pr] ${label} failed (exit ${result.code})\n${result.stderr || result.stdout}`;
    throw new Error(msg.trim());
  }
}

function git(args, cwd) {
  return sh("git", args, { cwd, timeoutMs: 120000 });
}

function cmdLine(line, cwd, timeoutMs = 20 * 60 * 1000) {
  return sh("bash", ["-lc", line], { cwd, timeoutMs });
}

function maybeCopyEnv(targetDir) {
  const src = path.join(ROOT, ".env");
  const dst = path.join(targetDir, ".env");
  try {
    if (fs.existsSync(src) && !fs.existsSync(dst)) fs.copyFileSync(src, dst);
  } catch {}
}

function maybeLinkNodeModules(targetDir) {
  const src = path.join(ROOT, "node_modules");
  const dst = path.join(targetDir, "node_modules");
  try {
    if (!fs.existsSync(src) || fs.existsSync(dst)) return;
    fs.symlinkSync(src, dst, "junction");
  } catch {}
}

function summarizeRun(runDir, branch, base, commands, prUrl, pushed, requestText) {
  const lines = [];
  lines.push("# Autonomous Overnight Summary");
  lines.push("");
  lines.push(`Generated: ${nowIso()}`);
  lines.push(`Base branch: ${base}`);
  lines.push(`Work branch: ${branch}`);
  lines.push(`Run dir: ${runDir}`);
  lines.push(`Pushed: ${pushed ? "yes" : "no"}`);
  lines.push(`PR: ${prUrl || "not created"}`);
  lines.push("");
  if (requestText) {
    lines.push("## Requested Change");
    lines.push(requestText);
    lines.push("");
  }
  lines.push("");
  lines.push("## Commands");
  for (const c of commands) {
    lines.push(`- ${c.name}: ${c.ok ? "OK" : "FAIL"} (exit ${c.code})`);
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("- This run is PR-only. No live deploy actions are performed.");
  lines.push("- Review the PR diff and run app-level tests before merge.");
  return lines.join("\n") + "\n";
}

function main() {
  const base = arg("--base", "main");
  const requestText = arg("--request", process.env.AUTONOMOUS_REQUEST_TEXT || "");
  const shouldPush = (process.env.AUTONOMOUS_PR_ENABLE_PUSH || "true").toLowerCase() === "true";
  const openPr = (process.env.AUTONOMOUS_PR_CREATE || "true").toLowerCase() === "true";
  const dryRun = has("--dry-run");
  const runStamp = stamp();
  const branch = arg("--branch", `codex/autonomy-${runStamp.slice(0, 19)}`);

  fs.mkdirSync(RUNS_DIR, { recursive: true });
  const runDir = path.join(RUNS_DIR, runStamp);
  const wtDir = path.join(runDir, "worktree");
  fs.mkdirSync(runDir, { recursive: true });

  const commands = [];
  let prUrl = "";
  let pushed = false;

  try {
    must(git(["fetch", "origin", base], ROOT), `git fetch origin ${base}`);
    must(git(["worktree", "add", "--detach", wtDir, `origin/${base}`], ROOT), "git worktree add");
    must(git(["switch", "-c", branch], wtDir), "git switch -c");

    maybeCopyEnv(wtDir);
    maybeLinkNodeModules(wtDir);

    const runCommands = [
      { name: "self_awareness_index", line: "npm run -s self:aware:index", timeout: 10 * 60 * 1000 },
      { name: "goal_autopilot", line: "npm run -s goal:autopilot -- --tasks 10 --execute 4 --timeout-ms 600000", timeout: 30 * 60 * 1000 },
      { name: "proactive_research", line: "npm run -s research:proactive -- --dry-run --ignore-history", timeout: 20 * 60 * 1000 },
      { name: "daily_progress", line: "npm run -s daily:progress", timeout: 10 * 60 * 1000 },
      { name: "global_status", line: "npm run -s status:redgreen", timeout: 10 * 60 * 1000 },
    ];

    for (const c of runCommands) {
      if (dryRun) {
        commands.push({ name: c.name, ok: true, code: 0, stdout: "dry_run", stderr: "" });
        continue;
      }
      const r = cmdLine(c.line, wtDir, c.timeout);
      commands.push({ name: c.name, ...r });
    }

    const summary = summarizeRun(runDir, branch, base, commands, "", false, requestText);
    const handoffAbs = path.join(wtDir, HANDOFF);
    fs.mkdirSync(path.dirname(handoffAbs), { recursive: true });
    fs.writeFileSync(handoffAbs, summary);

    const status = git(["status", "--porcelain"], wtDir);
    if (!status.stdout.trim()) {
      console.log("[autonomy-pr] no file changes generated; skipping commit/PR.");
      return;
    }

    must(git(["add", "-A"], wtDir), "git add");
    must(git(["commit", "-m", `chore: autonomous overnight cycle ${runStamp}`], wtDir), "git commit");

    if (!dryRun && shouldPush) {
      must(git(["push", "-u", "origin", branch], wtDir), "git push");
      pushed = true;
      if (openPr) {
        const body = [
          "Autonomous overnight cycle (PR-only).",
          "",
          "Includes:",
          "- refreshed autonomous Kanban outputs",
          "- proactive research report artifacts",
          "- daily progress/status snapshots",
          "",
          "No live deploy changes were executed.",
        ].join("\n");
        const pr = sh(
          "gh",
          ["pr", "create", "--draft", "--base", base, "--head", branch, "--title", `Autonomous overnight cycle ${runStamp.slice(0, 10)}`, "--body", body],
          { cwd: wtDir, timeoutMs: 120000 }
        );
        if (pr.ok) prUrl = (pr.stdout || "").trim();
      }
    }

    const finalSummary = summarizeRun(runDir, branch, base, commands, prUrl, pushed, requestText);
    fs.writeFileSync(path.join(runDir, "summary.md"), finalSummary);
    console.log("=== Autonomous PR Cycle ===");
    console.log(`run_dir: ${runDir}`);
    console.log(`branch: ${branch}`);
    console.log(`pushed: ${pushed ? "yes" : "no"}`);
    console.log(`pr_url: ${prUrl || "not_created"}`);
  } finally {
    try { git(["worktree", "remove", "--force", wtDir], ROOT); } catch {}
    try { fs.rmSync(wtDir, { recursive: true, force: true }); } catch {}
  }
}

try {
  main();
} catch (err) {
  console.error("[autonomy-pr] fatal:", err.message);
  process.exitCode = 1;
}
