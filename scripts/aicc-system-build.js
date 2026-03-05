#!/usr/bin/env node
"use strict";

/**
 * aicc-system-build.js
 * End-to-end orchestration:
 * 1) transcript/brief pipeline
 * 2) campaign generation (niche pack + variants + scene quality)
 * 3) schedule autopublish queue
 * 4) run due publishes
 */

const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");

function run(label, cmd, args, allowFail = false) {
  console.log(`\n[aicc-system] ${label}`);
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    encoding: "utf8",
    timeout: 600000,
  });
  if (r.status !== 0 && !allowFail) {
    throw new Error(`${label} failed`);
  }
}

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  if (i < 0 || i + 1 >= process.argv.length) return fallback;
  return String(process.argv[i + 1] || "").trim() || fallback;
}

function has(flag) {
  return process.argv.includes(flag);
}

function main() {
  const topic = arg("--topic", process.env.AICC_TOPIC || "automated content creator");
  const niche = arg("--niche", process.env.AICC_NICHE_PACK || "ai-clone-news");
  const variants = arg("--variants", process.env.AICC_VARIANTS || "3");
  const video = arg("--video", process.env.AICC_VIDEO_ASSET || "");
  const schedule = !has("--no-schedule");
  const publishDue = has("--publish-due");

  run("content-creator pipeline", "npm", ["run", "-s", "content-creator:pipeline"]);
  run("campaign engine", "node", [path.join(ROOT, "scripts", "aicc-campaign-engine.js"), "--topic", topic, "--niche", niche, "--variants", variants, "--run-research"]);

  if (schedule) {
    const schedArgs = [
      path.join(ROOT, "scripts", "aicc-autopublish.js"),
      "schedule",
      "--campaign", path.join(ROOT, "reports", "aicc-campaign-latest.json"),
      "--platforms", "youtube,tiktok,instagram",
      "--spacing-min", process.env.AICC_SCHEDULE_SPACING_MIN || "120",
    ];
    if (video) schedArgs.push("--video", video);
    run("autopublish scheduling", "node", schedArgs);
  }

  if (publishDue) {
    run("autopublish run-due", "node", [path.join(ROOT, "scripts", "aicc-autopublish.js"), "run-due"], true);
  }

  console.log("\n[aicc-system] Complete");
  console.log("- campaign: reports/aicc-campaign-latest.json");
  console.log("- publish queue: data/aicc-publish-queue.json");
  console.log("- publish results: reports/aicc-publish-results-latest.json");
  console.log("- ab results: npm run -s aicc:ab:score");
}

main();
