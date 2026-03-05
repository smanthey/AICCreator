#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const REPORTS_DIR = path.join(ROOT, "reports");
const ALLOWLIST_PATH = path.join(ROOT, "config", "security-bind-guard-allowlist.json");

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
}

function walkJsFiles(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
  for (const ent of entries) {
      if (ent.name.startsWith(".")) continue;
      const full = path.join(current, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === "node_modules") continue;
        if (ent.name === "reports") continue;
        stack.push(full);
        continue;
      }
      if (ent.isFile() && ent.name.endsWith(".js")) out.push(full);
    }
  }
  return out.filter((fp) => path.basename(fp) !== "security-bind-guard.js");
}

function getTargetFiles() {
  const files = [];
  const rootEntries = fs.readdirSync(ROOT, { withFileTypes: true });
  for (const ent of rootEntries) {
    if (!ent.isFile()) continue;
    if (/^ecosystem.*\.config\.js$/i.test(ent.name)) {
      files.push(path.join(ROOT, ent.name));
    }
  }
  return [...files, ...walkJsFiles(path.join(ROOT, "scripts"))];
}

function isSnippetAllowed(content, snippetAllowlist) {
  return (snippetAllowlist || []).some((snippet) => snippet && content.includes(snippet));
}

function getLine(content, index) {
  const prior = content.slice(0, index);
  return prior.split("\n").length;
}

function splitTopLevelArgs(argText) {
  const args = [];
  let cur = "";
  let depthParen = 0;
  let depthBrace = 0;
  let depthBracket = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let escaped = false;

  for (let i = 0; i < argText.length; i += 1) {
    const ch = argText[i];
    if (escaped) {
      cur += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      cur += ch;
      escaped = true;
      continue;
    }
    if (!inDouble && !inTemplate && ch === "'") inSingle = !inSingle;
    else if (!inSingle && !inTemplate && ch === '"') inDouble = !inDouble;
    else if (!inSingle && !inDouble && ch === "`") inTemplate = !inTemplate;

    if (!inSingle && !inDouble && !inTemplate) {
      if (ch === "(") depthParen += 1;
      else if (ch === ")") depthParen = Math.max(0, depthParen - 1);
      else if (ch === "{") depthBrace += 1;
      else if (ch === "}") depthBrace = Math.max(0, depthBrace - 1);
      else if (ch === "[") depthBracket += 1;
      else if (ch === "]") depthBracket = Math.max(0, depthBracket - 1);
      else if (ch === "," && depthParen === 0 && depthBrace === 0 && depthBracket === 0) {
        args.push(cur.trim());
        cur = "";
        continue;
      }
    }

    cur += ch;
  }
  if (cur.trim()) args.push(cur.trim());
  return args;
}

function isCallbackArg(arg) {
  const s = String(arg || "").trim();
  if (!s) return false;
  if (s.includes("=>")) return true;
  if (/^async\s+function\b/.test(s)) return true;
  if (/^function\b/.test(s)) return true;
  return false;
}

function auditFile(filePath, allowlist) {
  const rel = path.relative(ROOT, filePath);
  const content = fs.readFileSync(filePath, "utf8");
  const violations = [];

  const bindContextRe = /(host|listen|bind|_HOST\b)/i;
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.includes("0.0.0.0")) continue;
    if (!bindContextRe.test(line)) continue;
    if (isSnippetAllowed(line, allowlist.snippets)) continue;
    violations.push({
      type: "wildcard_bind_literal",
      file: rel,
      line: i + 1,
      detail: "Found 0.0.0.0 in bind-related code. Use 127.0.0.1 default and explicit allowlist if required.",
      snippet: line.trim().slice(0, 220),
    });
  }

  const listenRe = /\b(?:app|server|httpServer|httpsServer)\.listen\s*\(([\s\S]{0,240}?)\)\s*;/g;
  for (const m of content.matchAll(listenRe)) {
    const full = m[0];
    const argsText = m[1] || "";
    const idx = m.index || 0;
    const line = getLine(content, idx);
    const args = splitTopLevelArgs(argsText);

    if (allowlist.files && Array.isArray(allowlist.files[rel])) {
      const patterns = allowlist.files[rel];
      if (patterns.some((p) => p && new RegExp(p).test(full))) {
        continue;
      }
    }

    if (args.length === 1) {
      violations.push({
        type: "implicit_all_interfaces",
        file: rel,
        line,
        detail: "listen() missing explicit host argument.",
        snippet: full.slice(0, 220),
      });
      continue;
    }

    const second = String(args[1] || "").trim();
    if (isCallbackArg(second)) {
      violations.push({
        type: "callback_as_second_arg",
        file: rel,
        line,
        detail: "listen(port, callback) omits host and binds all interfaces.",
        snippet: full.slice(0, 220),
      });
    }
  }

  return violations;
}

function main() {
  const startedAt = new Date().toISOString();
  const allowlist = readJson(ALLOWLIST_PATH, { snippets: [], files: {} });
  const targets = getTargetFiles();

  const violations = [];
  for (const file of targets) {
    violations.push(...auditFile(file, allowlist));
  }

  const report = {
    generated_at: new Date().toISOString(),
    started_at: startedAt,
    scanned_files: targets.length,
    violations_count: violations.length,
    violations,
    ok: violations.length === 0,
  };

  const latestPath = path.join(REPORTS_DIR, "security-bind-guard-latest.json");
  const stampedPath = path.join(REPORTS_DIR, `security-bind-guard-${Date.now()}.json`);
  writeJson(latestPath, report);
  writeJson(stampedPath, report);

  if (violations.length > 0) {
    console.error(`[security-bind-guard] FAIL violations=${violations.length}`);
    for (const v of violations.slice(0, 20)) {
      console.error(`- ${v.file}:${v.line} [${v.type}] ${v.detail}`);
    }
    process.exit(1);
  }

  console.log(`[security-bind-guard] OK scanned=${targets.length} violations=0`);
}

main();
