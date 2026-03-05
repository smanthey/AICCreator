// agents/report-agent.js
// Generates a human-readable summary of a completed plan.

const pg = require("../infra/postgres");
const { register } = require("./registry");

register("report", async (payload) => {
  const planId = payload?.plan_id;
  if (!planId) throw new Error("report payload must include { plan_id }");

  const { rows: tasks } = await pg.query(
    `SELECT type, title, status, duration_ms, cost_usd, last_error, result
     FROM tasks WHERE plan_id = $1 ORDER BY sequence`,
    [planId]
  );

  const { rows: plans } = await pg.query(
    `SELECT goal, status, actual_cost_usd, created_at, completed_at
     FROM plans WHERE id = $1`,
    [planId]
  );

  const plan = plans[0];
  if (!plan) throw new Error(`Plan not found: ${planId}`);

  const completed  = tasks.filter(t => t.status === "COMPLETED").length;
  const failed     = tasks.filter(t => t.status === "DEAD_LETTER").length;
  const skipped    = tasks.filter(t => t.status === "SKIPPED").length;
  const totalCost  = tasks.reduce((s, t) => s + Number(t.cost_usd || 0), 0);
  const totalMs    = tasks.reduce((s, t) => s + Number(t.duration_ms || 0), 0);

  const lines = [
    `📋 Plan Report`,
    `Goal: ${plan.goal}`,
    `Status: ${plan.status}`,
    `Tasks: ${completed} completed, ${failed} failed, ${skipped} skipped of ${tasks.length} total`,
    `Cost: $${totalCost.toFixed(4)} | Duration: ${(totalMs / 1000).toFixed(1)}s`,
    ``,
    ...tasks.map(t => {
      const icon = { COMPLETED: "✓", DEAD_LETTER: "☠", SKIPPED: "⊘", RUNNING: "▶" }[t.status] || "○";
      return `${icon} [${t.type}] ${t.title || t.type} — ${t.status}${t.last_error ? ` (${t.last_error})` : ""}`;
    })
  ];

  const summary = lines.join("\n");
  console.log("[report]\n" + summary);

  return {
    summary,
    plan_id: planId,
    task_count: tasks.length,
    completed,
    failed,
    skipped,
    total_cost_usd: totalCost,
    cost_usd: 0,
    model_used: "local-reporter"
  };
});
