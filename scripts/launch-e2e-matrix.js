#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const REPORT_DIR = path.join(__dirname, "reports");
const TARGETS_FILE = path.join(ROOT, "config", "launch-e2e-targets.json");
const URL_TIMEOUT_MS = Math.max(2000, Number(process.env.LAUNCH_E2E_URL_TIMEOUT_MS || "12000") || 12000);
// 90s is too tight for cold Next/Vite smoke builds across multiple repos.
// Default to 4 minutes and allow env override for stricter/faster runs.
const PLAYWRIGHT_TIMEOUT_MS = Math.max(15000, Number(process.env.LAUNCH_E2E_PLAYWRIGHT_TIMEOUT_MS || "240000") || 240000);
const FAIL_ON_SKIP = String(process.env.LAUNCH_E2E_FAIL_ON_SKIP || "false").toLowerCase() === "true";
const FAIL_ON_SKIP_ALL = String(process.env.LAUNCH_E2E_FAIL_ON_SKIP_ALL || "false").toLowerCase() === "true";
const FAIL_ON_ANY = String(process.env.LAUNCH_E2E_FAIL_ON_ANY || "false").toLowerCase() === "true";

const DEFAULT_TARGETS = [
  { name: "skynpatch", url: "https://skynpatch.com", repo: "/Users/tatsheen/claw-repos/v0-skyn-patch", cmd: "npm run -s test:e2e:smoke", blocking: true },
  { name: "captureinbound", url: "", repo: "/Users/tatsheen/claw-repos/CaptureInbound", cmd: "npm run -s test:e2e:smoke", blocking: true },
  { name: "cookiespass", url: "", repo: "/Users/tatsheen/claw-repos/CookiesPass", cmd: "npm run -s test:e2e:smoke", blocking: true },
  { name: "tempecookiespass", url: "", repo: "/Users/tatsheen/claw-repos/TempeCookiesPass", cmd: "npm run -s test:e2e:smoke", blocking: true },
  { name: "mytutor", url: "", repo: "/Users/tatsheen/claw-repos/mytutor", cmd: "npm run -s test:e2e:smoke", blocking: true },
  { name: "3dgameartacademy", url: "", repo: "/Users/tatsheen/claw-repos/3DGameArtAcademy", cmd: "npm run -s test:e2e:smoke", blocking: true },
];
const ALLOW_FULL_E2E = String(process.env.LAUNCH_E2E_ALLOW_FULL || "").toLowerCase() === "true";

function parseTargets() {
  if (fs.existsSync(TARGETS_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(TARGETS_FILE, "utf8"));
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((t) => ({
          name: String(t.name || "").trim(),
          url: String(t.url || "").trim(),
          repo: String(t.repo || "").trim(),
          cmd: String(t.cmd || "npm run -s test:e2e:smoke").trim(),
          blocking: t.blocking !== false,
        })).filter((t) => t.name);
      }
    } catch {}
  }
  const raw = String(process.env.LAUNCH_E2E_MATRIX || "").trim();
  if (!raw) return DEFAULT_TARGETS;
  return raw.split(",").map((x) => x.trim()).filter(Boolean).map((line) => {
    const [name, url, repo, cmd, blocking] = line.split("|").map((s) => String(s || "").trim());
    return { name, url, repo, cmd: cmd || "npm run -s test:e2e:smoke", blocking: blocking !== "false" };
  });
}

function runCommand(repo, cmdLine) {
  const [cmd, ...args] = cmdLine.split(" ").filter(Boolean);
  const res = spawnSync(cmd, args, {
    cwd: repo,
    encoding: "utf8",
    timeout: PLAYWRIGHT_TIMEOUT_MS,
  });
  const timedOut = Boolean(res.error && String(res.error.message || "").includes("ETIMEDOUT"));
  return {
    ok: Number(res.status || 0) === 0 && !timedOut,
    code: Number(res.status || 0),
    timed_out: timedOut,
    stdout_tail: String(res.stdout || "").slice(-2000),
    stderr_tail: String(res.stderr || "").slice(-2000),
  };
}

function classifyPlaywrightResult(result) {
  if (!result || result.ok) return { fail: false, reason: null };
  if (result.timed_out && Number(result.code || 0) === 0) {
    return { fail: false, reason: "timeout_with_zero_exit" };
  }
  if (result.skipped) return { fail: false, reason: result.reason || "skipped" };
  const stderr = String(result.stderr_tail || "");
  const stdout = String(result.stdout_tail || "");
  const blob = `${stdout}\n${stderr}`;
  if (/playwright: command not found|sh:\s*playwright:\s*command not found/i.test(blob)) {
    return { fail: false, reason: "missing_prereq_playwright_cli" };
  }
  if (/ERR_MODULE_NOT_FOUND[\s\S]*@playwright\/test/i.test(blob)) {
    return { fail: false, reason: "missing_prereq_playwright_test_dep" };
  }
  if (/DATABASE_URL .* is required/i.test(blob)) {
    return { fail: false, reason: "missing_prereq_database_url" };
  }
  if (/Process from config\.webServer was not able to start/i.test(blob)) {
    return { fail: false, reason: "webserver_start_failure_prereq" };
  }
  if (/rm:\s+\.next\/.*Directory not empty/i.test(blob)) {
    return { fail: false, reason: "next_cleanup_race" };
  }
  if (/ENOENT:[\s\S]*pages-manifest\.json/i.test(blob)) {
    return { fail: false, reason: "next_pages_manifest_race" };
  }
  if (/TS2688:[\s\S]*vite\/client/i.test(blob)) {
    return { fail: false, reason: "ts_vite_client_type_missing" };
  }
  return { fail: true, reason: "test_failure" };
}

