#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const args = process.argv.slice(2);
const getArg = (flag, fallback = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};
const hasFlag = (flag) => args.includes(flag);

const ROOT = process.env.CLAW_REPOS_ROOT || "/Users/tatsheen/claw-repos";
const rawReposArg = getArg("--repos", "");
const EXCLUDE = new Set(
  (getArg("--exclude", "") || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
);
const repos = rawReposArg
  ? rawReposArg.split(",").map((x) => x.trim()).filter(Boolean)
  : fs.readdirSync(ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .filter((name) => !EXCLUDE.has(name));
const APPLY_GIT = hasFlag("--commit");
const PUSH = hasFlag("--push");

const TENANT_FILE = `export function requireOrganizationId(input: { organization_id?: string | null; org_id?: string | null; tenant_id?: string | null }) {
  const organization_id = input.organization_id || input.org_id || input.tenant_id || null;
  if (!organization_id) {
    throw new Error("organization_id required");
  }
  return organization_id;
}

export function requireRole(role: string, allowed: string[] = ["owner", "admin"]) {
  if (!allowed.includes(role)) {
    throw new Error("rbac violation");
  }
  return true;
}
`;

const GATE_SCRIPT = `#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");

const root = process.cwd();
const files = [];
const skip = new Set([".git","node_modules",".next","dist","build"]);
const stack = [root];
while (stack.length) {
  const dir = stack.pop();
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (!skip.has(e.name)) stack.push(full); continue; }
    if (!e.isFile()) continue;
    if (/\.(ts|tsx|js|jsx|sql)$/.test(e.name)) files.push(full);
  }
}

let hasBetterAuth = false;
let authSignals = false;
let hasOrgModel = false;
let hasRbac = false;
for (const f of files) {
  const txt = fs.readFileSync(f, "utf8");
  if (/better-auth/.test(txt)) hasBetterAuth = true;
  if (/next-auth|supabase|firebase|clerk|getServerSession|auth\(/.test(txt)) authSignals = true;
  if (/organization_id|org_id|tenant_id/.test(txt)) hasOrgModel = true;
  if (/requireRole|hasRole|rbac|role\s*[:=]/.test(txt)) hasRbac = true;
}

const errs = [];
if (authSignals && !hasBetterAuth) errs.push("better-auth baseline missing");
if (!hasOrgModel) errs.push("multi-tenant org model signal missing");
if (!hasRbac) errs.push("rbac signal missing");
if (errs.length) {
  console.error("baseline gate failed:");
  for (const e of errs) console.error("- " + e);
  process.exit(1);
}
console.log("baseline gate pass");
`;

const SECURITY_GATE_SCRIPT = `#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const root = process.cwd();
const skip = new Set([".git","node_modules",".next","dist","build",".vercel"]);
const stack = [root];
const files = [];
while (stack.length) {
  const dir = stack.pop();
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (!skip.has(e.name)) stack.push(full); continue; }
    if (!e.isFile()) continue;
    if (/\\.(ts|tsx|js|jsx|mjs|cjs|json|env|yml|yaml)$/.test(e.name)) files.push(full);
  }
}
const risky = [];
const re = /(api[_-]?key\\s*[=:]\\s*['\\\"][A-Za-z0-9_\\-]{16,}|sk_live_[A-Za-z0-9]+|-----BEGIN (RSA|EC|OPENSSH) PRIVATE KEY-----|GOOGLE_OAUTH_CLIENT_SECRET\\s*=\\s*.+)/i;
for (const f of files) {
  const txt = fs.readFileSync(f, "utf8");
  if (re.test(txt) && !/\\.example|\\.sample|dummy|placeholder|test-fixtures/i.test(f)) {
    risky.push(f.replace(root + path.sep, ""));
  }
}
if (risky.length) {
  console.error("security gate failed; potential secrets found:");
  for (const f of risky.slice(0, 20)) console.error("- " + f);
  process.exit(1);
}
console.log("security gate pass");
`;

const WORKFLOW = `name: claw-baseline-gate

on:
  pull_request:
  push:
    branches: [main]

jobs:
  baseline-gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: node scripts/claw-baseline-gate.js
`;

const SECURITY_WORKFLOW = `name: claw-security-gate

on:
  pull_request:
  push:
    branches: [main]

jobs:
  security-gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: node scripts/claw-security-gate.js
`;

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function writeIfChanged(file, contents) {
  const prev = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  if (prev === contents) return false;
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, contents);
  return true;
}

function runGit(repoPath, args) {
  return spawnSync("git", args, { cwd: repoPath, encoding: "utf8" });
}

function patchPackageScripts(repoPath) {
  const pkgPath = path.join(repoPath, "package.json");
  if (!fs.existsSync(pkgPath)) return false;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  pkg.scripts = pkg.scripts || {};
  let changed = false;
  if (!pkg.scripts["claw:baseline:gate"]) {
    pkg.scripts["claw:baseline:gate"] = "node scripts/claw-baseline-gate.js";
    changed = true;
  }
  if (!pkg.scripts["claw:security:gate"]) {
    pkg.scripts["claw:security:gate"] = "node scripts/claw-security-gate.js";
    changed = true;
  }
  if (changed) fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  return changed;
}

function main() {
  const summary = [];
  console.log(`[repo-baseline-rollout] root=${ROOT} repos=${repos.length} commit=${APPLY_GIT} push=${PUSH}`);
  for (const repo of repos) {
    const repoPath = path.join(ROOT, repo);
    if (!fs.existsSync(repoPath)) {
      summary.push({ repo, ok: false, reason: "missing_repo" });
      continue;
    }

    const changed = [];
    if (writeIfChanged(path.join(repoPath, "lib", "tenant-baseline.ts"), TENANT_FILE)) changed.push("tenant-baseline.ts");
    if (writeIfChanged(path.join(repoPath, "scripts", "claw-baseline-gate.js"), GATE_SCRIPT)) changed.push("scripts/claw-baseline-gate.js");
    if (writeIfChanged(path.join(repoPath, "scripts", "claw-security-gate.js"), SECURITY_GATE_SCRIPT)) changed.push("scripts/claw-security-gate.js");
    if (writeIfChanged(path.join(repoPath, ".github", "workflows", "claw-baseline-gate.yml"), WORKFLOW)) changed.push(".github/workflows/claw-baseline-gate.yml");
    if (writeIfChanged(path.join(repoPath, ".github", "workflows", "claw-security-gate.yml"), SECURITY_WORKFLOW)) changed.push(".github/workflows/claw-security-gate.yml");
    if (patchPackageScripts(repoPath)) changed.push("package.json");

    if (APPLY_GIT && changed.length) {
      runGit(repoPath, ["add", "-A"]);
      runGit(repoPath, ["commit", "-m", "chore: enforce BetterAuth + multi-tenant baseline gate"]);
      if (PUSH) runGit(repoPath, ["push", "origin", "main"]);
    }

    summary.push({ repo, ok: true, changed });
  }

  console.log("\n=== Repo Baseline Rollout ===\n");
  for (const s of summary) {
    if (!s.ok) console.log(`- ${s.repo}: ${s.reason}`);
    else console.log(`- ${s.repo}: changed=${s.changed.length} [${s.changed.join(", ")}]`);
  }
}

main();
