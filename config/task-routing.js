"use strict";

const TAG_TAXONOMY = Object.freeze([
  "infra",
  "deterministic",
  "ai",
  "qa",
  "cpu_heavy",
  "io_heavy",
]);

// Canonical routing for all task types.
// Keep this as the single source of truth for queue + required worker tags.
const TASK_ROUTING = Object.freeze({
  echo: { queue: "claw_tasks_infra", required_tags: ["infra"] },
  report: { queue: "claw_tasks_infra", required_tags: ["infra"] },
  report_refresh: { queue: "claw_tasks_infra", required_tags: ["infra", "deterministic"] },

  index: { queue: "claw_tasks_io_heavy", required_tags: ["io_heavy"] },
  media_detect: { queue: "claw_tasks_io_heavy", required_tags: ["infra", "deterministic", "io_heavy"] },
  media_enrich: { queue: "claw_tasks_io_heavy", required_tags: ["infra", "deterministic", "io_heavy"] },
  media_hash: { queue: "claw_tasks_cpu_heavy", required_tags: ["cpu_heavy"] },
  media_visual_catalog: { queue: "claw_tasks_cpu_heavy", required_tags: ["cpu_heavy"] },
  cluster_media: { queue: "claw_tasks_cpu_heavy", required_tags: ["cpu_heavy"] },
  resourceful_file_resolve: { queue: "claw_tasks_io_heavy", required_tags: ["infra", "deterministic", "io_heavy"] },
  dedupe: { queue: "claw_tasks_cpu_heavy", required_tags: ["cpu_heavy"] },
  migrate: { queue: "claw_tasks_io_heavy", required_tags: ["io_heavy"] },

  classify: { queue: "claw_tasks_ai", required_tags: ["ai"] },
  triage: { queue: "claw_tasks_ai", required_tags: ["ai"] },
  judge: { queue: "claw_tasks_ai", required_tags: ["ai"] },
  patch: { queue: "claw_tasks_ai", required_tags: ["ai"] },
  orchestrate: { queue: "claw_tasks_ai", required_tags: ["ai"] },
  analyze_content: { queue: "claw_tasks_ai", required_tags: ["ai"] },
  generate_copy: { queue: "claw_tasks_ai", required_tags: ["ai"] },
  aicreator: { queue: "claw_tasks_ai", required_tags: ["ai"] },
  copy_research_pack: { queue: "claw_tasks_ai", required_tags: ["ai"] },
  copy_critique: { queue: "claw_tasks_ai", required_tags: ["ai"] },
  copy_improve: { queue: "claw_tasks_ai", required_tags: ["ai"] },
  copy_lab_run: { queue: "claw_tasks_ai", required_tags: ["ai"] },
  website_content_generator: { queue: "claw_tasks_ai", required_tags: ["ai"] },
  social_media_copywriter: { queue: "claw_tasks_ai", required_tags: ["ai"] },

  qa_run: { queue: "claw_tasks_qa", required_tags: ["qa"] },
  qa_spec: { queue: "claw_tasks_qa", required_tags: ["qa"] },
  qa_pack: { queue: "claw_tasks_qa", required_tags: ["qa"] },

  claw_search: { queue: "claw_tasks_io_heavy", required_tags: ["io_heavy"] },
  claw_stats: { queue: "claw_tasks_io_heavy", required_tags: ["io_heavy"] },
  claw_recent: { queue: "claw_tasks_io_heavy", required_tags: ["io_heavy"] },

  fetch_content: { queue: "claw_tasks_io_heavy", required_tags: ["io_heavy"] },
  fetch_leads: { queue: "claw_tasks_io_heavy", required_tags: ["io_heavy"] },
  send_email: { queue: "claw_tasks_io_heavy", required_tags: ["io_heavy"] },

  github_sync: { queue: "claw_tasks_io_heavy", required_tags: ["io_heavy"] },
  github_repo_status: { queue: "claw_tasks_io_heavy", required_tags: ["io_heavy"] },
  github_repo_audit: { queue: "claw_tasks_io_heavy", required_tags: ["io_heavy"] },
  github_add_repo: { queue: "claw_tasks_io_heavy", required_tags: ["io_heavy"] },
  github_observability_scan: { queue: "claw_tasks_io_heavy", required_tags: ["io_heavy"] },

  research_sync: { queue: "claw_tasks_infra", required_tags: ["infra"] },
  research_signals: { queue: "claw_tasks_infra", required_tags: ["infra"] },
  affiliate_research: { queue: "claw_tasks_infra", required_tags: ["infra"] },
  platform_health_report: { queue: "claw_tasks_infra", required_tags: ["infra"] },
  security_secrets_scan: { queue: "claw_tasks_infra", required_tags: ["infra", "deterministic"] },
  security_deps_audit: { queue: "claw_tasks_infra", required_tags: ["infra", "deterministic"] },
  security_runtime_audit: { queue: "claw_tasks_infra", required_tags: ["infra", "deterministic"] },
  security_sweep: { queue: "claw_tasks_infra", required_tags: ["infra", "deterministic"] },
  // Nightly AI-powered security council: four expert roles + Opus synthesis via model-router.
  // Routes to the AI queue so it lands on an ai-tagged worker with model access.
  security_council: { queue: "claw_tasks_ai", required_tags: ["ai"] },
  subscription_audit_run: { queue: "claw_tasks_io_heavy", required_tags: ["infra", "deterministic", "io_heavy"] },
  tax_prep_automation_run: { queue: "claw_tasks_io_heavy", required_tags: ["infra", "deterministic", "io_heavy"] },
  quant_trading_signal_scan: { queue: "claw_tasks_io_heavy", required_tags: ["infra", "deterministic", "io_heavy"] },
  quant_trading_strategy_run: { queue: "claw_tasks_io_heavy", required_tags: ["infra", "deterministic", "io_heavy"] },
  quant_trading_execute_orders: { queue: "claw_tasks_io_heavy", required_tags: ["infra", "deterministic", "io_heavy"] },
  quant_trading_close_order: { queue: "claw_tasks_io_heavy", required_tags: ["infra", "deterministic", "io_heavy"] },
  quant_trading_backtest: { queue: "claw_tasks_io_heavy", required_tags: ["infra", "deterministic", "io_heavy"] },
  quant_trading_daily_summary: { queue: "claw_tasks_infra", required_tags: ["infra", "deterministic"] },
  quant_trading_pause: { queue: "claw_tasks_infra", required_tags: ["infra", "deterministic"] },
  quant_trading_resume: { queue: "claw_tasks_infra", required_tags: ["infra", "deterministic"] },
  quant_trading_config_update: { queue: "claw_tasks_infra", required_tags: ["infra", "deterministic"] },
  quant_trading_status: { queue: "claw_tasks_infra", required_tags: ["infra", "deterministic"] },
  dev_pipeline_run: { queue: "claw_tasks_io_heavy", required_tags: ["infra", "deterministic", "io_heavy"] },
  // Deterministic file-heavy report generation: keep on NAS/infra workers to avoid
  // stale satellite AI workers missing newly added handlers.
  hardware_research_report: {
    queue: "claw_tasks_io_heavy",
    required_tags: ["infra", "deterministic", "io_heavy"],
  },

  site_audit: { queue: "claw_tasks_io_heavy", required_tags: ["io_heavy"] },
  site_compare: { queue: "claw_tasks_io_heavy", required_tags: ["io_heavy"] },
  site_fix_plan: { queue: "claw_tasks_ai", required_tags: ["ai"] },
  site_extract_patterns: { queue: "claw_tasks_ai", required_tags: ["ai"] },
  openclaw_creator_pack_generate: { queue: "claw_tasks_infra", required_tags: ["infra", "deterministic"] },
  opencode_controller: { queue: "claw_tasks_ai", required_tags: ["ai"] },
  repo_index_autopatch: { queue: "claw_tasks_io_heavy", required_tags: ["infra", "deterministic", "io_heavy"] },
  repo_autofix: { queue: "claw_tasks_io_heavy", required_tags: ["infra", "deterministic", "io_heavy"] },
  brand_provision: { queue: "claw_tasks_io_heavy", required_tags: ["infra", "deterministic", "io_heavy"] },

  loyalty_webhook_ingest: { queue: "claw_tasks_infra", required_tags: ["infra", "deterministic"] },
  loyalty_process_webhooks: { queue: "claw_tasks_infra", required_tags: ["infra", "deterministic"] },
  loyalty_send_outreach: { queue: "claw_tasks_io_heavy", required_tags: ["io_heavy"] },
  loyalty_maintenance: { queue: "claw_tasks_io_heavy", required_tags: ["io_heavy"] },

  // Business Intelligence Agent Tasks
  business_research: { queue: "claw_tasks_ai", required_tags: ["ai"] },
  business_build: { queue: "claw_tasks_ai", required_tags: ["ai"] },
  business_update: { queue: "claw_tasks_ai", required_tags: ["ai"] },
  business_improve: { queue: "claw_tasks_ai", required_tags: ["ai"] },
  business_coordinate: { queue: "claw_tasks_ai", required_tags: ["ai"] },
});

function resolveRouting(type) {
  return TASK_ROUTING[type] || { queue: "claw_tasks", required_tags: [] };
}

function isKnownTaskType(type) {
  return Object.prototype.hasOwnProperty.call(TASK_ROUTING, type);
}

module.exports = {
  TAG_TAXONOMY,
  TASK_ROUTING,
  resolveRouting,
  isKnownTaskType,
};
