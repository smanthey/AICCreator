"use strict";

const path = require("path");
const { spawnSync } = require("child_process");
const { register } = require("./registry");

function runNodeScript(scriptRel, args = [], timeoutMs = 20 * 60 * 1000) {
  const script = path.join(__dirname, "..", scriptRel);
  const res = spawnSync("node", [script, ...args], {
    encoding: "utf8",
    timeout: timeoutMs,
    env: process.env,
  });
  const stdout = (res.stdout || "").trim();
  const stderr = (res.stderr || "").trim();
  if (res.status !== 0) {
    throw new Error(`${path.basename(scriptRel)} failed: ${stderr || stdout || "unknown error"}`);
  }
  return { stdout, stderr };
}

register("security_secrets_scan", async (payload = {}) => {
  const args = [];
  if (payload.no_fail) args.push("--no-fail");
  const { stdout } = runNodeScript("scripts/security-secrets-scan.js", args);
  return {
    status: "ok",
    output: stdout,
    cost_usd: 0,
    model_used: "deterministic-security-secrets",
  };
});

register("security_deps_audit", async (payload = {}) => {
  const args = [];
  if (payload.fail_on) args.push("--fail-on", String(payload.fail_on));
  if (payload.no_fail) args.push("--no-fail");
  const { stdout } = runNodeScript("scripts/security-deps-audit.js", args);
  return {
    status: "ok",
    output: stdout,
    cost_usd: 0,
    model_used: "deterministic-security-deps",
  };
});

register("security_runtime_audit", async (payload = {}) => {
  const args = [];
  if (payload.no_fail) args.push("--no-fail");
  const { stdout } = runNodeScript("scripts/security-runtime-audit.js", args);
  return {
    status: "ok",
    output: stdout,
    cost_usd: 0,
    model_used: "deterministic-security-runtime",
  };
});

register("security_sweep", async (payload = {}) => {
  const args = [];
  if (payload.dep_fail_on) args.push("--dep-fail-on", String(payload.dep_fail_on));
  if (payload.no_fail) args.push("--no-fail");
  const { stdout } = runNodeScript("scripts/security-sweep.js", args);
  return {
    status: "ok",
    output: stdout,
    cost_usd: 0,
    model_used: "deterministic-security-sweep",
  };
});

// Nightly AI-powered security council. Routes via model-router so it uses
// ollama → deepseek → gemini → openai → anthropic (as configured in model-routing-policy.json).
// Timeout: 30 min — Opus-class synthesis takes time.
register("security_council", async (payload = {}) => {
  const args = [];
  if (payload.dry_run) args.push("--dry-run");
  if (payload.max_files) args.push("--max-files", String(payload.max_files));
  const { stdout, stderr } = runNodeScript("scripts/security-council.js", args, 30 * 60 * 1000);
  return {
    status: "ok",
    output: stdout,
    warning: stderr || undefined,
    cost_usd: null, // billed via model-router telemetry, not tracked here
    model_used: "model-router/security_council",
  };
});
