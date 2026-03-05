#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { notifyMonitoring } = require("../control/monitoring-notify");

const ROOT = path.join(__dirname, "..");
const REPORTS_DIR = path.join(ROOT, "scripts", "reports");
const DRY_RUN = process.argv.includes("--dry-run");
const BACKUP_REPO_PATH = path.resolve(
  String(process.env.BACKUP_REPO_PATH || path.join(os.homedir(), "claw-architect-backup"))
);
const BACKUP_REPO_GIT_URL = String(process.env.BACKUP_REPO_GIT_URL || "").trim();
const BACKUP_BRANCH = String(process.env.BACKUP_REPO_BRANCH || "main").trim();

const SKIP_PREFIX = [
  ".git/",
  "node_modules/",
  "dist/",
  "build/",
  "coverage/",
  "scripts/reports/",
  ".next/",
];

const CRITICAL_NAME = new Set(["SOUL.md", "MEMORY.md", "AGENTS.md", "IDENTITY.md", "USER.md"]);
const CRON_FILES = ["ecosystem.background.config.js", "ecosystem.ai-satellite.config.js", "ecosystem.i7-satellite.config.js"];

function hash(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

// C5 fix: use args array (no shell) to prevent injection via env-var-sourced paths/URLs.
function run(args, cwd = ROOT, timeoutMs = 10 * 60 * 1000) {
  const [bin, ...rest] = Array.isArray(args) ? args : args.split(/\s+/);
  const p = spawnSync(bin, rest, {
    cwd,
    env: { ...process.env, CI: "1" },
    encoding: "utf8",
    timeout: timeoutMs,
    shell: false,
  });
  return {
    ok: Number(p.status || 0) === 0,
    code: Number(p.status || 0),
    stdout: String(p.stdout || ""),
    stderr: String(p.stderr || ""),
  };
}

async function ensureBackupRepo() {
  if (fs.existsSync(path.join(BACKUP_REPO_PATH, ".git"))) return;
  if (DRY_RUN) return;
  if (!BACKUP_REPO_GIT_URL) {
    throw new Error("Backup repo missing and BACKUP_REPO_GIT_URL not set");
  }
  const parent = path.dirname(BACKUP_REPO_PATH);
  await fsp.mkdir(parent, { recursive: true });
  const clone = run(["git", "clone", BACKUP_REPO_GIT_URL, BACKUP_REPO_PATH], ROOT);
  if (!clone.ok) throw new Error(`git clone failed: ${clone.stderr || clone.stdout}`);
}

function isLikelyText(buf) {
  const max = Math.min(buf.length, 4096);
  if (max === 0) return true;
  let weird = 0;
  for (let i = 0; i < max; i += 1) {
    const c = buf[i];
    if (c === 0) return false;
    if (c < 9 || (c > 13 && c < 32)) weird += 1;
  }
  return weird / max < 0.03;
}

function sanitizeText(text) {
  let out = text;
  out = out.replace(/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g, "[PRIVATE_KEY]");
  out = out.replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "[API_KEY]");
  out = out.replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "[API_KEY]");
  out = out.replace(/\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/g, "[API_KEY]");
  out = out.replace(/\bAIza[0-9A-Za-z\-_]{35}\b/g, "[API_KEY]");
  out = out.replace(/\beyJ[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{10,}\b/g, "[TOKEN]");
  out = out.replace(/(postgres(?:ql)?:\/\/[^:\s]+:)([^@\s]+)(@)/ig, "$1[PASSWORD]$3");
  out = out.replace(/(^|\n)(\s*[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*\s*=\s*)([^\n]+)/g, "$1$2[API_KEY]");
  out = out.replace(/(^|\n)(\s*\"?[A-Za-z0-9_-]*(?:key|token|secret|password)[A-Za-z0-9_-]*\"?\s*:\s*)\"[^\"]+\"/gi, '$1$2"[API_KEY]"');
  return out;
}

async function walk(dir, out = []) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    const rel = path.relative(ROOT, abs);
    if (SKIP_PREFIX.some((p) => rel.startsWith(p))) continue;
    if (e.isDirectory()) {
      await walk(abs, out);
    } else if (e.isFile()) {
      out.push(rel);
    }
  }
  return out;
}

async function collectFiles() {
  const tracked = run(["git", "ls-files", "-z"]);
  if (!tracked.ok) throw new Error(`git ls-files failed: ${tracked.stderr || tracked.stdout}`);
  const trackedFiles = tracked.stdout.split("\0").map((s) => s.trim()).filter(Boolean);
  const all = new Set(trackedFiles);

  for (const rel of await walk(path.join(ROOT, "agent-state"))) {
    if (CRITICAL_NAME.has(path.basename(rel))) all.add(rel);
  }
  for (const f of CRON_FILES) {
    if (fs.existsSync(path.join(ROOT, f))) all.add(f);
  }
  return Array.from(all).sort();
}

function isCritical(rel) {
  if (CRITICAL_NAME.has(path.basename(rel))) return true;
  if (rel.startsWith("agents/skills/")) return true;
  if (CRON_FILES.includes(rel)) return true;
  if (rel === "AGENTS.md") return true;
  return false;
}

async function copySanitized(files) {
  const manifest = [];
  let replacedCount = 0;

  for (const rel of files) {
    const src = path.join(ROOT, rel);
    const dst = path.join(BACKUP_REPO_PATH, rel);
    const buf = await fsp.readFile(src);
    let outBuf = buf;
    let replaced = false;
    if (isLikelyText(buf)) {
      const sanitized = sanitizeText(buf.toString("utf8"));
      if (sanitized !== buf.toString("utf8")) replaced = true;
      outBuf = Buffer.from(sanitized, "utf8");
    }
    if (!DRY_RUN) {
      await fsp.mkdir(path.dirname(dst), { recursive: true });
      await fsp.writeFile(dst, outBuf);
    }
    if (replaced) replacedCount += 1;
    manifest.push({
      file: rel,
      critical: isCritical(rel),
      sanitized: replaced,
      sha256: hash(outBuf),
    });
  }

  return { manifest, replacedCount };
}

async function writeMeta(manifest, replacedCount) {
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const dateTag = now.toISOString().slice(0, 10);
  const metaDir = path.join(BACKUP_REPO_PATH, "_meta");
  const summary = {
    generated_at: now.toISOString(),
    source_root: ROOT,
    files_total: manifest.length,
    critical_files: manifest.filter((m) => m.critical).length,
    sanitized_files: replacedCount,
  };
  if (!DRY_RUN) {
    await fsp.mkdir(metaDir, { recursive: true });
    await fsp.writeFile(path.join(metaDir, `critical-files-${dateTag}.json`), JSON.stringify(manifest.filter((m) => m.critical), null, 2));
    await fsp.writeFile(path.join(metaDir, `backup-manifest-${stamp}.json`), JSON.stringify(manifest, null, 2));
    await fsp.writeFile(path.join(metaDir, "last-backup-summary.json"), JSON.stringify(summary, null, 2));
  }
  return summary;
}

async function gitCommitPush(summary) {
  const checkout = run(["git", "checkout", BACKUP_BRANCH], BACKUP_REPO_PATH);
  if (!checkout.ok) throw new Error(`backup repo checkout failed: ${checkout.stderr || checkout.stdout}`);
  const pull = run(["git", "pull", "--rebase", "origin", BACKUP_BRANCH], BACKUP_REPO_PATH);
  if (!pull.ok) throw new Error(`backup repo pull failed: ${pull.stderr || pull.stdout}`);
  const add = run(["git", "add", "-A"], BACKUP_REPO_PATH);
  if (!add.ok) throw new Error(`backup repo add failed: ${add.stderr || add.stdout}`);
  const diff = run(["git", "diff", "--cached", "--name-only"], BACKUP_REPO_PATH);
  const changed = diff.stdout.trim().split("\n").filter(Boolean);
  if (!changed.length) return { committed: false, pushed: false, changed_files: 0 };

  const date = new Date().toISOString().slice(0, 10);
  const msg = `backup ${date}: files=${summary.files_total} sanitized=${summary.sanitized_files} critical=${summary.critical_files}`;
  const commit = run(["git", "commit", "-m", msg], BACKUP_REPO_PATH);
  if (!commit.ok) throw new Error(`backup repo commit failed: ${commit.stderr || commit.stdout}`);
  const push = run(["git", "push", "origin", BACKUP_BRANCH], BACKUP_REPO_PATH);
  if (!push.ok) throw new Error(`backup repo push failed: ${push.stderr || push.stdout}`);
  return { committed: true, pushed: true, changed_files: changed.length };
}

async function main() {
  const started = new Date().toISOString();
  await ensureBackupRepo();
  const files = await collectFiles();
  const { manifest, replacedCount } = await copySanitized(files);
  const summary = await writeMeta(manifest, replacedCount);

  let gitResult = { committed: false, pushed: false, changed_files: 0 };
  if (!DRY_RUN) {
    gitResult = await gitCommitPush(summary);
  }

  const report = {
    generated_at: new Date().toISOString(),
    started_at: started,
    dry_run: DRY_RUN,
    backup_repo_path: BACKUP_REPO_PATH,
    backup_branch: BACKUP_BRANCH,
    ...summary,
    git: gitResult,
  };

  await fsp.mkdir(REPORTS_DIR, { recursive: true });
  const outPath = path.join(REPORTS_DIR, `${Date.now()}-overnight-backup.json`);
  await fsp.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
  await fsp.writeFile(path.join(REPORTS_DIR, "overnight-backup-latest.json"), `${JSON.stringify(report, null, 2)}\n`);

  const changedList = gitResult.changed_files > 0 ? ` changed=${gitResult.changed_files}` : "";
  const msg = `✅ **4:30 AM Secure Backup complete**\nfiles=${summary.files_total} critical=${summary.critical_files} sanitized=${summary.sanitized_files}${changedList}\ncommitted=${gitResult.committed} pushed=${gitResult.pushed}\nreport: \`${path.relative(ROOT, outPath)}\``;
  await notifyMonitoring(msg);
  console.log(msg.replace(/\*\*/g, ""));
}

main().catch(async (err) => {
  const msg = `🚨 **4:30 AM Secure Backup FAILED**\n\`${String(err.message || err)}\``;
  try {
    await notifyMonitoring(msg);
  } catch {}
  console.error(`[overnight-backup-sanitize-push] fatal: ${err.message}`);
  process.exit(1);
});
