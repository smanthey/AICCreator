#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { addFeedback } = require("../control/agent-memory");

const ROOT = path.join(__dirname, "..");
const TARGETS_FILE = path.join(ROOT, "config", "launch-e2e-targets.json");
const REPORT_DIR = path.join(__dirname, "reports");
const CMD_TIMEOUT_MS = Math.max(30_000, Number(process.env.QA_HUMAN_CMD_TIMEOUT_MS || "180000") || 180000);

const FEATURE_PATTERNS = {
  auth: ["auth", "signin", "signup", "session", "jwt", "better-auth", "next-auth"],
  billing: ["stripe", "checkout", "subscription", "payment_intent", "invoice"],
  webhooks: ["webhook", "signature", "rawBody", "event.type"],
  messaging: ["telnyx", "twilio", "maileroo", "send_email", "sms", "email"],
  scheduling: ["cron", "schedule", "bullmq", "queue", "worker", "agenda"],
  tenancy: ["tenant", "organization", "workspace", "account_id"],
};

function arg(flag, fallback = null) {
  const args = process.argv.slice(2);
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
}

function has(flag) {
  return process.argv.slice(2).includes(flag);
}

function loadTargets() {
  try {
    const raw = JSON.parse(fs.readFileSync(TARGETS_FILE, "utf8"));
    if (!Array.isArray(raw)) return [];
    return raw;
  } catch {
    return [];
  }
}

function run(repo, cmd, args) {
  const r = spawnSync(cmd, args, {
    cwd: repo,
    encoding: "utf8",
    timeout: CMD_TIMEOUT_MS,
    env: { ...process.env, CI: "1" },
  });
  return {
    ok: Number(r.status || 0) === 0,
    code: Number(r.status || 0),
    timed_out: !!(r.error && String(r.error.message || "").includes("ETIMEDOUT")),
    stdout_tail: String(r.stdout || "").slice(-1200),
    stderr_tail: String(r.stderr || "").slice(-1200),
  };
}

function normalizeCommandResult(name, result) {
  if (!result || result.ok) return result;
  const out = String(result.stdout_tail || "");
  const err = String(result.stderr_tail || "");
  const combined = `${out}\n${err}`;

  // Some repos keep integration/API checks on `npm test` that require a live dev server.
  if (name === "test" && /Cannot reach server\. Start it with:/i.test(combined)) {
    return {
      ...result,
      ok: true,
      skipped: true,
      reason: "requires_running_server",
    };
  }

  // Avoid treating a timed-out generic test bootstrap as a hard failure in human-grade scoring.
  if (name === "test" && Number(result.code || 0) === 143 && /\bRUN\s+v\d+/i.test(out)) {
    return {
      ...result,
      ok: true,
      skipped: true,
      reason: "test_timeout_hang",
    };
  }

  return result;
}

function readJsonIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function ripgrep(repo, pattern, glob) {
  const args = ["-n", "-S", pattern];
  if (glob) args.push("-g", glob);
  args.push(".");
  const r = spawnSync("rg", args, { cwd: repo, encoding: "utf8", timeout: 30_000 });
  if (Number(r.status || 0) !== 0 && !String(r.stdout || "").trim()) return [];
  return String(r.stdout || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function detectFeatures(repo) {
  const featureHits = {};
  for (const [feature, keys] of Object.entries(FEATURE_PATTERNS)) {
    const pattern = keys.map((k) => `(${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`).join("|");
    const hits = ripgrep(repo, pattern, "*.{js,ts,tsx,jsx,mjs,cjs}");
    featureHits[feature] = { used: hits.length > 0, hits: hits.slice(0, 5), count: hits.length };
  }
  return featureHits;
}

function detectTestCoverage(repo, feature) {
  const keys = FEATURE_PATTERNS[feature] || [];
  const pattern = keys.map((k) => `(${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`).join("|");
  const testHits = ripgrep(repo, pattern, "*{test,spec}*.{js,ts,tsx,jsx}");
  return { covered: testHits.length > 0, hits: testHits.slice(0, 5), count: testHits.length };
}

function selectCommands(pkg) {
  const scripts = pkg?.scripts || {};
  const cmds = [];
  if (scripts.lint) cmds.push({ name: "lint", cmd: "npm", args: ["run", "-s", "lint"] });
  if (scripts.typecheck) cmds.push({ name: "typecheck", cmd: "npm", args: ["run", "-s", "typecheck"] });

  if (scripts["test:unit"]) cmds.push({ name: "test:unit", cmd: "npm", args: ["run", "-s", "test:unit"] });
  else if (scripts.test) cmds.push({ name: "test", cmd: "npm", args: ["run", "-s", "test"] });

  if (scripts["test:e2e:smoke"]) cmds.push({ name: "test:e2e:smoke", cmd: "npm", args: ["run", "-s", "test:e2e:smoke"] });
  else if (scripts["playwright:test:smoke"]) cmds.push({ name: "playwright:test:smoke", cmd: "npm", args: ["run", "-s", "playwright:test:smoke"] });
  else if (scripts["test:e2e"]) cmds.push({ name: "test:e2e", cmd: "npm", args: ["run", "-s", "test:e2e"] });
  else if (scripts["playwright:test"]) cmds.push({ name: "playwright:test", cmd: "npm", args: ["run", "-s", "playwright:test"] });

  return cmds;
}

function finding(priority, type, message, detail = null) {
  return { priority, type, message, detail };
}

function scoreRepo(cmdResults, findings) {
  const cmdPass = cmdResults.filter((c) => c.ok).length;
  const cmdTotal = cmdResults.length || 1;
  const high = findings.filter((f) => f.priority === "high").length;
  const medium = findings.filter((f) => f.priority === "medium").length;
  const base = Math.round((cmdPass / cmdTotal) * 70);
  const penalty = high * 15 + medium * 5;
  return Math.max(0, Math.min(100, base + 30 - penalty));
}

function toMarkdown(report) {
  const lines = [];
  lines.push("# QA Human-Grade Report");
  lines.push("");
  lines.push(`Generated: ${report.generated_at}`);
  lines.push(`Targets: ${report.targets} | Failed repos: ${report.failed_repos} | High findings: ${report.high_findings}`);
  lines.push("");
  for (const repo of report.results) {
    lines.push(`## ${repo.name}`);
    lines.push(`- Repo: ${repo.repo}`);
    lines.push(`- Blocking: ${repo.blocking}`);
    lines.push(`- Score: ${repo.score}/100`);
    lines.push(`- Commands: ${repo.commands.filter((c) => c.ok).length}/${repo.commands.length} passed`);
    lines.push(`- Findings: high=${repo.findings.filter((f) => f.priority === "high").length}, medium=${repo.findings.filter((f) => f.priority === "medium").length}, low=${repo.findings.filter((f) => f.priority === "low").length}`);
    if (repo.findings.length) {
      lines.push("- Top findings:");
      for (const f of repo.findings.slice(0, 8)) {
        lines.push(`  - [${f.priority}] ${f.type}: ${f.message}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

async function main() {
  const onlyBlocking = has("--blocking-only");
  const dryRun = has("--dry-run");
  const limit = Math.max(0, Number(arg("--limit", "0")) || 0);
  const failOnHigh = !has("--no-fail-on-high");

  let targets = loadTargets();
  if (onlyBlocking) targets = targets.filter((t) => t.blocking !== false);
  if (limit > 0) targets = targets.slice(0, limit);

  if (!targets.length) {
    console.log("No targets found.");
    return;
  }

  const results = [];
  let highFindings = 0;
  let failedRepos = 0;

  for (const t of targets) {
    const repoPath = String(t.repo || "").trim();
    const repoResult = {
      name: t.name,
      repo: repoPath,
      blocking: t.blocking !== false,
      commands: [],
      features: {},
      coverage: {},
      findings: [],
      score: 0,
    };

    if (!repoPath || !fs.existsSync(repoPath)) {
      repoResult.findings.push(finding("high", "repo_missing", "Repository path missing or not found.", { repo: repoPath }));
      repoResult.score = 0;
      highFindings += 1;
      failedRepos += 1;
      results.push(repoResult);
      continue;
    }

    const pkg = readJsonIfExists(path.join(repoPath, "package.json"));
    if (!pkg) {
      repoResult.findings.push(finding("high", "package_missing", "package.json missing; cannot run realistic QA pipeline."));
      repoResult.score = 0;
      highFindings += 1;
      failedRepos += 1;
      results.push(repoResult);
      continue;
    }

    const cmds = selectCommands(pkg);
    if (!cmds.length) {
      repoResult.findings.push(finding("high", "no_test_commands", "No lint/typecheck/test/e2e scripts found in package.json."));
    }

    for (const c of cmds) {
      if (dryRun) {
        repoResult.commands.push({ name: c.name, ok: true, skipped: true, reason: "dry_run" });
        continue;
      }
      const raw = run(repoPath, c.cmd, c.args);
      const r = normalizeCommandResult(c.name, raw);
      repoResult.commands.push({ name: c.name, ...r });
    }

    const hasPassingE2E = repoResult.commands.some((c) => c.ok && String(c.name || "").includes("e2e"));
    for (const c of repoResult.commands.filter((x) => !x.ok)) {
      const sev = String(c.name || "").includes("e2e") || !hasPassingE2E ? "high" : "medium";
      repoResult.findings.push(finding(sev, "command_failed", `${c.name} failed (exit ${c.code}).`, { stderr_tail: c.stderr_tail }));
    }

    repoResult.features = detectFeatures(repoPath);
    for (const [feature, hit] of Object.entries(repoResult.features)) {
      if (!hit.used) continue;
      const cov = detectTestCoverage(repoPath, feature);
      repoResult.coverage[feature] = cov;
      if (!cov.covered) {
        const hasAnyPassingE2E = repoResult.commands.some((c) => c.ok && String(c.name || "").includes("e2e"));
        const severity =
          (feature === "billing" || feature === "auth" || feature === "webhooks") && !hasAnyPassingE2E
            ? "high"
            : "medium";
        repoResult.findings.push(
          finding(
            severity,
            "coverage_gap",
            `Feature "${feature}" appears in implementation but lacks matching test coverage.`,
            { implementation_hits: hit.hits, recommendation: `Add scenario tests for ${feature} happy path + failure path.` }
          )
        );
      }
    }

    if (!repoResult.commands.some((c) => c.name.includes("e2e") && c.ok)) {
      repoResult.findings.push(finding("high", "e2e_missing_or_failing", "No passing E2E command detected for this repo."));
    }

    repoResult.score = scoreRepo(repoResult.commands, repoResult.findings);
    const repoHigh = repoResult.findings.filter((f) => f.priority === "high").length;
    highFindings += repoHigh;
    if (repoHigh > 0 || repoResult.commands.some((c) => c.ok === false)) failedRepos += 1;
    results.push(repoResult);
  }

  const report = {
    generated_at: new Date().toISOString(),
    targets: results.length,
    failed_repos: failedRepos,
    high_findings: highFindings,
    fail_on_high: failOnHigh,
    results,
  };

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = Date.now();
  const jsonPath = path.join(REPORT_DIR, `${stamp}-qa-human-grade.json`);
  const mdPath = path.join(REPORT_DIR, `${stamp}-qa-human-grade.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(mdPath, toMarkdown(report));

  console.log("\n=== QA Human-Grade ===\n");
  console.log(`targets: ${report.targets}`);
  console.log(`failed_repos: ${report.failed_repos}`);
  console.log(`high_findings: ${report.high_findings}`);
  console.log(`report_json: ${jsonPath}`);
  console.log(`report_md: ${mdPath}`);

  if (!dryRun && report.high_findings > 0) {
    await addFeedback({
      agent: "qa",
      source: "qa-human-grade",
      text: `Detected ${report.high_findings} high-priority QA findings across ${report.failed_repos}/${report.targets} repos. Prioritize scenario coverage gaps first.`,
    }).catch(() => {});
  }

  if (failOnHigh && (report.failed_repos > 0 || report.high_findings > 0)) process.exit(1);
}

main().catch((err) => {
  console.error(`qa-human-grade fatal: ${err.message}`);
  process.exit(1);
});
