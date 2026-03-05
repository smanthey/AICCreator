#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const repos = [
  {
    name: "CaptureInbound",
    cwd: "$HOME/claw-repos/CaptureInbound",
    checks: [
      "npm run -s check",
      "npm run -s build",
    ],
    startup: "npm run dev",
  },
  {
    name: "payclaw",
    cwd: "$HOME/claw-repos/payclaw",
    checks: [
      "npm run -s check",
      "npm --prefix server run -s test:webhooks",
    ],
    startup: "npm --prefix server run dev",
  },
  {
    name: "TempeCookiesPass",
    cwd: "$HOME/claw-repos/TempeCookiesPass",
    checks: [
      "npm run -s check",
      "npm run -s verify:sms-schema",
      "npm run -s test:telnyx:webhook-confirm",
    ],
    startup: "npm run dev",
  },
  {
    name: "quantfusion",
    cwd: "$HOME/claw-repos/quantfusion",
    checks: [
      "npm run -s check",
    ],
    startup: "npm run dev",
  },
];

const shouldRunChecks = process.argv.includes("--check");
const isProdGate = process.argv.includes("--prod");

const PROD_REQUIRED_ENV = [
  "DATABASE_URL",
  "TELNYX_API_KEY",
  "TELNYX_FROM_NUMBER",
  "TELNYX_LIVE_TEST_TO",
];

function runShell(cmd, cwd) {
  const result = spawnSync("zsh", ["-lc", cmd], {
    cwd,
    stdio: "pipe",
    encoding: "utf8",
  });
  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
  };
}

function detectMissingDependency(output) {
  const text = String(output || "");
  const missingPkg = text.match(/Cannot find package '([^']+)'/i);
  if (missingPkg) return { packageName: missingPkg[1] };
  if (/failed to load config from .*vite\.config/i.test(text) && /ERR_MODULE_NOT_FOUND/i.test(text)) {
    return { packageName: "vite" };
  }
  return null;
}

if (!shouldRunChecks) {
  console.log("Known-good startup order (after checks pass):");
  for (const [idx, repo] of repos.entries()) {
    console.log(`${idx + 1}. ${repo.name}: cd ${repo.cwd} && ${repo.startup}`);
  }
  console.log("\nRun with --check to execute release checks.");
  process.exit(0);
}

if (isProdGate) {
  const missing = PROD_REQUIRED_ENV.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error("PROD gate failed: missing required env vars for live checks:");
    for (const name of missing) {
      console.error(`- ${name}`);
    }
    process.exit(1);
  }
}

let failures = 0;
const blocked = [];

for (const repo of repos) {
  console.log(`\n=== ${repo.name} ===`);
  let installAttempted = false;
  for (const cmd of repo.checks) {
    let result = runShell(cmd, repo.cwd);
    let combinedOutput = `${result.stdout}\n${result.stderr}`;
    const missingDep = detectMissingDependency(combinedOutput);
    if (!result.ok && missingDep && !installAttempted) {
      const install = runShell("npm ci", repo.cwd);
      if (install.ok) {
        installAttempted = true;
        console.log(`AUTOHEAL: npm ci completed for ${repo.name}; retrying ${cmd}`);
        result = runShell(cmd, repo.cwd);
        combinedOutput = `${result.stdout}\n${result.stderr}`;
      } else {
        console.log(`AUTOHEAL FAIL: npm ci failed for ${repo.name}`);
      }
    }
    if (result.ok) {
      console.log(`PASS: ${cmd}`);
      continue;
    }

    const envBlocked =
      combinedOutput.includes("DATABASE_URL is required") ||
      combinedOutput.includes("TELNYX_LIVE_TEST_TO is required") ||
      combinedOutput.includes("not set - Database features will not work");

    if (envBlocked) {
      if (isProdGate) {
        failures += 1;
        console.log(`FAIL: ${cmd} (blocked by missing live/prod environment variables)`);
        continue;
      }
      blocked.push({ repo: repo.name, cmd, reason: "missing live/prod environment variables" });
      console.log(`BLOCKED: ${cmd} (missing live/prod environment variables)`);
      continue;
    }

    failures += 1;
    console.log(`FAIL: ${cmd}`);
    if (result.stdout) console.log(result.stdout.split("\n").slice(-15).join("\n"));
    if (result.stderr) console.log(result.stderr.split("\n").slice(-15).join("\n"));
  }
}

console.log("\n=== Summary ===");
console.log(`Hard failures: ${failures}`);
console.log(`Blocked checks: ${blocked.length}`);
if (blocked.length > 0) {
  for (const item of blocked) {
    console.log(`- ${item.repo}: ${item.cmd} (${item.reason})`);
  }
}

process.exit(failures > 0 ? 1 : 0);
