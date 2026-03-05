// agents/orchestrator.js
// The top-level orchestrator for ClawdBot.
//
// ROLE
// ────
// Sits above the planner. When a goal is too complex, ambiguous, or multi-domain
// to be handled by a single plan(), the orchestrator:
//   1. Loads soul context (SOUL.md, USER.md, INDUSTRY.md, TOOLS.md)
//   2. Applies the Figure It Out (FIO) directive to decompose the goal
//   3. Routes sub-tasks to the correct agents via BullMQ
//   4. Synthesizes results and returns a structured summary
//
// FIO DIRECTIVE (Figure It Out)
// ──────────────────────────────
// Before explaining why something can't be done, the orchestrator:
//   - Reasons through the problem (ReAct: Reason → Act → Observe)
//   - Tries at least 2 approaches
//   - Returns what it accomplished + what blocked it (never silent failure)
//
// TASK TYPE REGISTERED: "orchestrate"
// QUEUE: claw_tasks (concurrency=1, uses Opus for full context)
//
// Payload:
//   { goal: "string", context?: {}, priority?: 1-5, dry_run?: true }

"use strict";

const fs      = require("fs");
const path    = require("path");
const { v4: uuid } = require("uuid");

const { chatJson }   = require("../infra/model-router");
const { plan }       = require("./planner");
const { insertPlanFromOrchestrator } = require("../control/inserter");
const pg             = require("../infra/postgres");
const { register }   = require("./registry");
const { loadAgentPrelude, appendAgentDailyLog } = require("../control/agent-memory");

// ── Load soul context files ───────────────────────────────────
const CONTEXT_DIR = path.join(__dirname, "../context");

function loadContext(...files) {
  return files.map(f => {
    try {
      const fpath = path.join(CONTEXT_DIR, f);
      return `\n---\n${fs.readFileSync(fpath, "utf8")}`;
    } catch (_) {
      return `\n--- [${f} not found] ---`;
    }
  }).join("\n");
}

// Full orchestrator context: identity + user + capabilities + industry
const SOUL_CONTEXT = loadContext("SOUL.md", "USER.md", "TOOLS.md", "INDUSTRY.md");

// ── Orchestrator system prompt ────────────────────────────────
const ORCHESTRATOR_SYSTEM = `You are the ClawdBot Orchestrator — the top-level strategic layer.

You embody the Figure It Out (FIO) directive: your first move is always to attempt, not to explain why something is hard.

## Your Job
Given a high-level goal, you must:
1. REASON: Analyze the goal — what domains does it touch? What sub-tasks are needed?
2. DECOMPOSE: Break it into sequential or parallel sub-goals, each handled by a specialist
3. ROUTE: For each sub-goal, determine the correct task type and minimal payload
4. SYNTHESIZE: Once sub-tasks complete, combine results into a coherent outcome

## ReAct Loop
Think step-by-step before producing output:
- SITUATION: What is actually being asked?
- APPROACH: What are 2-3 ways to accomplish this?
- RISKS: What could go wrong with each approach?
- CHOICE: Which approach and why?
- PLAN: Concrete sub-task decomposition

## Output Format
Respond with ONLY valid JSON:
{
  "reasoning": "step-by-step thought process",
  "approach": "chosen approach and why",
  "goal_decomposed": "restatement of the goal as concrete outcomes",
  "sub_goals": [
    {
      "id": "sg1",
      "description": "what this sub-goal accomplishes",
      "task_type": "exact task type string",
      "payload": {},
      "depends_on": [],
      "parallel_ok": true|false,
      "model_tier": 0|1|2|3|4,
      "rationale": "why this task type and model tier"
    }
  ],
  "synthesis_instructions": "how to combine results into final output",
  "estimated_cost_usd": 0.0,
  "fio_notes": "what to try if sub-tasks fail — specific fallback approaches"
}

${SOUL_CONTEXT}`;

// ── Store orchestration record ────────────────────────────────
async function storeOrchestration(rec) {
  try {
    const res = await pg.query(
      `INSERT INTO orchestrations
         (id, goal, reasoning, sub_goals, status, cost_usd, model_used, plan_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id`,
      [rec.id, rec.goal, rec.reasoning, JSON.stringify(rec.sub_goals),
       rec.status, rec.cost_usd, rec.model_used, rec.plan_id || null]
    );
    return res.rows[0]?.id;
  } catch (e) {
    console.warn(`[orchestrator] DB store failed: ${e.message}`);
    return rec.id;
  }
}

