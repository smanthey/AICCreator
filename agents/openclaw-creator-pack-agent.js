"use strict";

const fs = require("fs");
const path = require("path");
const { register } = require("./registry");

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function writeFile(p, content) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, content, "utf8");
}

function slugify(v) {
  return String(v || "openclaw-creator-pack")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "openclaw-creator-pack";
}

function priceForComplexity(complexity) {
  const c = String(complexity || "standard").toLowerCase();
  if (c === "simple") return { usd: 500, tier: "simple" };
  if (c === "premium") return { usd: 1500, tier: "premium" };
  return { usd: 900, tier: "standard" };
}

function macInstallerScript() {
  return `#!/usr/bin/env bash
set -euo pipefail

# OpenClaw Creator Pack installer for macOS
# Installs baseline dependencies and scaffolds OpenClaw runtime for content creators.

ROOT="\${HOME}/openclaw-creator-studio"
mkdir -p "$ROOT"

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew missing. Install first: https://brew.sh"
  exit 1
fi

brew install git node python3 ollama || true

if [ ! -d "$ROOT/openclaw" ]; then
  git clone https://github.com/openclaw/openclaw.git "$ROOT/openclaw"
fi

cd "$ROOT/openclaw"
if [ -f package.json ]; then
  npm install || true
fi

mkdir -p "$ROOT/runtime"
cat > "$ROOT/runtime/.env.template" <<'ENV'
OPENCLAW_PORT=3333
OPENCLAW_MODEL_PROVIDER=ollama
OLLAMA_HOST=http://127.0.0.1:11434
OLLAMA_MODEL_FAST=llama3.2:3b
TELEGRAM_BOT_TOKEN=
TELEGRAM_ALLOWED_CHAT_IDS=
YOUTUBE_API_KEY=
TIKTOK_INPUT_SOURCES=
ENV

echo "OpenClaw creator studio scaffolded at: $ROOT"
echo "Next: copy runtime/.env.template -> runtime/.env and fill Telegram token."
`;
}

function swiftAppTemplate() {
  return `import SwiftUI

@main
struct OpenClawSetupApp: App {
  var body: some Scene {
    WindowGroup {
      ContentView()
    }
  }
}

struct ContentView: View {
  var body: some View {
    ZStack {
      LinearGradient(colors: [Color(red: 0.05, green: 0.08, blue: 0.15), Color(red: 0.10, green: 0.16, blue: 0.28)], startPoint: .topLeading, endPoint: .bottomTrailing)
        .ignoresSafeArea()
      VStack(alignment: .leading, spacing: 14) {
        Text("OpenClaw Creator Studio")
          .font(.system(size: 34, weight: .bold))
          .foregroundColor(.white)
        Text("Install + Telegram + Creator workflows")
          .foregroundColor(.white.opacity(0.8))
        VStack(alignment: .leading, spacing: 8) {
          Label("Install OpenClaw runtime", systemImage: "checkmark.circle")
          Label("Connect Telegram bot", systemImage: "paperplane")
          Label("Launch creator workflows", systemImage: "sparkles")
        }
        .foregroundColor(.white)
        .padding()
        .background(.white.opacity(0.08))
        .cornerRadius(14)
      }
      .padding(28)
    }
  }
}
`;
}

