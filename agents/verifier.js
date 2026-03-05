// agents/verifier.js
// Plan Verifier — runs BEFORE a plan is inserted and dispatched.
// Uses Claude Haiku to catch:
//   - Vague or unactionable goals
//   - Payload schema mismatches
//   - Implausibly cheap/expensive cost estimates
//   - Dangerous tier misclassifications (e.g. email marked Tier 1)
//   - Hallucinated task types
//
// Throws on hard failures (blocks dispatch).
// Returns warnings array for soft issues (logged, not blocking).

"use strict";

require("dotenv").config();
const { chatJson } = require("../infra/model-router");
const { isKnownTaskType } = require("../control/task-capabilities");
// route "_default": sub_haiku → gemini_flash → deepseek_chat → api_haiku

const MAX_TOKENS = 1024;

// ── Required fields per type (structural validation only) ────
const REQUIRED_FIELDS = {
  fetch_content:     ["brand_slug", "platform", "handle"],
  analyze_content:   ["brand_slug"],
  aicreator:         ["brand_slug", "objective"],
  copy_research_pack:["brand_slug", "channel", "topic"],
  copy_critique:     ["brand_slug", "channel", "draft_text"],
  copy_improve:      ["brand_slug", "channel", "draft_text", "critique"],
  copy_lab_run:      ["brand_slug", "channel", "topic"],
  website_content_generator: ["brand_slug", "market", "objective", "industry", "page_type"],
  social_media_copywriter: ["brand_slug", "platform", "topic"],
  fetch_leads:       ["brand_slug", "category", "location"],
  send_email:        ["brand_slug", "lead_id", "template"],
  github_sync:       [],               // all:true OR repo_ids/repo/repos
  github_add_repo:   ["repo_url"],
  github_observability_scan: [],
  research_sync:     [],
  research_signals:  [],
  platform_health_report: [],
  subscription_audit_run: [],
  tax_prep_automation_run: [],
  affiliate_research: [],
  openclaw_creator_pack_generate: [],
  security_secrets_scan: [],
  security_deps_audit:   [],
  security_runtime_audit: [],
  security_sweep: [],
  dev_pipeline_run: ["task"],
  triage:            [],               // task_id OR error
  patch:             ["triage_task_id"],
  qa_run:            ["url"],
  qa_spec:           [],
  migrate:           [],
  classify:          [],
  dedupe:            [],
  media_detect:      [],
  media_enrich:      [],
  media_hash:        [],
  media_visual_catalog: [],
  cluster_media:     [],
  resourceful_file_resolve: [],
  orchestrate:       ["goal"],
};

// ── Platform enum for fetch_content ─────────────────────────
const VALID_PLATFORMS = new Set(["youtube", "tiktok", "instagram"]);

// ── Dangerous tier floors: task type → minimum acceptable tier ─
const TIER_FLOORS = {
  send_email:   3,  // always Tier 3 — external comms at scale
  patch:        3,  // code changes
  fetch_leads:  2,  // external API with spend
  qa_run:       2,  // hitting production URLs
  migrate:      2,  // moving real files
  subscription_audit_run: 2, // external financial/email APIs
  tax_prep_automation_run: 2, // external financial/email APIs + tax outputs
};

// ── Vague goal markers — triggers LLM check if too ambiguous ─
const VAGUE_PATTERNS = [
  /^(do|make|run|execute|help|fix|update|improve|optimize|setup|start|create)\s*it\b/i,
  /^(something|anything|everything|stuff|things)\b/i,
];

const SYSTEM_PROMPT = `You are a plan verifier for an autonomous task orchestration system.
You receive a proposed plan (goal + task list) and check it for issues.

Return ONLY valid JSON:
{
  "approved": true | false,
  "hard_errors": ["..."],
  "warnings": ["..."],
  "goal_clarity": "clear" | "vague" | "ambiguous",
  "goal_refinement": "Suggested clearer goal phrasing, or null if already clear",
  "risk_assessment": "one sentence on the biggest risk in this plan"
}

Hard errors block execution. Warnings are logged only.

Check for:
1. Vague or impossible goals (approved=false if truly unactionable)
2. Tasks with clearly wrong payloads for their type
3. Tier misclassification — send_email must be Tier 3, patch must be Tier 3
4. Implausible cost estimates (e.g., 100 emails priced at $0.001 total)
5. Plans that mix destructive tasks without a rollback plan
6. email goals that try to send to "United States" — must be city-level

Be concise. Do not invent new task types or suggest changes beyond what the user asked.`;

/**
 * Verify a plan object BEFORE it is inserted into the DB.
 *
 * @param {object} plan  — output of planner.plan()
 * @returns {{ approved: boolean, warnings: string[], goal_refinement: string|null }}
 * @throws  if a hard structural or safety error is found
 */
