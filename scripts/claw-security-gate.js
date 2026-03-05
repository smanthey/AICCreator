#!/usr/bin/env node
"use strict";
(async () => {
  const req = typeof require === "function"
    ? require
    : (await import("node:module")).createRequire(process.cwd() + "/");
  const fs = req("node:fs");
  const path = req("node:path");
  const cp = req("node:child_process");
  const root = process.cwd();
  let tracked = [];
  try {
    const raw = cp.execSync("git ls-files", { cwd: root, stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" });
    tracked = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch {
    tracked = [];
  }
  const files = tracked
    .filter((f) => /\.(ts|tsx|js|jsx|mjs|cjs|json|env|yml|yaml)$/.test(f))
    .filter((f) => !/^(node_modules|reports|dist|build|coverage|vendor|\.next)\//.test(f))
    .filter((f) => !/\.env($|\.)/i.test(f))
    .filter((f) => !/(^|\/)__tests__(\/|$)|\.(test|spec)\./i.test(f))
    .map((f) => path.join(root, f))
    .filter((f) => fs.existsSync(f) && fs.statSync(f).isFile());

  const risky = [];
  const re = /(sk_live_[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z\-_]{35}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN (RSA|EC|OPENSSH|PRIVATE) KEY-----)/;
  for (const full of files) {
    const rel = full.replace(root + path.sep, "");
    const txt = fs.readFileSync(full, "utf8");
    if (re.test(txt) && !/\.example|\.sample|dummy|placeholder|test-fixtures/i.test(rel)) {
      risky.push(rel);
    }
  }
  if (risky.length) {
    console.error("security gate failed; potential secrets found:");
    for (const f of risky.slice(0, 20)) console.error("- " + f);
    process.exit(1);
  }
  console.log("security gate pass");
})().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