async function updateOrchestration(id, updates) {
  try {
    const sets  = Object.keys(updates).map((k, i) => `${k} = $${i+2}`).join(", ");
    const vals  = Object.values(updates);
    await pg.query(`UPDATE orchestrations SET ${sets}, updated_at=now() WHERE id=$1`, [id, ...vals]);
  } catch (_) {}
}

// ── Build one merged plan from sub_goals (parallel roots) ───────
// Inserts a single plan so all independent sub-goals become CREATED at once.
async function dispatchMergedPlan(subGoals, goal, planId, dryRun, meta) {
  if (dryRun) {
    return {
      plan_id: planId,
      status: "dry_run",
      tasks: subGoals.length,
      dispatch_results: subGoals.map(sg => ({ sub_goal_id: sg.id, status: "dry_run", task_type: sg.task_type })),
    };
  }

  const tasks = subGoals.map((sg) => ({
    temp_id: sg.id,
    type: sg.task_type,
    payload: sg.payload || {},
    depends_on_temp_ids: sg.depends_on || [],
    title: sg.description || sg.id,
    priority: 3,
  }));

  // Synthesis task: report after all sub-goals complete
  tasks.push({
    temp_id: "synthesis",
    type: "report",
    payload: { plan_id: planId },
    depends_on_temp_ids: subGoals.map((sg) => sg.id),
    title: "Synthesis report",
    priority: 3,
  });

  const plan = {
    plan_id: planId,
    goal,
    tasks,
    estimated_cost_usd: meta?.estimated_cost_usd,
    model_used: meta?.model_used,
    intent_tier: 2,
    intent_categories: [],
    rollback_plan: null,
    machines_involved: [],
    resource_estimates: {},
  };

  const { planId: insertedPlanId, taskIds } = await insertPlanFromOrchestrator(plan);

  const dispatchResults = subGoals.map((sg) => ({
    sub_goal_id: sg.id,
    status: "dispatched",
    plan_id: insertedPlanId,
    tasks: 1,
  }));

  return {
    plan_id: insertedPlanId,
    status: "dispatched",
    tasks: tasks.length,
    taskIds,
    dispatch_results: dispatchResults,
  };
}

// ── FIO fallback: if LLM decomposition fails, try direct plan() ─
async function fioFallback(goal, context) {
  console.log("[orchestrator] 🔄 FIO fallback: attempting direct plan()");
  try {
    const taskPlan = await plan(goal, context);
    return {
      fallback: true,
      plan_id:  taskPlan.plan_id,
      tasks:    taskPlan.tasks?.length || 0,
      message:  "Orchestrator LLM failed; fell back to direct planner",
    };
  } catch (err) {
    throw new Error(`FIO fallback also failed: ${err.message}`);
  }
}

