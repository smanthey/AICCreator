// agents/planner.js
// The brain: takes a natural language goal and decomposes it
// into an ordered DAG of tasks with full governance metadata.

require("dotenv").config();

const fs      = require("fs");
const path    = require("path");
const { v4: uuid } = require("uuid");
const { loadAgentPrelude, appendAgentDailyLog } = require("../control/agent-memory");
const { resolveProfileForTask, compactProfileProjection } = require("../control/agent-focus-profiles");
const { isKnownTaskType } = require("../control/task-capabilities");

// Model routing: subscription-first, falls back to cheap API, then mid/premium
const { chatJson } = require("../infra/model-router");

// Load soul context for planner persona
function loadCtx(file) {
  try { return "\n" + fs.readFileSync(path.join(__dirname, "../context", file), "utf8"); }
  catch (_) { return ""; }
}
const SOUL_PREFIX = loadCtx("SOUL.md") + loadCtx("USER.md");

// ═══════════════════════════════════════════════════════════════
// TASK CATALOG
// ═══════════════════════════════════════════════════════════════

const TASK_CATALOG = `
Available task types:

echo          — Test/smoke test. Echoes payload.
report        — Human-readable plan summary.
index         — Scans filesystem path, extracts file metadata.
classify      — Categorises files by MIME type and category.
dedupe        — Finds duplicate files by SHA-256 hash. Never auto-deletes.
media_enrich  — Extracts deterministic media metadata via exiftool/ffprobe.
media_hash    — Computes deterministic perceptual hashes (dHash/aHash) via ffmpeg.
media_detect  — Detects media candidates and missing deterministic coverage.
media_visual_catalog — Builds visual labels/scene/subject for images using deterministic cues
                       (location + filename + color/brightness) and optional vision model.
cluster_media — Clusters media into shoot groups by time/camera/GPS/hash distance.
migrate       — Copies files to ClawVault with hash verification.
triage        — Claude Haiku LLM diagnosis of error/failure.
judge         — Deterministic pass/fail check on triage output.
patch         — Claude Sonnet code fix. Creates git branch only, never deploys.
qa_run        — Playwright headless browser test runner.
claw_search   — Full-text search over the claw file index DB.
claw_stats    — Summary stats about the indexed file library.
claw_recent   — Recently indexed files.
send_email      — Sends ONE email via Maileroo. Requires { brand_slug, lead_id, template, subject }.
                  Templates: skynpatch_b2b_intro | skynpatch_b2b_followup | plushtrap_collab_intro
                  NOTE: lead must have an email address already in the leads table.
fetch_leads     — Pulls business listings from Google Places API. Requires { brand_slug, category, location, radius_m }.
                  IMPORTANT: 'location' must be a specific city/zip (e.g. "Phoenix, AZ", "90210") not "United States".
                  For nationwide coverage create MULTIPLE tasks with different cities.
fetch_content   — Fetches recent posts from a social media account via YouTube API or Apify scraper.
                  Requires { brand_slug, platform: "youtube"|"tiktok"|"instagram", handle }.
                  Strip the @ from handle. max_results default 15, max 50.
analyze_content — Uses AI analysis to extract hook patterns, pacing, script structure.
                  Requires { brand_slug }. Optional: { platform, limit }.
                  Must be run AFTER fetch_content has stored data for the brand.
generate_copy   — Uses model-router (Qwen-first for copy lane) to generate email copy, social captions, product descriptions.
                  Requires { brand_slug, format: "email"|"caption"|"product_desc", brief }.
aicreator       — AI-assisted rapid content workflow builder. Returns step-by-step creation plan + draft copy.
                  Requires { brand_slug, objective }. Optional { output_format, platform, audience, tone, step_count, brief }.
copy_research_pack — Builds a research-backed copy pack for NotebookLM ingestion + Qwen brief synthesis.
                     Requires { brand_slug, channel, topic }. Optional { sources, target_audience, tone, goal, notebook_context }.
copy_critique   — Critiques copy with conversion rubric and returns scores/issues/fixes.
                  Requires { brand_slug, channel, draft_text }. Optional { draft_id, topic, target_audience, tone, goal }.
copy_improve    — Produces an improved revision from critique notes, optionally persisting next draft variant.
                  Requires { brand_slug, channel, draft_text, critique }. Optional { draft_id, iteration }.
copy_lab_run    — End-to-end loop: research pack -> Qwen draft -> critique -> iterative improve.
                  Requires { brand_slug, channel, topic }. Optional { sources, target_audience, tone, goal, iterations }.
website_content_generator — Market-first website copy system with SEO/AEO + compliance framing.
                  Requires { brand_slug, market, objective, industry, page_type }.
                  Optional { target_audience, tone, reading_level, primary_keyword, secondary_keywords, competitors, compliance_region, notebook_context, sources }.
social_media_copywriter — Channel-ready social copy with conversion hooks + AEO snippets + compliance notes.
                  Requires { brand_slug, platform, topic }.
                  Optional { objective, tone, target_audience, primary_keyword, compliance_mode, variations, website_context }.
content_brief_intake    — Parse and store a new content brief. Requires { brand_slug, channel, topic }.
                          Optional { target_audience, tone, keywords, goal, publish_at, reference_urls }.
                          Creates a content_briefs row and queues content_draft_generate.
content_draft_generate  — LLM draft generation from a brief. Requires { brief_id }.
                          Optional { model, variant_number }. Stores result in content_drafts.
                          Auto-queues content_draft_score on completion.
content_draft_score     — Run DeepEval quality + compliance scoring on a draft. Requires { draft_id }.
                          Writes score_quality, score_relevancy, score_toxicity, score_compliance back.
                          Auto-sets status → pending_review if score >= threshold, else rejected.
content_review_notify   — Email reviewer that a draft is ready for approval. Requires { draft_id, reviewer_email }.
content_variant_publish — Dispatch a content variant to its channel adapter. Requires { variant_id }.
                          Calls @claw/maileroo (email), @claw/telnyx (sms), or blog/social adapter.
content_metrics_sync    — Sync reach/open/click metrics from channel APIs. Requires { brief_id } or { variant_id }.
github_sync         — Clone or pull managed client repos. Use { all: true } or repo filters ({ repo_ids: [...] } | { repo: "local/name" } | { repos: [...] }).
github_repo_status  — Read-only status of all managed repos. Requires { all: true }.
github_add_repo     — Register a new client repo. Requires { client_name, repo_url, branch }.
github_observability_scan — Deterministic static analysis of managed repos for stack drift/security/compliance.
                            Optional { repo, limit, dry_run }.
research_sync       — Pull curated vendor updates (RSS/GitHub releases) into external update store.
                      Optional { domain, days, limit, dry_run }.
research_signals    — Deterministic signal extraction from external updates (breaking/security/deprecation/etc.).
                      Optional { days, limit }.
platform_health_report — Aggregate latest repo scan + research signals into a platform health snapshot.
subscription_audit_run — Plaid + Gmail subscription audit with renewal alerts and cut recommendations.
                         Optional { days_back, max_email_scan, dry_run }.
tax_prep_automation_run — Tax prep automation (expense categorization + 1099/W-2 inbox capture + yearly folders).
                          Optional { year, days_back, dry_run }.
affiliate_research — Open-source affiliate stack + per-site rollout research report.
                     Optional { host, limit }.
openclaw_creator_pack_generate — Build a done-for-you OpenClaw macOS setup package for creators.
                                 Includes install checklist, templates, onboarding script, handoff docs.
                                 Optional { package_name, client_name, complexity: "simple"|"standard"|"premium", outcome, output_dir }.
security_secrets_scan — Deterministic scan for exposed secret/token patterns in tracked files.
security_deps_audit   — Deterministic dependency vulnerability scan via npm audit.
security_runtime_audit — Deterministic security runtime checks (env + DB + Redis + integrity).
security_sweep        — Full security sweep (secrets + runtime + deps + schema audit).
orchestrate         — Top-level goal decomposition with FIO directive. Use for multi-domain goals
                      that span multiple specialties (content + leads + email + code).
                      Requires { goal: "string" }. Optional: { context: {}, dry_run: true }.
                      Uses Claude Opus (or subscription). Do NOT use for simple single-domain tasks.
builder_gap_pulse   — Run gap analysis for repo(s) and queue repo_autofix + opencode_controller if gaps exist.
                      Optional { repos: "InayanBuilderBot" | "A,B,C", next: true }. Default repos from config.
                      Executed by running npm run builder:gap:pulse (script queues tasks).
repo_autofix        — Worker: npm install + quality gates (check, build, lint, test, test:e2e). For completion gaps.
                      Requires { repo }. Optional { source, reason, gap_context, builder_policy }. Usually queued by builder_gap_pulse.
opencode_controller — Worker: plan + implement + review for a repo objective. Can auto-iterate.
                      Requires { repo, objective }. Optional { source, iteration, max_iterations, gap_context, builder_policy }. Usually queued by builder_gap_pulse.
site_fix_plan       — Plan fixes for a repo (e.g. after repo_autofix failure). Requires { repo }. Optional { reason, context }.
site_audit         — Audit repo state. Requires { repo }. Optional { scope }.
`;

