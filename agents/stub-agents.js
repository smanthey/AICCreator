// agents/stub-agents.js
// Loads all agent implementations.
// Real agents replace stubs one by one — require() them here.
// Any type NOT listed here falls back to the registry's unknown handler.

const { register } = require("./registry");

// ─── Real implementations ──────────────────────────────────────
require("./classify-agent");   // classify  → claw_tasks:io
require("./dedupe-agent");     // dedupe    → claw_tasks:io
require("./migrate-agent");    // migrate   → claw_tasks:io_heavy
require("./triage-agent");     // triage    → claw_tasks:llm
require("./patch-agent");      // patch     → claw_tasks:llm
require("./qa-agent");         // qa_run    → claw_tasks:qa
require("./claw-agent");       // claw_search / claw_stats / claw_recent
require("./content-agent");    // fetch_content / analyze_content
require("./leadgen-agent");    // fetch_leads / send_email
require("./github-sync-agent"); // github_sync / github_repo_status / github_add_repo
require("./research-agent");   // research_sync / research_signals / platform_health_report
require("./security-agent");   // security_* continuous sweep/audit handlers
require("./loyalty-agent");    // loyalty_* deterministic webhook/points/outreach pipeline
require("./site-audit-agent"); // site_* portfolio audit/compare/fix-plan/pattern extraction
require("./repo-autofix-agent"); // repo_autofix deterministic patch + reverify
require("./brand-provision-agent"); // brand_provision centralized brand provisioning
require("./media-detect-agent"); // media_detect deterministic media candidate summary
require("./media-enrich-agent"); // media_enrich deterministic EXIF/ffprobe pipeline
require("./media-hash-agent");   // media_hash deterministic perceptual hashing
require("./media-visual-agent"); // media_visual_catalog visual labels + scene + location/file-name signals
require("./cluster-agent");      // cluster_media deterministic shoot grouping
require("./resourceful-file-resolve-agent"); // resourceful_file_resolve unknown file-type resolver
require("./openclaw-creator-pack-agent"); // openclaw_creator_pack_generate done-for-you creator package generator
require("./finance-automation-agent"); // subscription_audit_run / tax_prep_automation_run
require("./opencode-controller-agent"); // opencode_controller OpenClaw->OpenCode orchestrated execution loop
require("./repo-index-autopatch-agent"); // repo_index_autopatch deterministic index/repomap refresh lane
require("./quantfusion-trading-agent"); // quant_trading_* autonomous trading ops
require("./hardware-research-agent"); // hardware_research_report deep hardware/manufacturing/software research report
require("./dev-pipeline-agent"); // dev_pipeline_run staged Research->Implement->Review->Test->Security pipeline
require("./report-refresh-agent"); // report_refresh queued report command runner

// ─── Business Intelligence Agent stubs ────────────────────────
// These task types are routed via task-routing.js but handled by standalone
// PM2 processes (business-*-agent.js), not inline worker handlers.
// Stubs prevent "orphan routing" WARN in audit:tasks and provide a clear error
// if a task is accidentally dispatched through the queue.
for (const bizType of [
  "business_research",
  "business_build",
  "business_update",
  "business_improve",
  "business_coordinate",
]) {
  register(bizType, async (payload) => {
    const msg = `[${bizType}] Task type '${bizType}' is handled by a standalone PM2 agent, not the task queue. ` +
      `Dispatch was unexpected. Payload: ${JSON.stringify(payload).slice(0, 200)}`;
    console.warn(msg);
    return { status: "skipped", reason: "standalone_pm2_agent", task_type: bizType };
  });
}

// ─── Judge (deterministic — no LLM) ───────────────────────────
register("judge", async (payload) => {
  const judge = require("../control/judge");
  const triageTaskId = payload?.triage_task_id;
  if (!triageTaskId) throw new Error("judge payload must include { triage_task_id }");
  const verdict = await judge.evaluateByTaskId(triageTaskId);
  console.log(`[judge] verdict=${verdict.verdict} confidence=${verdict.confidence}`);
  return { ...verdict, cost_usd: 0, model_used: "deterministic-judge" };
});
