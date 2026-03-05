#!/usr/bin/env node
"use strict";

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const { spawnSync } = require("child_process");
const path = require("path");
const { generateCreatorPack } = require("../agents/openclaw-creator-pack-agent");

const ARGS = process.argv.slice(2);

function arg(flag, fallback = null) {
  const i = ARGS.indexOf(flag);
  if (i < 0 || i + 1 >= ARGS.length) return fallback;
  return ARGS[i + 1];
}

function has(flag) {
  return ARGS.includes(flag);
}

function payloadFromArgs() {
  return {
    package_name: arg("--name", "OpenClaw Creator Pack"),
    client_name: arg("--client", "Content Creator"),
    complexity: arg("--complexity", "standard"),
    outcome: arg("--outcome", "Set up OpenClaw on macOS, connect Telegram, and run creator workflows in one session."),
    output_dir: arg("--output-dir", path.join(__dirname, "..", "artifacts", "openclaw-creator-pack")),
  };
}

function queueTask(payload) {
  const cmd = [
    "cli/create-task.js",
    "--type",
    "openclaw_creator_pack_generate",
    "--payload",
    JSON.stringify(payload),
  ];
  const r = spawnSync("node", cmd, {
    cwd: path.join(__dirname, ".."),
    encoding: "utf8",
  });
  return {
    ok: r.status === 0,
    status: r.status,
    stdout: String(r.stdout || "").trim(),
    stderr: String(r.stderr || "").trim(),
  };
}

async function main() {
  const payload = payloadFromArgs();

  if (has("--queue")) {
    const q = queueTask(payload);
    if (!q.ok) {
      console.error("[openclaw-creator-pack] queue failed");
      if (q.stderr) console.error(q.stderr);
      process.exit(1);
    }
    console.log("[openclaw-creator-pack] queued openclaw_creator_pack_generate");
    if (q.stdout) console.log(q.stdout);
    process.exit(0);
  }

  const out = generateCreatorPack(payload);
  console.log("\n=== OpenClaw Creator Pack ===\n");
  console.log(`package_dir: ${out.package_dir}`);
  console.log(`suggested_price: $${out.suggested_pricing.selected.usd} (${out.suggested_pricing.selected.tier})`);
  console.log(`range: $${out.suggested_pricing.range_usd[0]} - $${out.suggested_pricing.range_usd[1]}`);
}

main().catch((err) => {
  console.error("[openclaw-creator-pack] fatal:", err.message || String(err));
  process.exit(1);
});
