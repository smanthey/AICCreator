#!/usr/bin/env node
"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const { v4: uuid } = require("uuid");
const { insertPlan } = require("../control/inserter");

const args = process.argv.slice(2);

function arg(flag, fallback = null) {
  const i = args.indexOf(flag);
  if (i < 0 || i + 1 >= args.length) return fallback;
  return args[i + 1];
}

function has(flag) {
  return args.includes(flag);
}

(async () => {
  try {
    const dryRun = has("--dry-run");
    const daysBack = Math.max(30, Number(arg("--days-back", "180")) || 180);
    const taxYear = Number(arg("--year", String(new Date().getFullYear()))) || new Date().getFullYear();
    const planId = uuid();
    const plan = {
      plan_id: planId,
      goal: "Run finance subscription audit and tax prep automation",
      reasoning: "Queue recurring financial hygiene tasks as a governed plan",
      intent_tier: 2,
      intent_categories: ["WRITE_INTERNAL", "EXTERNAL_FETCH", "COST_EXPOSURE"],
      estimated_cost_usd: 0.25,
      estimated_duration_minutes: 12,
      risk_level: "med",
      approval_required: true,
      rollback_plan: "Mark resulting finance alerts dismissed and remove generated report files if needed.",
      machines_involved: ["m3_max", "nas"],
      resource_estimates: {
        api_calls: 8,
        db_rows_written: 200,
        emails_sent: 0,
        llm_tokens_estimate: 0,
        network_mb: 10,
      },
      tasks: [
        {
          temp_id: "t1",
          type: "subscription_audit_run",
          title: "Run subscription audit",
          payload: { days_back: daysBack, max_email_scan: 160, dry_run: dryRun },
          depends_on_temp_ids: [],
          priority: 3,
          risk_level: "med",
          timeout_seconds: 900,
          max_retries: 2,
          machine_hint: "m3_max",
        },
        {
          temp_id: "t2",
          type: "tax_prep_automation_run",
          title: "Run tax prep automation",
          payload: { year: taxYear, days_back: 365, dry_run: dryRun },
          depends_on_temp_ids: [],
          priority: 3,
          risk_level: "med",
          timeout_seconds: 900,
          max_retries: 2,
          machine_hint: "m3_max",
        },
        {
          temp_id: "t3",
          type: "report",
          title: "Finance automation summary",
          payload: { plan_id: planId },
          depends_on_temp_ids: ["t1", "t2"],
          priority: 2,
          risk_level: "low",
          timeout_seconds: 120,
          max_retries: 1,
          machine_hint: "nas",
        },
      ],
    };

    if (dryRun) {
      console.log(JSON.stringify({
        ok: true,
        queued: 0,
        dry_run: true,
        plan_preview: {
          plan_id: plan.plan_id,
          intent_tier: plan.intent_tier,
          task_types: plan.tasks.map((t) => t.type),
          payloads: plan.tasks.map((t) => ({ type: t.type, payload: t.payload })),
        },
      }, null, 2));
      process.exit(0);
    }

    const inserted = await insertPlan(plan);
    const taskIds = Array.from(inserted.taskIds.values());

    console.log(JSON.stringify({
      ok: true,
      queued: 3,
      plan_id: inserted.planId,
      tasks: [
        { type: "subscription_audit_run", id: taskIds[0] },
        { type: "tax_prep_automation_run", id: taskIds[1] },
        { type: "report", id: taskIds[2] },
      ],
    }, null, 2));
    process.exit(0);
  } catch (err) {
    console.error("[finance-automation-queue] fatal:", err.message || String(err));
    process.exit(1);
  }
})();
