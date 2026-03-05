#!/usr/bin/env node
"use strict";

const { spawn } = require("child_process");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

function toPosInt(value, fallback) {
  const n = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const githubLimit = toPosInt(process.env.AI_WORK_PULSE_GITHUB_SCAN_LIMIT, 40);
const signalsLimit = toPosInt(process.env.AI_WORK_PULSE_SIGNALS_LIMIT, 120);
const signalsDays = toPosInt(process.env.AI_WORK_PULSE_SIGNALS_DAYS, 14);

const steps = [
  {
    name: "model-routing-stats",
    cmd: "npm",
    args: ["run", "model:routing:stats"],
  },
  {
    name: "github-scan",
    cmd: "npm",
    args: ["run", "github:scan", "--", "--limit", String(githubLimit), "--strict-baseline"],
  },
  {
    name: "repo-normalization-queue",
    cmd: "npm",
    args: ["run", "repo:normalize:queue", "--", "--limit", "8"],
  },
  {
    name: "research-signals",
    cmd: "npm",
    args: [
      "run",
      "research:signals",
      "--",
      "--days",
      String(signalsDays),
      "--limit",
      String(signalsLimit),
    ],
  },
];

function runStep(step) {
  return new Promise((resolve) => {
    const started = Date.now();
    const p = spawn(step.cmd, step.args, {
      cwd: path.join(__dirname, ".."),
      env: process.env,
      stdio: "inherit",
    });
    p.on("close", (code) => {
      resolve({
        name: step.name,
        code: Number(code || 0),
        ms: Date.now() - started,
      });
    });
  });
}

async function main() {
  console.log("[ai-work-pulse] start");
  console.log(
    `[ai-work-pulse] limits github=${githubLimit} signals_days=${signalsDays} signals_limit=${signalsLimit}`
  );

  const results = [];
  for (const step of steps) {
    console.log(`[ai-work-pulse] step=${step.name} begin`);
    const result = await runStep(step);
    console.log(
      `[ai-work-pulse] step=${result.name} code=${result.code} duration_ms=${result.ms}`
    );
    results.push(result);
  }

  const failed = results.filter((r) => r.code !== 0);
  if (failed.length) {
    console.error(
      `[ai-work-pulse] completed_with_failures count=${failed.length} failed=${failed
        .map((f) => f.name)
        .join(",")}`
    );
    process.exit(1);
  }

  console.log("[ai-work-pulse] completed_ok");
}

main().catch((err) => {
  console.error("[ai-work-pulse] fatal:", err.message);
  process.exit(1);
});
