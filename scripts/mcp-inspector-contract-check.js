#!/usr/bin/env node
"use strict";

require("dotenv").config({ override: true });

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const REPORT_DIR = path.join(ROOT, "reports");
const TOOL_POLICY = path.join(ROOT, "config", "mcp-tool-policy.json");
const OAUTH_POLICY = path.join(ROOT, "config", "mcp-remote-oauth-policy.json");
const SERVERS = path.join(ROOT, "config", "mcp-servers.shared.json");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function run(command, timeoutMs = 45000) {
  const res = spawnSync("bash", ["-lc", command], {
    cwd: ROOT,
    env: { ...process.env, CI: "1" },
    encoding: "utf8",
    timeout: timeoutMs,
  });
  return {
    command,
    ok: Number(res.status || 0) === 0,
    code: Number(res.status || 0),
    stdout_tail: String(res.stdout || "").slice(-600),
    stderr_tail: String(res.stderr || "").slice(-600),
  };
}

function validateToolPolicy(policy) {
  const failures = [];
  const tools = Array.isArray(policy?.tools) ? policy.tools : [];
  if (!tools.length) failures.push("tools array is empty");
  for (const t of tools) {
    if (!t.id) failures.push("tool missing id");
    if (!String(t.use_when || "").trim()) failures.push(`tool ${t.id || "?"} missing use_when`);
    if (!String(t.do_not_use_when || "").trim()) failures.push(`tool ${t.id || "?"} missing do_not_use_when`);
    if (String(t.class || "").toLowerCase() === "write" && t.requires_confirmation !== true && t.requires_confirmation !== false) {
      failures.push(`write tool ${t.id || "?"} missing requires_confirmation boolean`);
    }
  }
  return failures;
}

function validateOAuthPolicy(policy) {
  const failures = [];
  if (policy?.remote_mcp?.oauth?.required !== true) failures.push("remote_mcp.oauth.required must be true");
  if (policy?.remote_mcp?.oauth?.default_scope_strategy !== "least_privilege") {
    failures.push("remote_mcp.oauth.default_scope_strategy must be least_privilege");
  }
  if (policy?.remote_mcp?.writes?.no_broad_write_by_default !== true) {
    failures.push("remote_mcp.writes.no_broad_write_by_default must be true");
  }
  if (policy?.remote_mcp?.writes?.explicit_confirmation_required !== true) {
    failures.push("remote_mcp.writes.explicit_confirmation_required must be true");
  }
  return failures;
}

function validateServersConfig(serversCfg) {
  const failures = [];
  const servers = serversCfg?.mcpServers || {};
  const names = Object.keys(servers);
  if (!names.length) failures.push("mcpServers is empty");
  for (const name of names) {
    if (!servers[name]?.command) failures.push(`mcpServers.${name}.command missing`);
  }
  return failures;
}

function writeReport(name, payload) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[.:]/g, "-");
  const report = path.join(REPORT_DIR, `${ts}-${name}.json`);
  const latest = path.join(REPORT_DIR, `${name}-latest.json`);
  fs.writeFileSync(report, JSON.stringify(payload, null, 2));
  fs.writeFileSync(latest, JSON.stringify(payload, null, 2));
  return { report, latest };
}

function main() {
  const failures = [];
  const warnings = [];

  let toolPolicy = null;
  let oauthPolicy = null;
  let serversCfg = null;

  try {
    toolPolicy = readJson(TOOL_POLICY);
  } catch (err) {
    failures.push(`cannot read ${path.relative(ROOT, TOOL_POLICY)}: ${err.message}`);
  }
  try {
    oauthPolicy = readJson(OAUTH_POLICY);
  } catch (err) {
    failures.push(`cannot read ${path.relative(ROOT, OAUTH_POLICY)}: ${err.message}`);
  }
  try {
    serversCfg = readJson(SERVERS);
  } catch (err) {
    failures.push(`cannot read ${path.relative(ROOT, SERVERS)}: ${err.message}`);
  }

  if (toolPolicy) failures.push(...validateToolPolicy(toolPolicy));
  if (oauthPolicy) failures.push(...validateOAuthPolicy(oauthPolicy));
  if (serversCfg) failures.push(...validateServersConfig(serversCfg));

  const health = run("node ./scripts/mcp-health-check.js", 120000);
  if (!health.ok) failures.push("mcp-health-check failed");

  const inspector = run("npx -y @modelcontextprotocol/inspector --help", 60000);
  if (!inspector.ok) warnings.push("mcp-inspector unavailable or failed to execute");

  const payload = {
    ok: failures.length === 0,
    generated_at: new Date().toISOString(),
    failures,
    warnings,
    checks: {
      policy_tool: { ok: toolPolicy ? validateToolPolicy(toolPolicy).length === 0 : false },
      policy_oauth: { ok: oauthPolicy ? validateOAuthPolicy(oauthPolicy).length === 0 : false },
      servers_config: { ok: serversCfg ? validateServersConfig(serversCfg).length === 0 : false },
      mcp_health: health,
      mcp_inspector: inspector,
    },
  };

  const paths = writeReport("mcp-inspector-contract-check", payload);
  console.log(JSON.stringify({ ...payload, report: paths }, null, 2));
  process.exit(payload.ok ? 0 : 1);
}

main();
