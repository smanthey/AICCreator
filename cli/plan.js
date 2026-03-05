#!/usr/bin/env node
// cli/plan.js
// Usage:
//   node cli/plan.js "analyze captureinbound.com forgot password flow"
//   node cli/plan.js "index and dedupe ~/Documents/projects"
//   node cli/plan.js --dry-run "scan my desktop for duplicates"

const planner = require("../agents/planner");
const inserter = require("../control/inserter");
const readline = require("readline");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const goal = args.filter((a) => a !== "--dry-run").join(" ");

if (!goal) {
  console.error("Usage: node cli/plan.js [--dry-run] <goal>");
  console.error('Example: node cli/plan.js "analyze captureinbound.com forgot password flow"');
  process.exit(1);
}

async function main() {
  try {
    // ─── Step 1: Generate plan ─────────────────────────────
    const plan = await planner.plan(goal);

    // ─── Step 2: Display plan ──────────────────────────────
    console.log("\n" + "═".repeat(60));
    console.log(`Plan: ${plan.plan_id}`);
    console.log(`Goal: ${plan.goal}`);
    console.log(`Risk: ${plan.risk_level}`);
    console.log(`Est. Cost: $${plan.estimated_cost_usd.toFixed(3)}`);
    console.log(`Est. Time: ~${plan.estimated_duration_minutes || "?"} min`);
    console.log(`Tasks: ${plan.tasks.length}`);
    console.log("═".repeat(60));

    for (const t of plan.tasks) {
      const deps = t.depends_on_temp_ids.length > 0
        ? ` (after: ${t.depends_on_temp_ids.join(", ")})`
        : " (no deps)";
      const risk = t.risk_level === "high" ? " ⚠️  HIGH RISK" : "";
      console.log(`  [${t.temp_id}] ${t.type}: ${t.title}${deps}${risk}`);
    }

    console.log("─".repeat(60));
    console.log(`Reasoning: ${plan.reasoning}`);
    console.log("─".repeat(60));

    // ─── Dry run: stop here ────────────────────────────────
    if (dryRun) {
      console.log("\n🏜️  Dry run — plan NOT inserted. Remove --dry-run to execute.");
      process.exit(0);
    }

    // ─── Step 3: Approval gate ─────────────────────────────
    if (plan.approval_required) {
      const approved = await askApproval(
        `\n⚠️  This plan has HIGH RISK tasks. Approve? (y/n): `
      );
      if (!approved) {
        console.log("❌ Plan cancelled.");
        process.exit(0);
      }
    }

    // ─── Step 4: Insert into DB ────────────────────────────
    const { planId, taskIds } = await inserter.insertPlan(plan);

    console.log(`\n✓ Plan inserted: ${planId}`);
    console.log(`  ${taskIds.size} tasks queued.`);
    console.log(`  Track: node cli/plan-status.js ${planId}`);
    console.log(`  Or run dispatcher: node cli/run-dispatcher.js`);

  } catch (err) {
    console.error("Plan failed:", err.message);
    process.exit(1);
  }

  process.exit(0);
}

function askApproval(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.toLowerCase().startsWith("y"));
    });
  });
}

main();
