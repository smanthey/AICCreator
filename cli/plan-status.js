#!/usr/bin/env node
// cli/plan-status.js
// Usage:
//   node cli/plan-status.js <plan_id>
//   node cli/plan-status.js --all

const pg = require("../infra/postgres");

const planId = process.argv[2];

if (!planId) {
  console.error("Usage: node cli/plan-status.js <plan_id>");
  console.error("       node cli/plan-status.js --all");
  process.exit(1);
}

const STATUS_ICONS = {
  PENDING:     "○",
  CREATED:     "◉",
  QUEUED:      "◉",
  DISPATCHED:  "◉",
  RUNNING:     "▶",
  COMPLETED:   "✓",
  FAILED:      "✗",
  RETRY:       "↻",
  DEAD_LETTER: "☠",
  SKIPPED:     "⊘",
  VERIFIED:    "✓✓",
  DELIVERED:   "📦",
  CANCELLED:   "—"
};

async function main() {
  try {
    if (planId === "--all") {
      await showAllPlans();
    } else {
      await showPlan(planId);
    }
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }
  process.exit(0);
}

async function showAllPlans() {
  const { rows } = await pg.query(
    `SELECT id, goal, status, total_tasks, completed_tasks, failed_tasks,
            created_at, actual_cost_usd
     FROM plans ORDER BY created_at DESC LIMIT 20`
  );

  if (rows.length === 0) {
    console.log("No plans found.");
    return;
  }

  console.log("\n" + "═".repeat(70));
  console.log("Recent Plans");
  console.log("═".repeat(70));

  for (const p of rows) {
    const icon = p.status === "completed" ? "✓" :
                 p.status === "failed" ? "✗" :
                 p.status === "active" ? "▶" : "—";
    const progress = `${p.completed_tasks || 0}/${p.total_tasks}`;
    const cost = p.actual_cost_usd ? `$${Number(p.actual_cost_usd).toFixed(3)}` : "$0";
    console.log(
      `  ${icon} ${p.id.slice(0, 8)} [${p.status}] ${progress} tasks  ${cost}  "${p.goal.slice(0, 50)}"`
    );
  }
}

async function showPlan(id) {
  // Fetch plan
  const { rows: plans } = await pg.query(
    `SELECT * FROM plans WHERE id = $1`,
    [id]
  );

  if (plans.length === 0) {
    console.error(`Plan not found: ${id}`);
    process.exit(1);
  }

  const plan = plans[0];

  // Fetch tasks
  const { rows: tasks } = await pg.query(
    `SELECT id, type, title, status, depth, sequence, retry_count,
            duration_ms, cost_usd, model_used, last_error,
            dead_lettered_at, dead_letter_reason
     FROM tasks WHERE plan_id = $1
     ORDER BY depth ASC, sequence ASC`,
    [id]
  );

  console.log("\n" + "═".repeat(60));
  console.log(`Plan: ${plan.id}`);
  console.log(`Goal: ${plan.goal}`);
  console.log(`Status: ${plan.status}`);
  console.log(
    `Progress: ${plan.completed_tasks || 0}/${plan.total_tasks} tasks ` +
    `(${plan.failed_tasks || 0} failed)`
  );
  console.log(`Cost: $${Number(plan.actual_cost_usd || 0).toFixed(3)}`);
  console.log("═".repeat(60));

  for (const t of tasks) {
    const icon = STATUS_ICONS[t.status] || "?";
    const duration = t.duration_ms ? `(${t.duration_ms}ms)` : "";
    const cost = t.cost_usd && Number(t.cost_usd) > 0
      ? `$${Number(t.cost_usd).toFixed(3)}` : "";
    const retries = t.retry_count > 0 ? `↻${t.retry_count}` : "";
    const error = t.last_error ? `  ERR: ${t.last_error.slice(0, 60)}` : "";

    console.log(
      `  ${icon} ${t.type}: ${t.title || "untitled"} ${duration} ${cost} ${retries}${error}`
    );
  }
}

main();
