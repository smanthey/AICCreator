#!/usr/bin/env node
"use strict";

const { spawnSync } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "..");

function run(label, cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: opts.timeoutMs || 12000,
    env: { ...process.env, CI: "1" },
  });

  const out = `${res.stdout || ""}\n${res.stderr || ""}`.trim();
  const timedOut = Boolean(res.error && res.error.code === "ETIMEDOUT");
  const code = typeof res.status === "number" ? res.status : (timedOut ? 124 : 1);

  let ok = code === 0;
  if (opts.allowTimeout && timedOut) ok = true;
  if (opts.expectPattern) ok = ok || new RegExp(opts.expectPattern, "i").test(out);

  return {
    label,
    ok,
    code,
    timed_out: timedOut,
    stdout_tail: String(res.stdout || "").slice(-400),
    stderr_tail: String(res.stderr || "").slice(-400),
  };
}

function main() {
  const checks = [
    run("trigger", "bash", ["-lc", "./scripts/mcp-trigger.sh --healthcheck"]),
    run("postgres", "bash", ["-lc", "./scripts/mcp-postgres.sh --healthcheck"]),
    run("filesystem", "bash", ["-lc", "./scripts/mcp-filesystem.sh --healthcheck"]),
    run("github", "bash", ["-lc", "./scripts/mcp-github.sh --healthcheck"]),
    run("jcodemunch", "bash", ["-lc", "./scripts/jcodemunch-mcp.sh --healthcheck"]),
    run("context7", "bash", ["-lc", "./scripts/mcp-context7.sh --healthcheck"]),
    run("github_server_boot", "bash", ["-lc", "npx -y @modelcontextprotocol/server-github"], { timeoutMs: 3500, allowTimeout: true, expectPattern: "running on stdio" }),
  ];

  const ok = checks.every((x) => x.ok);
  console.log(JSON.stringify({ ok, checks }, null, 2));
  process.exit(ok ? 0 : 1);
}

main();
