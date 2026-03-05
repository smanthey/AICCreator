"use strict";

const path = require("path");
const { spawnSync } = require("child_process");
const { register } = require("./registry");

function runNodeScript(scriptRel, args = []) {
  const script = path.join(__dirname, "..", scriptRel);
  const res = spawnSync("node", [script, ...args], {
    encoding: "utf8",
    timeout: 10 * 60 * 1000,
  });
  const stdout = (res.stdout || "").trim();
  const stderr = (res.stderr || "").trim();
  if (res.status !== 0) {
    throw new Error(`${path.basename(scriptRel)} failed: ${stderr || stdout || "unknown error"}`);
  }
  return { stdout, stderr };
}

register("research_sync", async (payload = {}) => {
  const args = [];
  if (payload.domain) args.push("--domain", String(payload.domain));
  if (payload.days) args.push("--days", String(payload.days));
  if (payload.limit) args.push("--limit", String(payload.limit));
  if (payload.dry_run) args.push("--dry-run");

  const { stdout } = runNodeScript("scripts/research-sync.js", args);
  return {
    status: "ok",
    output: stdout.split("\n").slice(-20).join("\n"),
    cost_usd: 0,
    model_used: "deterministic-research-ingest",
  };
});

register("research_signals", async (payload = {}) => {
  const args = [];
  if (payload.days) args.push("--days", String(payload.days));
  if (payload.limit) args.push("--limit", String(payload.limit));
  const { stdout } = runNodeScript("scripts/research-signals.js", args);
  return {
    status: "ok",
    output: stdout,
    cost_usd: 0,
    model_used: "deterministic-signal-extract",
  };
});

register("platform_health_report", async () => {
  const { stdout } = runNodeScript("scripts/platform-health-report.js", []);
  return {
    status: "ok",
    report: stdout,
    cost_usd: 0,
    model_used: "deterministic-health-aggregate",
  };
});

register("affiliate_research", async (payload = {}) => {
  const args = [];
  if (payload.host) args.push("--host", String(payload.host));
  if (payload.limit) args.push("--limit", String(payload.limit));
  const { stdout } = runNodeScript("scripts/affiliate-rollout-research.js", args);
  return {
    status: "ok",
    output: stdout,
    cost_usd: 0,
    model_used: "deterministic-affiliate-research",
  };
});
