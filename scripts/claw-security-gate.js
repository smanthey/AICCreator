#!/usr/bin/env node
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
    if (/\.(ts|tsx|js|jsx|mjs|cjs|json|env|yml|yaml)$/.test(e.name)) files.push(full);
  }
}
const risky = [];
const re = /(api[_-]?key\s*[=:]\s*['\"][A-Za-z0-9_\-]{16,}|sk_live_[A-Za-z0-9]+|-----BEGIN (RSA|EC|OPENSSH) PRIVATE KEY-----|GOOGLE_OAUTH_CLIENT_SECRET\s*=\s*.+)/i;
for (const f of files) {
  const txt = fs.readFileSync(f, "utf8");
  if (re.test(txt) && !/\.example|\.sample|dummy|placeholder|test-fixtures/i.test(f)) {
    risky.push(f.replace(root + path.sep, ""));
  }
}
if (risky.length) {
  console.error("security gate failed; potential secrets found:");
  for (const f of risky.slice(0, 20)) console.error("- " + f);
  process.exit(1);
}
console.log("security gate pass");
