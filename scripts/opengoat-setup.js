#!/usr/bin/env node
"use strict";

/**
 * opengoat-setup.js
 *
 * One-time (idempotent) script to initialize the OpenGoat hierarchical agent
 * organization for OpenClaw. Run this once after installing opengoat globally.
 *
 * Organization structure:
 *
 *   CEO (Claude / OpenClaw)
 *   ├── CTO          — technical strategy, architecture, code quality
 *   │   ├── Engineer — implementation, bug fixes, feature dev (Claude Code)
 *   │   ├── Reviewer — code review, Greptile integration (Claude Code)
 *   │   └── DevOps   — infrastructure, PM2, deployments (Claude Code)
 *   ├── CMO          — marketing, content, growth strategy
 *   │   ├── Writer   — content creation, copywriting (Claude Code)
 *   │   └── Growth   — lead gen, email, analytics (Claude Code)
 *   ├── CFO          — financial oversight, QuantFusion, P&L
 *   │   └── Analyst  — financial modeling, reporting (Claude Code)
 *   ├── CPO          — product strategy, roadmap, UX
 *   │   └── Designer — UI/UX, product specs (Cursor)
 *   └── CSO          — security, privacy, compliance
 *       └── SecEng   — security council execution, hardening (Claude Code)
 *
 * Install first:
 *   npm install -g opengoat
 *
 * Usage:
 *   node scripts/opengoat-setup.js
 *   node scripts/opengoat-setup.js --dry-run
 */