async function verifyPlan(plan) {
  const hardErrors = [];
  const warnings   = [];

  // ── 1. Structural pre-checks (fast, no LLM) ──────────────

  // Unknown task types
  for (const task of plan.tasks || []) {
    if (!isKnownTaskType(task.type)) {
      hardErrors.push(`Unknown task type "${task.type}" in task "${task.title}"`);
    }
  }

  // Missing required payload fields
  for (const task of plan.tasks || []) {
    const required = REQUIRED_FIELDS[task.type] || [];
    for (const field of required) {
      if (task.payload?.[field] == null || task.payload[field] === "") {
        hardErrors.push(
          `Task "${task.title}" (${task.type}) missing required payload field: ${field}`
        );
      }
    }

    // fetch_content: platform must be valid enum value
    if (task.type === "fetch_content" && task.payload?.platform) {
      if (!VALID_PLATFORMS.has(task.payload.platform)) {
        hardErrors.push(
          `fetch_content task "${task.title}" has invalid platform "${task.payload.platform}". ` +
          `Must be: youtube | tiktok | instagram`
        );
      }
    }

    // fetch_leads: reject country-level location
    if (task.type === "fetch_leads" && task.payload?.location) {
      const loc = String(task.payload.location).toLowerCase();
      if (loc === "united states" || loc === "usa" || loc === "us") {
        hardErrors.push(
          `fetch_leads "${task.title}" uses location "${task.payload.location}". ` +
          `Must be a specific city (e.g. "Austin, TX") not a whole country.`
        );
      }
    }

    // send_email: lead_id must look like a UUID
    if (task.type === "send_email" && task.payload?.lead_id) {
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRe.test(task.payload.lead_id)) {
        hardErrors.push(
          `send_email "${task.title}" has non-UUID lead_id "${task.payload.lead_id}". ` +
          `lead_id must be a real UUID from the leads table.`
        );
      }
    }

    // github_sync: needs all:true or repo_ids/repo/repos
    if (task.type === "github_sync") {
      const hasRepoIds = Array.isArray(task.payload?.repo_ids) && task.payload.repo_ids.length > 0;
      const hasRepo = typeof task.payload?.repo === "string" && task.payload.repo.trim().length > 0;
      const hasRepos = Array.isArray(task.payload?.repos) && task.payload.repos.length > 0;
      if (!task.payload?.all && !hasRepoIds && !hasRepo && !hasRepos) {
        hardErrors.push(
          `github_sync "${task.title}" needs either { all: true } or repo filters ({ repo_ids: [...] } | { repo: "local/name" } | { repos: [...] })`
        );
      }
    }
  }

  // Tier floor enforcement
  const tier = plan.intent_tier ?? 2;
  for (const task of plan.tasks || []) {
    const floor = TIER_FLOORS[task.type];
    if (floor != null && tier < floor) {
      hardErrors.push(
        `Plan tier is ${tier} but task "${task.title}" (${task.type}) requires minimum Tier ${floor}. ` +
        `The planner downgraded the tier — this is a guardrail violation.`
      );
    }
  }

  // send_email plans must require approval
  const hasSendEmail = (plan.tasks || []).some(t => t.type === "send_email");
  if (hasSendEmail && !plan.approval_required) {
    hardErrors.push(
      "Plan contains send_email tasks but approval_required=false. Emails require Tier 3 approval."
    );
  }

  // Short-circuit: don't waste LLM tokens if structural errors found
  if (hardErrors.length > 0) {
    throw new Error(
      `Plan verification failed:\n${hardErrors.map(e => `  • ${e}`).join("\n")}`
    );
  }

  // ── 2. Vague goal check (lightweight LLM call) ───────────
  const looksVague = VAGUE_PATTERNS.some(p => p.test(plan.goal?.trim() || ""));
  const tooShort   = (plan.goal?.trim().length || 0) < 15;

  let goalRefinement = null;
  let goalClarity    = "clear";
  let riskAssessment = "";

  if (looksVague || tooShort || plan.tasks.length > 5) {
    // Only call LLM when there's something worth checking
    try {
      const summary = {
        goal:           plan.goal,
        intent_tier:    plan.intent_tier,
        task_types:     plan.tasks.map(t => t.type),
        estimated_cost: plan.estimated_cost_usd,
        approval_required: plan.approval_required,
      };

      const llmResult = await chatJson("_default", SYSTEM_PROMPT,
        JSON.stringify(summary, null, 2), { max_tokens: MAX_TOKENS });
      const result = llmResult.json;

      goalClarity    = result.goal_clarity    || "clear";
      goalRefinement = result.goal_refinement || null;
      riskAssessment = result.risk_assessment || "";

      if (result.hard_errors?.length) {
        throw new Error(
          `Plan verification (LLM) found hard errors:\n` +
          result.hard_errors.map(e => `  • ${e}`).join("\n")
        );
      }

      if (result.warnings?.length) {
        warnings.push(...result.warnings);
      }

      if (!result.approved) {
        throw new Error(
          `Plan rejected by verifier: goal is "${goalClarity}" — ` +
          (goalRefinement ? `try: "${goalRefinement}"` : "please be more specific")
        );
      }

      console.log(`[verifier] ✓ goal="${goalClarity}" risk="${riskAssessment}" cost=$${(llmResult.cost_usd||0).toFixed(5)} model=${llmResult.model_id}`);
    } catch (err) {
      if (err.message.includes("verifier") || err.message.includes("verification")) throw err;
      // LLM failure is non-blocking (soft-fail) — log and continue
      warnings.push(`Verifier LLM call failed: ${err.message} — proceeding without LLM check`);
      console.warn("[verifier] LLM soft-fail:", err.message);
    }
  }

  if (warnings.length > 0) {
    console.warn("[verifier] Warnings:", warnings);
  }

  return { approved: true, warnings, goal_clarity: goalClarity, goal_refinement: goalRefinement };
}

module.exports = { verifyPlan };