// ═══════════════════════════════════════════════════════════════
// INTENT TIER RULES (hard override — cannot be downgraded by LLM)
// ═══════════════════════════════════════════════════════════════

const TIER_RULES = `
INTENT TIER CLASSIFICATION — you must assign one of these:

Tier 0 — AUTO EXECUTE (no approval, no confirmation)
  • Read-only queries, metrics, status checks
  • echo, report, claw_stats, claw_recent, claw_search
  • site_audit (read-only repo audit)
  • Internal analysis with no external side effects

Tier 1 — SOFT CONFIRM (show plan, one-tap confirm, no token needed)
  • Write to internal DB or files only
  • index, classify, dedupe, media_detect, media_enrich, media_hash, cluster_media, fetch_content, analyze_content, generate_copy, aicreator
  • copy_research_pack, copy_critique, copy_improve, copy_lab_run
  • website_content_generator
  • social_media_copywriter
  • media_visual_catalog
  • content_brief_intake, content_draft_generate, content_draft_score, content_review_notify, content_metrics_sync

Tier 2 — EXPLICIT APPROVAL (token required, 2-hour window)
  • Any external API call (Google Places, web fetch of external sites)
  • migrate (moves real files)
  • qa_run on production URLs
  • fetch_leads
  • subscription_audit_run
  • tax_prep_automation_run
  • builder_gap_pulse, repo_autofix, opencode_controller, site_fix_plan (builder completion flow; queue or run workers)

Tier 3 — TWO-STEP CONFIRMATION (token + explicit second confirm)
  • send_email (external communication at scale)
  • content_variant_publish (external channel send — email/SMS/social)
  • patch (code changes)
  • Any task touching external accounts, payments, or communications
  • Any plan estimated to cost over $5 USD

CATEGORY TAGS (assign all that apply):
  READ_ONLY        — no side effects on any system
  WRITE_INTERNAL   — writes to local DB, files, queues only
  WRITE_EXTERNAL   — writes to external APIs or services
  EXTERNAL_FETCH   — reads from external URLs or APIs
  INFRA_CHANGE     — changes workers, queues, env, or config
  COST_EXPOSURE    — significant API/LLM/service spend
  DESTRUCTIVE      — deletes, overwrites, or permanently modifies data
  EMAIL_SEND       — sends emails to external addresses
  LEGAL_REVIEW     — requires checking terms of service before executing
`;