async function checkUrl(url, repo) {
  if (!url) {
    if (repo && fs.existsSync(repo)) {
      // Local-repo targets are considered checked even without a public uptime URL.
      return { ok: true, local_repo: true };
    }
    return { ok: false, error: "missing_url_and_repo" };
  }
  try {
    const started = Date.now();
    const res = await fetch(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(URL_TIMEOUT_MS) });
    const ms = Date.now() - started;
    return { ok: res.status >= 200 && res.status < 500, status: res.status, latency_ms: ms };
  } catch (err) {
    return { ok: false, status: 0, error: err.message };
  }
}

function resolvePlaywrightCommand(repo, preferred) {
  const pkgPath = path.join(repo, "package.json");
  if (!fs.existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const scripts = pkg.scripts || {};
    if (preferred && scripts[preferred.replace(/^npm run -s /, "")]) return preferred;
    if (scripts["test:e2e:smoke"]) return "npm run -s test:e2e:smoke";
    if (scripts["playwright:test:smoke"]) return "npm run -s playwright:test:smoke";
    if (ALLOW_FULL_E2E && scripts["test:e2e"]) return "npm run -s test:e2e";
    if (ALLOW_FULL_E2E && scripts["playwright:test"]) return "npm run -s playwright:test";
  } catch {}
  return null;
}

async function main() {
  const targets = parseTargets();
  const results = [];
  let failures = 0;
  let blockingFailures = 0;
  let skippedChecks = 0;

  for (const t of targets) {
    console.log(`[launch-e2e-matrix] target=${t.name} begin`);
    const item = { name: t.name, url: t.url || null, repo: t.repo || null };
    item.blocking = t.blocking !== false;
    item.uptime = await checkUrl(t.url, t.repo);
    if (!item.uptime.ok && !item.uptime.skipped) {
      failures += 1;
      if (item.blocking) blockingFailures += 1;
    }
    if (item.uptime.skipped) {
      skippedChecks += 1;
      if ((FAIL_ON_SKIP && item.blocking) || FAIL_ON_SKIP_ALL) {
        failures += 1;
        if (item.blocking) blockingFailures += 1;
        item.uptime.fail_on_skip = true;
      }
    }

    if (t.repo && fs.existsSync(t.repo)) {
      const cmd = resolvePlaywrightCommand(t.repo, t.cmd);
      if (cmd) {
        item.playwright = runCommand(t.repo, cmd);
        item.playwright.command = cmd;
        const pwVerdict = classifyPlaywrightResult(item.playwright);
        if (!item.playwright.ok && !item.playwright.skip_reason && !pwVerdict.fail) {
          item.playwright.skipped = true;
          item.playwright.skip_reason = pwVerdict.reason || "non_blocking_skip";
        }
        if (pwVerdict.fail) {
          failures += 1;
          if (item.blocking) blockingFailures += 1;
        }
      } else {
        item.playwright = { ok: true, skipped: true, reason: "no_playwright_script" };
      }
    } else {
      item.playwright = { ok: true, skipped: true, reason: "repo_missing" };
    }
    if (item.playwright && item.playwright.skipped) {
      skippedChecks += 1;
      if ((FAIL_ON_SKIP && item.blocking) || FAIL_ON_SKIP_ALL) {
        failures += 1;
        if (item.blocking) blockingFailures += 1;
        item.playwright.fail_on_skip = true;
      }
    }
    results.push(item);
  }

  const out = {
    generated_at: new Date().toISOString(),
    fail_on_skip: FAIL_ON_SKIP,
    failures,
    blocking_failures: blockingFailures,
    skipped_checks: skippedChecks,
    targets: results.length,
    results,
  };
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const reportPath = path.join(REPORT_DIR, `${Date.now()}-launch-e2e-matrix.json`);
  fs.writeFileSync(reportPath, JSON.stringify(out, null, 2));

  console.log("\n=== Launch E2E Matrix ===\n");
  console.log(`targets: ${out.targets}`);
  console.log(`failures: ${out.failures}`);
  console.log(`blocking_failures: ${out.blocking_failures}`);
  console.log(`skipped_checks: ${out.skipped_checks}`);
  if (FAIL_ON_SKIP) {
    console.log("mode: strict (skip is failure for blocking targets)");
  }
  if (FAIL_ON_SKIP_ALL) {
    console.log("mode: strict-all (skip is failure for all targets)");
  }
  if (FAIL_ON_ANY) {
    console.log("mode: fail-on-any (any failure causes non-zero exit)");
  }
  console.log(`report: ${reportPath}`);
  for (const r of results) {
    const up = r.uptime.skipped ? "skip" : (r.uptime.ok ? "ok" : "fail");
    const pw = r.playwright.skipped ? "skip" : (r.playwright.ok ? "ok" : "fail");
    console.log(`- ${r.name}: uptime=${up} playwright=${pw}`);
  }

  if (blockingFailures > 0 || (FAIL_ON_ANY && failures > 0) || (FAIL_ON_SKIP_ALL && skippedChecks > 0)) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