function generateCreatorPack(payload = {}) {
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const name = payload.package_name || payload.client_name || "OpenClaw Creator Pack";
  const slug = slugify(name);
  const outputRoot = payload.output_dir || path.join(__dirname, "..", "artifacts", "openclaw-creator-pack");
  const outDir = path.join(outputRoot, `${stamp}-${slug}`);
  const pricing = priceForComplexity(payload.complexity || "standard");

  ensureDir(outDir);
  ensureDir(path.join(outDir, "agents"));
  ensureDir(path.join(outDir, "templates"));
  ensureDir(path.join(outDir, "handoff"));
  ensureDir(path.join(outDir, "scripts"));
  ensureDir(path.join(outDir, "macos-app"));

  const outcome = payload.outcome || "Set up OpenClaw on macOS, connect Telegram, and run creator workflows in one session.";

  writeFile(path.join(outDir, "README.md"), `# ${name}\n\n## Outcome\n${outcome}\n\n## What's included\n- YouTube Research Agent\n- TikTok Idea Generator\n- Comment Analyzer\n- Content Repurposing Workflow\n- Installation checklist\n- Configuration templates\n- Onboarding video script\n- Handoff documentation\n\n## Pricing suggestion\n- Tier: **${pricing.tier}**\n- Suggested price: **$${pricing.usd}**\n- Range envelope: **$500 - $1500**\n`);

  writeFile(path.join(outDir, "INSTALLATION_CHECKLIST.md"), `# Installation Checklist\n\n1. Install Homebrew, Node.js, Python, Ollama\n2. Clone OpenClaw repo and run install\n3. Create local .env from template\n4. Add Telegram bot token + allowed chat IDs\n5. Start OpenClaw service\n6. Run first health check\n7. Trigger each creator workflow once\n8. Save backup and handoff package\n`);

  writeFile(path.join(outDir, "templates", "creator.env.template"), `OPENCLAW_PORT=3333\nOPENCLAW_MODEL_PROVIDER=ollama\nOLLAMA_HOST=http://127.0.0.1:11434\nOLLAMA_MODEL_FAST=llama3.2:3b\nTELEGRAM_BOT_TOKEN=\nTELEGRAM_ALLOWED_CHAT_IDS=\nYOUTUBE_API_KEY=\nTIKTOK_INPUT_SOURCES=\nCONTENT_TOPIC=\nBRAND_TONE=direct,helpful,creator-first\n`);

  writeFile(path.join(outDir, "agents", "youtube-research-agent.md"), `# YouTube Research Agent\n\n## Goal\nCollect top-performing videos for a topic, extract hooks, thumbnail styles, and retention patterns.\n\n## Input\n- topic\n- niche\n- target audience\n\n## Output\n- 10 video breakdowns\n- recurring hook patterns\n- 5 actionable content angles\n`);

  writeFile(path.join(outDir, "agents", "tiktok-idea-generator.md"), `# TikTok Idea Generator\n\n## Goal\nGenerate short-form video ideas with strong first-3-second hooks.\n\n## Output format\n- Hook\n- Shot list (3-5 scenes)\n- CTA\n- Caption draft\n`);

  writeFile(path.join(outDir, "agents", "comment-analyzer.md"), `# Comment Analyzer\n\n## Goal\nParse comments into FAQ clusters, objections, and buying signals.\n\n## Output\n- FAQ list\n- objection handling snippets\n- feature requests to backlog\n`);

  writeFile(path.join(outDir, "agents", "content-repurposing-workflow.md"), `# Content Repurposing Workflow\n\n## Goal\nTransform one long-form source into multi-channel assets.\n\n## Pipeline\n1. Source summary\n2. YouTube short script\n3. TikTok script\n4. X post thread\n5. Newsletter paragraph\n`);

  writeFile(path.join(outDir, "ONBOARDING_VIDEO_SCRIPT.md"), `# Onboarding Video Script (8-10 min)\n\n1. Promise outcome in 20 seconds\n2. Show before/after workflow\n3. Install steps on macOS\n4. Telegram connection demo\n5. Run all 4 creator workflows\n6. Troubleshooting section\n7. Next-step CTA (book setup call / buy replay)\n`);

  writeFile(path.join(outDir, "handoff", "HANDOFF_DOCUMENTATION.md"), `# Handoff Documentation\n\n## Delivered assets\n- Config template\n- Workflow definitions\n- Installer script\n- Dashboard entry URL\n\n## Operator runbook\n- Start command\n- Health command\n- Restart command\n- Backup command\n\n## Escalation\n- Common failure patterns\n- Safe rollback\n`);

  writeFile(path.join(outDir, "scripts", "install-openclaw-macos.sh"), macInstallerScript());
  fs.chmodSync(path.join(outDir, "scripts", "install-openclaw-macos.sh"), 0o755);

  writeFile(path.join(outDir, "macos-app", "OpenClawSetupApp.swift"), swiftAppTemplate());

  writeFile(path.join(outDir, "landing-page-offer.md"), `# Done-for-You OpenClaw Creator Setup\n\n## Offer\nWe set up OpenClaw on your Mac, connect Telegram, and install 4 creator workflows so you can ship content faster with less manual work.\n\n## Pricing\n- Simple setup: $500\n- Standard setup: $900\n- Premium setup + custom automations: $1500\n\n## Core value\n- Save 5-10+ hours/week\n- Remove setup friction\n- Increase output consistency\n`);

  const manifest = {
    generated_at: now.toISOString(),
    package_name: name,
    complexity: pricing.tier,
    suggested_price_usd: pricing.usd,
    path: outDir,
    files: fs.readdirSync(outDir),
  };
  writeFile(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  return {
    ok: true,
    package_dir: outDir,
    suggested_pricing: {
      selected: pricing,
      range_usd: [500, 1500],
    },
    outcome,
    model_used: "deterministic-generator",
    cost_usd: 0,
  };
}

register("openclaw_creator_pack_generate", async (payload = {}) => {
  return generateCreatorPack(payload);
});

module.exports = { generateCreatorPack };