// ═══════════════════════════════════════════════════════════════
// SYSTEM PROMPT
// ═══════════════════════════════════════════════════════════════

const PLANNER_SYSTEM = `You are the Planner agent for ClawdBot, an autonomous business operating system.

Your job: take a user's goal and decompose it into an ordered list of executable tasks with full governance metadata.

RULES:
1. Use only task types from the task catalog.
2. Use depends_on_temp_ids to express dependencies — a task waits for all parents.
3. If a dependency fails, all downstream tasks are SKIPPED automatically.
4. Be SPECIFIC in payloads — workers need exact inputs.
5. Always include a "report" task at the end of multi-step pipelines.
6. Assign intent_tier and categories using the tier rules below — be honest, do not downgrade.
7. Estimate resource usage as accurately as possible.
8. Write rollback_plan as a concrete action, not "undo changes".
9. Assign machines_involved from: m1_desktop, m3_max, m1_laptop, i7_desktop, nas.

COST ESTIMATES:
  Claude Haiku:  ~$0.0003 per call (small) to $0.002 (large)
  Claude Sonnet: ~$0.005-0.05 per call
  Google Places: ~$0.017 per nearbysearch + $0.017 per details call
  Maileroo:      $0 (flat plan)
  Local tasks:   $0

REQUIRED PAYLOAD FIELDS PER TASK TYPE (use exact field names — never invent fields):
  fetch_content:    { brand_slug, platform, handle }
                    platform must be exactly: "youtube" | "tiktok" | "instagram"
  analyze_content:  { brand_slug }                    (platform optional)
  aicreator:        { brand_slug, objective }         (output_format/platform/audience/tone/step_count/brief optional)
  copy_research_pack: { brand_slug, channel, topic }  (sources/target_audience/tone/goal/notebook_context optional)
  copy_critique:    { brand_slug, channel, draft_text } (draft_id/topic/target_audience/tone/goal optional)
  copy_improve:     { brand_slug, channel, draft_text, critique } (draft_id/iteration optional)
  copy_lab_run:     { brand_slug, channel, topic } (sources/target_audience/tone/goal/iterations optional)
  website_content_generator: { brand_slug, market, objective, industry, page_type }
  social_media_copywriter: { brand_slug, platform, topic }
  fetch_leads:      { brand_slug, category, location } (NOT "United States" — use city)
  send_email:       { brand_slug, lead_id, template }  (lead_id is a UUID from leads table)
  github_sync:      { all: true }  OR  { repo_ids: ["uuid",...] }  OR  { repo: "local/name" }  OR  { repos: ["local/name", ...] }
  github_add_repo:  { client_name, repo_url, branch }
  subscription_audit_run: { days_back?, max_email_scan?, dry_run? }
  tax_prep_automation_run: { year?, days_back?, dry_run? }
  affiliate_research: { }  (optional: { host, limit })
  triage:           { task_id } OR { error, context }
  patch:            { triage_task_id }
  qa_run:           { url }
  migrate:          { source_dir } OR { source_path } OR { files } OR { dedupe_task_id }
  classify:         { path? } (optional path; if omitted, classifies pending rows)
  dedupe:           { clear?, summary? }
  media_detect:     { limit?, hostname? }
  media_enrich:     { limit?, hostname?, force?, dry_run? }
  media_hash:       { limit?, hostname?, force?, dry_run?, frame_second? }
  media_visual_catalog: { limit?, hostname?, force?, dry_run?, use_openai_vision? }
  cluster_media:    { limit?, hostname?, force?, dry_run?, time_window_minutes?, hash_hamming_threshold?, gps_delta? }

${TASK_CATALOG}

${TIER_RULES}

Respond with ONLY valid JSON. No markdown, no explanation.

Schema:
{
  "goal": "string",
  "reasoning": "string — why this decomposition",
  "intent_tier": 0 | 1 | 2 | 3,
  "intent_categories": ["READ_ONLY"|"WRITE_INTERNAL"|"WRITE_EXTERNAL"|"EXTERNAL_FETCH"|"INFRA_CHANGE"|"COST_EXPOSURE"|"DESTRUCTIVE"|"EMAIL_SEND"|"LEGAL_REVIEW"],
  "estimated_cost_usd": number,
  "estimated_duration_minutes": number,
  "risk_level": "low" | "med" | "high",
  "approval_required": boolean,
  "rollback_plan": "string — concrete steps to undo this plan",
  "machines_involved": ["m1_desktop"|"m3_max"|"m1_laptop"|"i7_desktop"|"nas"],
  "resource_estimates": {
    "api_calls": number,
    "db_rows_written": number,
    "emails_sent": number,
    "llm_tokens_estimate": number,
    "network_mb": number
  },
  "tasks": [
    {
      "temp_id": "t1",
      "type": "string",
      "title": "string",
      "payload": {},
      "depends_on_temp_ids": [],
      "priority": 1-5,
      "risk_level": "low" | "med" | "high",
      "timeout_seconds": number,
      "max_retries": number,
      "machine_hint": "string — which machine should run this"
    }
  ]
}`;