// ── Main orchestrate handler ──────────────────────────────────
register("orchestrate", async (payload) => {
  const {
    goal,
    context    = {},
    priority   = 3,
    dry_run    = false,
    plan_id:   parentPlanId,
    task_id:   parentTaskId,
  } = payload;

  if (!goal || typeof goal !== "string" || !goal.trim()) {
    throw new Error("orchestrate requires a non-empty goal string");
  }

  const orchId = uuid();
  console.log(`[orchestrator] 🎯 Goal: "${goal}" (${dry_run ? "DRY RUN" : "live"})`);
  const memoryPrelude = await loadAgentPrelude("orchestrator", {
    handoffs: ["DAILY-INTEL.md", "DAILY-ASSIGNMENT.md", "DAILY-DRAFTS.md"],
    maxChars: 12000,
  });
  const orchestratorSystem = [memoryPrelude.text, ORCHESTRATOR_SYSTEM].filter(Boolean).join("\n\n");

  // ── Step 1: LLM decomposition with FIO directive + full context ─
  const userMsg = `Goal: ${goal}${context && Object.keys(context).length
    ? `\n\nAdditional context:\n${JSON.stringify(context, null, 2)}`
    : ""}`;

  let decomp, llmResult;
  try {
    llmResult = await chatJson("orchestrate", orchestratorSystem, userMsg, {
      task_id:  parentTaskId,
      plan_id:  parentPlanId,
      max_tokens: 4096,
    });
    decomp = llmResult.json;
  } catch (err) {
    console.warn(`[orchestrator] LLM decomposition failed: ${err.message}`);
    // FIO: don't give up — fall back to direct planner
    const fallback = await fioFallback(goal, context);
    await appendAgentDailyLog("orchestrator", {
      goal,
      task_type: "orchestrate",
      summary: "LLM decomposition failed; used planner fallback",
      blocker: err.message,
    }).catch(() => {});
    return { orchestration_id: orchId, goal, status: "fallback", ...fallback };
  }

  // ── Step 2: Validate decomposition ───────────────────────────
  if (!Array.isArray(decomp?.sub_goals) || decomp.sub_goals.length === 0) {
    console.warn("[orchestrator] LLM returned no sub-goals — FIO fallback");
    const fallback = await fioFallback(goal, context);
    await appendAgentDailyLog("orchestrator", {
      goal,
      task_type: "orchestrate",
      summary: "LLM returned no sub-goals; used planner fallback",
      model_used: llmResult?.model_id || llmResult?.model_key || null,
    }).catch(() => {});
    return { orchestration_id: orchId, goal, status: "fallback", ...fallback };
  }

  console.log(`[orchestrator] 📋 Decomposed into ${decomp.sub_goals.length} sub-goals`);
  console.log(`[orchestrator] 💭 Reasoning: ${(decomp.reasoning || "").slice(0, 200)}`);

  // ── Step 3: Store orchestration record ───────────────────────
  await storeOrchestration({
    id:        orchId,
    goal,
    reasoning: decomp.reasoning || "",
    sub_goals: decomp.sub_goals,
    status:    "running",
    cost_usd:  llmResult.cost_usd || 0,
    model_used: llmResult.model_id,
    plan_id:   parentPlanId,
  });

  // ── Step 4: Build one merged plan and insert (parallel roots) ─
  const mergedPlanId = uuid();
  let dispatchResult;
  try {
    dispatchResult = await dispatchMergedPlan(decomp.sub_goals, goal, mergedPlanId, dry_run, {
      estimated_cost_usd: decomp.estimated_cost_usd,
      model_used: llmResult?.model_id,
    });
  } catch (err) {
    await updateOrchestration(orchId, { status: "error", error_message: err.message });
    throw err;
  }

  const dispatchResults = dispatchResult.dispatch_results || [];
  const finalStatus = dry_run ? "dry_run" : (dispatchResult.status === "dispatched" ? "dispatched" : "partial");

  await updateOrchestration(orchId, {
    status: finalStatus,
    plan_id: dispatchResult.plan_id,
    result: JSON.stringify(dispatchResults),
  });

  const totalPlanCost = (llmResult?.cost_usd || 0);
  const planIds = dispatchResult.plan_id ? [dispatchResult.plan_id] : [];

  console.log(`[orchestrator] ✅ ${finalStatus} — ${decomp.sub_goals.length} sub-goals → 1 plan ${dispatchResult.plan_id || ""} (${dispatchResult.tasks || 0} tasks)`);

  await appendAgentDailyLog("orchestrator", {
    goal,
    task_type: "orchestrate",
    summary: `${finalStatus}: ${decomp.sub_goals.length} sub-goals`,
    learned: decomp.synthesis_instructions || "",
    model_used: llmResult?.model_id || llmResult?.model_key || null,
    cost_usd: Number(totalPlanCost || 0),
    open_loops: ["track downstream completion and synthesis report"],
  }).catch(() => {});

  return {
    orchestration_id:   orchId,
    goal,
    status:             finalStatus,
    sub_goals_total:    decomp.sub_goals.length,
    sub_goals_dispatched: dispatchResults.filter(r => r.status === "dispatched").length,
    sub_goals_errors:   0,
    plan_ids:           planIds,
    dispatch_results:   dispatchResults,
    synthesis_instructions: decomp.synthesis_instructions || "",
    fio_notes:          decomp.fio_notes || "",
    cost_usd:           parseFloat(totalPlanCost.toFixed(6)),
    model_used:         llmResult?.model_id || "unknown",
    estimated_total_cost_usd: decomp.estimated_cost_usd || 0,
    dry_run,
  };
});