const { execSync, spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const ORG_DIR = path.join(ROOT, "org");
const DRY_RUN = process.argv.includes("--dry-run");

function run(cmd, label) {
  if (DRY_RUN) {
    console.log(`[dry-run] ${label}: ${cmd}`);
    return { ok: true, output: "(dry-run)" };
  }
  const r = spawnSync("bash", ["-lc", cmd], {
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" },
  });
  const output = String(r.stdout || "") + String(r.stderr || "");
  if (r.status !== 0 && !output.includes("already exists")) {
    console.warn(`  ⚠️  ${label}: exit ${r.status} — ${output.trim().slice(0, 200)}`);
    return { ok: false, output };
  }
  console.log(`  ✅ ${label}`);
  return { ok: true, output };
}

// Check opengoat is installed
function checkOpengoat() {
  try {
    execSync("opengoat --version 2>/dev/null || opengoat version 2>/dev/null", { encoding: "utf8", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

// ─── Org chart definition ──────────────────────────────────────────────────────

const ORG = [
  // Executives
  { name: "CEO",      role: "chief-executive",        type: "manager",    reportsTo: null,  runtime: "claude-code", skill: "strategy,delegation,prioritization" },
  { name: "CTO",      role: "chief-technology",       type: "manager",    reportsTo: "ceo", runtime: "claude-code", skill: "architecture,engineering,code-quality" },
  { name: "CMO",      role: "chief-marketing",        type: "manager",    reportsTo: "ceo", runtime: "claude-code", skill: "marketing,content,growth,brand" },
  { name: "CFO",      role: "chief-financial",        type: "manager",    reportsTo: "ceo", runtime: "claude-code", skill: "finance,accounting,revenue,modeling" },
  { name: "CPO",      role: "chief-product",          type: "manager",    reportsTo: "ceo", runtime: "claude-code", skill: "product,roadmap,ux,strategy" },
  { name: "CSO",      role: "chief-security",         type: "manager",    reportsTo: "ceo", runtime: "claude-code", skill: "security,privacy,compliance,risk" },

  // Engineering ICs (report to CTO)
  { name: "Engineer", role: "software-engineer",      type: "individual", reportsTo: "cto", runtime: "claude-code", skill: "coding,debugging,nodejs,typescript,postgres" },
  { name: "Reviewer", role: "code-reviewer",          type: "individual", reportsTo: "cto", runtime: "claude-code", skill: "code-review,greptile,patterns,quality-gates" },
  { name: "DevOps",   role: "devops-engineer",        type: "individual", reportsTo: "cto", runtime: "claude-code", skill: "pm2,deployments,infrastructure,redis,queues" },

  // Marketing ICs (report to CMO)
  { name: "Writer",   role: "content-writer",         type: "individual", reportsTo: "cmo", runtime: "claude-code", skill: "writing,copywriting,seo,brand-voice" },
  { name: "Growth",   role: "growth-specialist",      type: "individual", reportsTo: "cmo", runtime: "claude-code", skill: "lead-gen,email,analytics,conversion" },

  // Finance IC (reports to CFO)
  { name: "Analyst",  role: "financial-analyst",      type: "individual", reportsTo: "cfo", runtime: "claude-code", skill: "financial-modeling,reporting,quantfusion,trading" },

  // Product IC (reports to CPO)
  { name: "Designer", role: "product-designer",       type: "individual", reportsTo: "cpo", runtime: "cursor",      skill: "ui-ux,design-systems,product-specs,figma" },

  // Security IC (reports to CSO)
  { name: "SecEng",   role: "security-engineer",      type: "individual", reportsTo: "cso", runtime: "claude-code", skill: "security-council,hardening,pen-testing,audit" },
];

// ─── Org file sync ─────────────────────────────────────────────────────────────

function syncOrgFiles() {
  console.log("\n📄 Syncing organizational files...");
  // AGENT_PRINCIPLES.md is included so every agent runtime (Claude Code, Cursor, Codex)
  // can read the shared behavioral contract on startup.
  const orgFiles = ["MISSION.md", "VISION.md", "STRATEGY.md", "KPIs.md", "ROADMAP.md", "AGENT_PRINCIPLES.md"];
  for (const file of orgFiles) {
    const src = path.join(ORG_DIR, file);
    if (!fs.existsSync(src)) {
      console.warn(`  ⚠️  ${file} not found at ${src}`);
      continue;
    }
    // Copy to opengoat org directory if it exists
    const dest1 = path.join(process.env.HOME || "/Users/tatsheen", ".opengoat", "org", file);
    const dest2 = path.join(ROOT, file); // also keep at repo root for agent access
    try {
      fs.mkdirSync(path.dirname(dest1), { recursive: true });
      fs.copyFileSync(src, dest1);
      fs.copyFileSync(src, dest2);
      console.log(`  ✅ ${file} → ${path.relative(ROOT, dest2)}`);
    } catch (err) {
      console.warn(`  ⚠️  ${file}: ${err.message}`);
    }
  }
}

// ─── Main setup ───────────────────────────────────────────────────────────────

async function main() {
  console.log("🐐 OpenGoat Organization Setup\n");

  if (!checkOpengoat()) {
    console.error("❌ opengoat is not installed. Run:\n  npm install -g opengoat\n  # then re-run this script");
    process.exit(1);
  }

  // 1. Create agents
  console.log("👥 Creating agents...");
  for (const agent of ORG) {
    const nameLower = agent.name.toLowerCase();
    const cmd = agent.reportsTo === null
      ? `opengoat agent create "${agent.name}" --role "${agent.role}" --manager --runtime "${agent.runtime}" --skill "${agent.skill}" 2>&1 || echo "may already exist"`
      : `opengoat agent create "${agent.name}" --role "${agent.role}" ${agent.type === "manager" ? "--manager" : "--individual"} --reports-to ${agent.reportsTo} --runtime "${agent.runtime}" --skill "${agent.skill}" 2>&1 || echo "may already exist"`;
    run(cmd, `create ${agent.name} (${agent.role}) → reports to ${agent.reportsTo || "none"}`);
  }

  // 2. Set CEO as default (top-level entry point)
  console.log("\n⚙️  Setting CEO as default agent...");
  run(`opengoat agent set-default ceo 2>&1 || true`, "set-default ceo");

  // 3. Sync org files to opengoat and repo root
  syncOrgFiles();

  // 4. Initialize first task: orient all agents on org structure
  console.log("\n📋 Creating onboarding task...");
  run(
    `opengoat task create \
      --title "Read org docs and update agent memory" \
      --description "MANDATORY ONBOARDING: (1) Read AGENT_PRINCIPLES.md — this is your behavioral contract. Internalize Section 1 (Resourcefulness Over Refusal) and Section 2 (Browser Automation as Universal Fallback). These apply to everything you do. (2) Read MISSION.md, VISION.md, STRATEGY.md, KPIs.md, and ROADMAP.md in the org/ directory. (3) Update your own SOUL.md and MEMORY.md with relevant context. (4) Identify the top 3 things you should be working on based on your role and the current ROADMAP." \
      --owner ceo \
      --assign cto,cmo,cfo,cpo,cso 2>&1 || true`,
    "create onboarding task"
  );

  // 5. Summary
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ OpenGoat organization initialized

${ORG.length} agents created across ${ORG.filter((a) => a.type === "manager").length} manager levels.

Org chart:
  CEO
  ├── CTO → Engineer, Reviewer, DevOps
  ├── CMO → Writer, Growth
  ├── CFO → Analyst
  ├── CPO → Designer (Cursor)
  └── CSO → SecEng

Org files synced:
  org/MISSION.md, VISION.md, STRATEGY.md, KPIs.md, ROADMAP.md
  AGENT_PRINCIPLES.md (behavioral contract — all agents read this)

Next steps:
  1. opengoat org                    # view the org chart in dashboard
  2. opengoat agent goat --agent ceo # start a CEO planning session
  3. pm2 reload ecosystem.background.config.js --update-env
     # starts claw-opengoat-pulse for nightly org doc evolution
  4. Set GREPTILE_API_KEY + GITHUB_TOKEN and run:
     node scripts/greptile-code-review.js --index
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

main().catch((err) => {
  console.error("[opengoat-setup] fatal:", err.message);
  process.exit(1);
});