// ═══════════════════════════════════════════════════════════════
// PLANNER
// ═══════════════════════════════════════════════════════════════

async function plan(goal, context) {
  const planId = uuid();

  let userMessage = `Goal: ${goal}`;
  if (context) {
    userMessage += `\n\nAdditional context:\n${JSON.stringify(context, null, 2)}`;
  }

  // ── Pre-flight: choose route via model-router ────────────────
  // "plan" route: sub_sonnet → deepseek_r1 → api_sonnet
  // For simple read-only goals: _default route (sub_haiku → gemini_flash → ...)
  const simpleGoalRe = /\b(stats|status|report|search|list|show|find|check|metrics|index|scan|echo|workers|plans|deadletters)\b/i;
  const routeType = simpleGoalRe.test(goal) ? "_default" : "plan";

  console.log(`[planner] 🧠 Planning: "${goal}" (route: ${routeType})`);

  const memoryPrelude = await loadAgentPrelude("planner", {
    handoffs: ["DAILY-INTEL.md", "DAILY-ASSIGNMENT.md"],
    maxChars: 12000,
  });
  // Inject soul context + agent-state prelude into system prompt
  const fullSystem = [SOUL_PREFIX, memoryPrelude.text, PLANNER_SYSTEM].filter(Boolean).join("\n\n");

  const llmResult = await chatJson(routeType, fullSystem, userMessage, {
    max_tokens: 4096,
    task_id:    context?.task_id,
    plan_id:    context?.plan_id,
  });

  const text = llmResult.text;

  let parsed;
  try {
    // chatJson already parsed it — prefer llmResult.json, fall back to manual parse
    parsed = llmResult.json || JSON.parse(text.replace(/```json\n?|```\n?/g, "").trim());
  } catch (err) {
    console.error("[planner] Failed to parse output:", text.substring(0, 500));
    throw new Error(`Planner returned invalid JSON: ${err.message}`);
  }

  // ── Guardrail: non-empty task list ──────────────────────
  if (!Array.isArray(parsed.tasks) || parsed.tasks.length === 0) {
    throw new Error("Planner returned 0 tasks — cannot proceed with empty plan");
  }

  // ── Guardrail: max task count (prevents runaway plans) ──
  const MAX_TASKS = 25;
  if (parsed.tasks.length > MAX_TASKS) {
    throw new Error(`Planner returned ${parsed.tasks.length} tasks (max ${MAX_TASKS}). Break goal into smaller sub-goals.`);
  }

  // ── Validate temp_id refs ────────────────────────────────
  const tempIds = new Set(parsed.tasks.map(t => t.temp_id));
  for (const task of parsed.tasks) {
    for (const depId of task.depends_on_temp_ids || []) {
      if (!tempIds.has(depId)) {
        throw new Error(`Task "${task.title}" depends on unknown temp_id "${depId}"`);
      }
    }
  }

  // ── Circular dep check ───────────────────────────────────
  if (hasCircularDeps(parsed.tasks)) {
    throw new Error("Circular dependency detected in plan");
  }

  // ── Unknown task types ───────────────────────────────────
  for (const task of parsed.tasks) {
    if (!isKnownTaskType(task.type)) {
      throw new Error(`Unknown task type "${task.type}"`);
    }
  }

  // ── Enforce tier/approval consistency ───────────────────
  // Tier 3 always requires approval. Tier 0 never does.
  if (parsed.intent_tier === 0) parsed.approval_required = false;
  if (parsed.intent_tier === 3) parsed.approval_required = true;

  // ── Focus profile enrichment (intent/purpose/goals/skills) ──────────────
  const profileUsage = new Map();
  parsed.tasks = parsed.tasks.map((task) => {
    const resolution = resolveProfileForTask(task.type, task.payload || {}, {
      title: task.title || task.type,
      goal,
      requiredTags: [],
    });

    const primary = resolution.primary || null;
    const candidates = (resolution.candidates || []).slice(0, 3);
    if (primary?.id) {
      profileUsage.set(primary.id, (profileUsage.get(primary.id) || 0) + 1);
    }

    const payload = { ...(task.payload || {}) };
    if (primary) {
      payload._focus_profile_id = primary.id;
      payload._focus_profile = compactProfileProjection(primary, { maxGoals: 3, maxSkills: 10 });
      payload._focus_intent = primary.intent;
    }
    if (candidates.length) {
      payload._focus_profile_candidates = candidates.map((p) => ({
        id: p.id,
        name: p.name,
        intent: p.intent,
      }));
    }

    return {
      ...task,
      payload,
      focus_profile_id: primary?.id || null,
      focus_profile_candidates: candidates.map((p) => p.id),
    };
  });

  const taskPlan = { plan_id: planId, ...parsed };
  taskPlan.focus_profiles_used = Array.from(profileUsage.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([id, task_count]) => ({ id, task_count }));

  // ── Track planner LLM cost (provided by model-router) ────────
  const plannerCostUsd = llmResult.cost_usd || 0;
  taskPlan.planner_cost_usd = plannerCostUsd;
  taskPlan.model_used       = llmResult.model_id || llmResult.model_key || "unknown";

  console.log(
    `[planner] ✓ ${planId}: ${parsed.tasks.length} tasks | ` +
    `tier=${parsed.intent_tier} risk=${parsed.risk_level} ` +
    `est=$${parsed.estimated_cost_usd} planner_cost=$${plannerCostUsd.toFixed(5)} ` +
    `model=${taskPlan.model_used} provider=${llmResult.provider || "?"}`
  );

  await appendAgentDailyLog("planner", {
    goal,
    task_type: "plan",
    summary: `planned ${parsed.tasks.length} tasks tier=${parsed.intent_tier} route=${routeType}`,
    learned: `risk=${parsed.risk_level || "unknown"} approval_required=${parsed.approval_required === true}`,
    model_used: taskPlan.model_used,
    cost_usd: Number(plannerCostUsd || 0),
    open_loops: parsed.intent_tier >= 2 ? ["awaiting approval for higher-tier actions"] : [],
  }).catch(() => {});

  return taskPlan;
}

// ═══════════════════════════════════════════════════════════════
// CIRCULAR DEP CHECK (DFS)
// ═══════════════════════════════════════════════════════════════

function hasCircularDeps(tasks) {
  const visited = new Set();
  const inStack = new Set();
  const depsMap = new Map();
  for (const t of tasks) depsMap.set(t.temp_id, t.depends_on_temp_ids || []);

  function dfs(id) {
    if (inStack.has(id)) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    inStack.add(id);
    for (const dep of depsMap.get(id) || []) {
      if (dfs(dep)) return true;
    }
    inStack.delete(id);
    return false;
  }

  for (const t of tasks) {
    if (dfs(t.temp_id)) return true;
  }
  return false;
}

module.exports = { plan };
