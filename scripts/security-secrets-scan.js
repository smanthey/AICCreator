#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const ARGS = process.argv.slice(2);

const hasFlag = (flag) => ARGS.includes(flag);
const getArg = (flag, fallback = null) => {
  const i = ARGS.indexOf(flag);
  return i >= 0 && i + 1 < ARGS.length ? ARGS[i + 1] : fallback;
};

const SKIP_DEFAULT = [
  "node_modules/",
  ".git/",
  ".venv/",
  ".venv-openclaw-tools/",
  "dist/",
  "build/",
  "coverage/",
  "scripts/reports/",
  "ip_kb.sqlite",
  "claw_architect.db",
];

const SUPPRESSIONS = [
  { file: "scripts/mcp-postgres.sh", rule: "postgres_uri_with_password" },
  { file: "AGENTS.md", rule: "generic_secret_assignment" },
  { file: "CLAUDE.md", rule: "generic_secret_assignment" },
  { file: ".cursor/rules/trigger.basic.mdc", rule: "generic_secret_assignment" },
];

const RULES = [
  { id: "private_key_block", severity: "critical", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { id: "aws_access_key", severity: "critical", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { id: "github_token", severity: "critical", re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { id: "slack_token", severity: "high", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { id: "stripe_secret_key", severity: "high", re: /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/ },
  { id: "google_api_key", severity: "high", re: /\bAIza[0-9A-Za-z\-_]{35}\b/ },
  { id: "jwt_like_token", severity: "medium", re: /\beyJ[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{10,}\b/ },
  { id: "postgres_uri_with_password", severity: "high", re: /\bpostgres(?:ql)?:\/\/[^:\s]+:[^@\s]{4,}@/i },
  // Generic secret assignment only when a literal string is hardcoded.
  { id: "generic_secret_assignment", severity: "medium", re: /\b(?:api[_-]?key|secret|token|password)\b\s*[:=]\s*["'][A-Za-z0-9_\-\/+=]{12,}["']/i },
];

const IGNORE_VALUE_HINTS = [
  "example",
  "placeholder",
  "changeme",
  "your-",
  "your_",
  "xxxxx",
  "xxxx",
  "<",
  "sample",
];

function isTextLikely(content) {
  let weird = 0;
  const n = Math.min(content.length, 5000);
  for (let i = 0; i < n; i += 1) {
    const c = content.charCodeAt(i);
    if (c === 0) return false;
    if (c < 9 || (c > 13 && c < 32)) weird += 1;
  }
  return weird / Math.max(1, n) < 0.02;
}

function listTrackedFiles() {
  const res = spawnSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" });
  if (res.status !== 0) {
    throw new Error(`git ls-files failed: ${(res.stderr || "").trim()}`);
  }
  return res.stdout
    .split("\0")
    .map((s) => s.trim())
    .filter(Boolean);
}

function shouldSkip(rel) {
  return SKIP_DEFAULT.some((p) => rel.startsWith(p));
}

function isSuppressed(rel, ruleId) {
  return SUPPRESSIONS.some((s) => s.file === rel && s.rule === ruleId);
}

function looksLikePlaceholder(line) {
  const lower = line.toLowerCase();
  return IGNORE_VALUE_HINTS.some((h) => lower.includes(h));
}

function redact(line) {
  let out = line;
  out = out.replace(/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, "[REDACTED_AWS_KEY]");
  out = out.replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "[REDACTED_GH_TOKEN]");
  out = out.replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "[REDACTED_SLACK_TOKEN]");
  out = out.replace(/\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/g, "[REDACTED_STRIPE_KEY]");
  out = out.replace(/\bAIza[0-9A-Za-z\-_]{35}\b/g, "[REDACTED_GOOGLE_KEY]");
  out = out.replace(/\beyJ[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{10,}\b/g, "[REDACTED_JWT]");
  out = out.replace(/(postgres(?:ql)?:\/\/[^:\s]+:)([^@\s]+)(@)/ig, "$1[REDACTED]$3");
  return out;
}

function severityRank(s) {
  if (s === "critical") return 4;
  if (s === "high") return 3;
  if (s === "medium") return 2;
  if (s === "low") return 1;
  return 0;
}

function nowStamp() {
  return Date.now().toString();
}

function ensureReportsDir() {
  const dir = path.join(ROOT, "scripts/reports");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function main() {
  const noFail = hasFlag("--no-fail");
  const jsonOnly = hasFlag("--json");
  const outArg = getArg("--out", "");

  const tracked = listTrackedFiles();
  const findings = [];
  let scanned = 0;

  for (const rel of tracked) {
    if (shouldSkip(rel)) continue;
    const abs = path.join(ROOT, rel);
    let text = "";
    try {
      const stat = fs.statSync(abs);
      if (!stat.isFile() || stat.size > 1024 * 1024 * 2) continue;
      text = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    if (!text || !isTextLikely(text)) continue;
    scanned += 1;
    const lines = text.split(/\r?\n/);
    for (let ln = 0; ln < lines.length; ln += 1) {
      const line = lines[ln];
      if (!line || line.trim().startsWith("#")) continue;
      for (const rule of RULES) {
        if (!rule.re.test(line)) continue;
        if (rule.id === "generic_secret_assignment" && looksLikePlaceholder(line)) continue;
        if (isSuppressed(rel, rule.id)) continue;
        findings.push({
          file: rel,
          line: ln + 1,
          rule: rule.id,
          severity: rule.severity,
          snippet: redact(line).slice(0, 240),
        });
      }
    }
  }

  findings.sort((a, b) => {
    const sev = severityRank(b.severity) - severityRank(a.severity);
    if (sev !== 0) return sev;
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    return a.line - b.line;
  });

  const counts = findings.reduce((acc, f) => {
    acc[f.severity] = (acc[f.severity] || 0) + 1;
    return acc;
  }, {});

  const summary = {
    scanned_files: scanned,
    findings_total: findings.length,
    findings_by_severity: {
      critical: counts.critical || 0,
      high: counts.high || 0,
      medium: counts.medium || 0,
      low: counts.low || 0,
    },
    status: (counts.critical || 0) > 0 ? "fail" : "pass",
  };

  const report = {
    generated_at: new Date().toISOString(),
    tool: "security-secrets-scan",
    summary,
    findings,
  };

  const reportsDir = ensureReportsDir();
  const outPath = outArg || path.join(reportsDir, `${nowStamp()}-security-secrets.json`);
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

  if (!jsonOnly) {
    console.log("\n=== Security Secrets Scan ===\n");
    console.log(`scanned_files: ${summary.scanned_files}`);
    console.log(`findings_total: ${summary.findings_total}`);
    console.log(`critical/high/medium/low: ${summary.findings_by_severity.critical}/${summary.findings_by_severity.high}/${summary.findings_by_severity.medium}/${summary.findings_by_severity.low}`);
    if (findings.length > 0) {
      for (const f of findings.slice(0, 30)) {
        console.log(`- [${f.severity}] ${f.rule} ${f.file}:${f.line}`);
      }
      if (findings.length > 30) {
        console.log(`... ${findings.length - 30} more findings`);
      }
    } else {
      console.log("No exposed secret patterns found in tracked files.");
    }
    console.log(`report: ${outPath}`);
  }

  if (!noFail && (counts.critical || 0) > 0) {
    process.exit(1);
  }
}

try {
  main();
} catch (err) {
  console.error(`[security-secrets-scan] fatal: ${err.message}`);
  process.exit(1);
}
