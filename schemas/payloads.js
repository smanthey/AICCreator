// schemas/payloads.js
// Per-task-type payload validators.
// Called by the dispatcher BEFORE a task is enqueued to BullMQ.
// Throws a clear error if required fields are missing or wrong type.
// This catches planner hallucinations before they reach workers.

"use strict";
const Ajv = require("ajv");
const ajv = new Ajv({ allErrors: true, strict: false });

/**
 * Each entry: { required: string[], rules?: { [field]: (val) => true|string } }
 * rules return true on pass, or an error string on fail.
 */
const SCHEMAS = {
  echo: {},

  report: {
    required: ["plan_id"],
  },

  report_refresh: {
    required: ["report_id"],
    rules: {
      report_id: (v) =>
        typeof v === "string" && v.trim().length > 0 ||
        "report_id must be a non-empty string",
      requested_by: (v) =>
        v === undefined || (typeof v === "string" && v.trim().length > 0) ||
        "requested_by must be a non-empty string when provided",
      priority: (v) =>
        v === undefined || (Number.isInteger(v) && v >= 1 && v <= 10) ||
        "priority must be an integer between 1 and 10 when provided",
      idempotency_key: (v) =>
        v === undefined || (typeof v === "string" && v.trim().length > 0) ||
        "idempotency_key must be a non-empty string when provided",
    },
  },

  index: {
    required: ["path"],
    rules: {
      path: (v) => typeof v === "string" || "path must be a string",
    },
  },

  media_detect: {
    rules: {
      limit: (v) =>
        v === undefined || (Number.isInteger(v) && v > 0 && v <= 50000) ||
        "limit must be an integer between 1 and 50000",
      hostname: (v) =>
        v === undefined || (typeof v === "string" && v.trim().length > 0) ||
        "hostname must be a non-empty string when provided",
    },
  },

  classify: {
    rules: {
      path: (v) =>
        v === undefined || typeof v === "string" ||
        "path must be a string when provided",
      limit: (v) =>
        v === undefined || (Number.isInteger(v) && v > 0 && v <= 50000) ||
        "limit must be an integer between 1 and 50000",
      force: (v) =>
        v === undefined || typeof v === "boolean" ||
        "force must be boolean when provided",
      low_confidence_threshold: (v) =>
        v === undefined || (typeof v === "number" && v >= 0 && v <= 1) ||
        "low_confidence_threshold must be a number between 0 and 1",
      files: (v) =>
        v === undefined || (Array.isArray(v) && v.every((x) => typeof x === "string")) ||
        "files must be an array of strings when provided",
    },
  },

  dedupe: {
    rules: {
      clear: (v) =>
        v === undefined || typeof v === "boolean" ||
        "clear must be boolean when provided",
      summary: (v) =>
        v === undefined || typeof v === "boolean" ||
        "summary must be boolean when provided",
    },
  },

  media_enrich: {
    rules: {
      limit: (v) =>
        v === undefined || (Number.isInteger(v) && v > 0 && v <= 2000) ||
        "limit must be an integer between 1 and 2000",
      hostname: (v) =>
        v === undefined || (typeof v === "string" && v.trim().length > 0) ||
        "hostname must be a non-empty string when provided",
      force: (v) =>
        v === undefined || typeof v === "boolean" ||
        "force must be boolean when provided",
      dry_run: (v) =>
        v === undefined || typeof v === "boolean" ||
        "dry_run must be boolean when provided",
    },
  },

  media_hash: {
    rules: {
      limit: (v) =>
        v === undefined || (Number.isInteger(v) && v > 0 && v <= 5000) ||
        "limit must be an integer between 1 and 5000",
      hostname: (v) =>
        v === undefined || (typeof v === "string" && v.trim().length > 0) ||
        "hostname must be a non-empty string when provided",
      force: (v) =>
        v === undefined || typeof v === "boolean" ||
        "force must be boolean when provided",
      dry_run: (v) =>
        v === undefined || typeof v === "boolean" ||
        "dry_run must be boolean when provided",
      frame_second: (v) =>
        v === undefined || (typeof v === "number" && v >= 0 && v <= 3600) ||
        "frame_second must be a number between 0 and 3600",
    },
  },

  media_visual_catalog: {
    rules: {
      limit: (v) =>
        v === undefined || (Number.isInteger(v) && v > 0 && v <= 5000) ||
        "limit must be an integer between 1 and 5000",
      hostname: (v) =>
        v === undefined || (typeof v === "string" && v.trim().length > 0) ||
        "hostname must be a non-empty string when provided",
      force: (v) =>
        v === undefined || typeof v === "boolean" ||
        "force must be boolean when provided",
      dry_run: (v) =>
        v === undefined || typeof v === "boolean" ||
        "dry_run must be boolean when provided",
      use_openai_vision: (v) =>
        v === undefined || typeof v === "boolean" ||
        "use_openai_vision must be boolean when provided",
    },
  },

  resourceful_file_resolve: {
    rules: {
      limit: (v) =>
        v === undefined || (Number.isInteger(v) && v > 0 && v <= 5000) ||
        "limit must be an integer between 1 and 5000",
      hostname: (v) =>
        v === undefined || (typeof v === "string" && v.trim().length > 0) ||
        "hostname must be a non-empty string when provided",
      path_prefix: (v) =>
        v === undefined || (typeof v === "string" && v.trim().length > 0) ||
        "path_prefix must be a non-empty string when provided",
      force: (v) =>
        v === undefined || typeof v === "boolean" ||
        "force must be boolean when provided",
      dry_run: (v) =>
        v === undefined || typeof v === "boolean" ||
        "dry_run must be boolean when provided",
    },
  },

  cluster_media: {
    rules: {
      limit: (v) =>
        v === undefined || (Number.isInteger(v) && v > 0 && v <= 50000) ||
        "limit must be an integer between 1 and 50000",
      hostname: (v) =>
        v === undefined || (typeof v === "string" && v.trim().length > 0) ||
        "hostname must be a non-empty string when provided",
      force: (v) =>
        v === undefined || typeof v === "boolean" ||
        "force must be boolean when provided",
      dry_run: (v) =>
        v === undefined || typeof v === "boolean" ||
        "dry_run must be boolean when provided",
      time_window_minutes: (v) =>
        v === undefined || (typeof v === "number" && v >= 5 && v <= 1440) ||
        "time_window_minutes must be a number between 5 and 1440",
      hash_hamming_threshold: (v) =>
        v === undefined || (typeof v === "number" && v >= 0 && v <= 64) ||
        "hash_hamming_threshold must be a number between 0 and 64",
      gps_delta: (v) =>
        v === undefined || (typeof v === "number" && v >= 0 && v <= 1) ||
        "gps_delta must be a number between 0 and 1",
    },
  },

  migrate: {
    rules: {
      _root: (p) => {
        if (p.source_dir || p.source_path) return true;
        if (Array.isArray(p.files) && p.files.length > 0) return true;
        if (p.dedupe_task_id) return true;
        return 'migrate requires one of: { source_dir }, { source_path }, { files: [...] }, or { dedupe_task_id }';
      },
      source_dir: (v) =>
        v === undefined || typeof v === "string" ||
        "source_dir must be a string when provided",
      source_path: (v) =>
        v === undefined || typeof v === "string" ||
        "source_path must be a string when provided",
      files: (v) =>
        v === undefined || (Array.isArray(v) && v.every((x) => typeof x === "string")) ||
        "files must be an array of strings when provided",
      dedupe_task_id: (v) =>
        v === undefined || /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(v) ||
        "dedupe_task_id must be a valid UUID when provided",
    },
  },

  triage: {
    rules: {
      _root: (p) => {
        if (p.task_id) return true;
        if (typeof p.error === "string" && p.error.trim()) return true;
        return 'triage requires { task_id } or { error: "..." }';
      },
      task_id: (v) =>
        v === undefined || /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(v) ||
        "task_id must be a valid UUID when provided",
      error: (v) =>
        v === undefined || typeof v === "string" ||
        "error must be a string when provided",
    },
  },

  judge: {
    required: ["triage_task_id"],
  },

  patch: {
    required: ["triage_task_id"],
  },

  qa_run: {
    required: ["url"],
    rules: {
      url: (v) => /^https?:\/\//.test(v) || 'url must start with http:// or https://',
    },
  },

  qa_spec: {
    rules: {
      _root: (p) => {
        if (!p.spec && !p.specs_dir) {
          return 'qa_spec requires { spec: "name" } or { specs_dir: "/path" }';
        }
        return true;
      },
      url: (v) =>
        v === undefined || /^https?:\/\//.test(v) ||
        'url must start with http:// or https://',
    },
  },

  qa_pack: {
    rules: {
      pack: (v) =>
        typeof v === "string" && v.trim().length > 0 ||
        'qa_pack requires { pack: "non-empty string" }',
      url: (v) =>
        v === undefined || /^https?:\/\//.test(v) ||
        'url must start with http:// or https://',
    },
  },

  claw_search: {
    required: ["query"],
  },

  claw_stats: {},

  claw_recent: {},

  fetch_content: {
    required: ["brand_slug", "platform", "handle"],
    rules: {
      platform: (v) =>
        ["youtube", "tiktok", "instagram"].includes(v) ||
        `platform must be "youtube", "tiktok", or "instagram" — got "${v}"`,
      handle: (v) =>
        typeof v === "string" && v.length > 0 || "handle must be a non-empty string",
      max_results: (v) =>
        v === undefined || (Number.isInteger(v) && v > 0 && v <= 50) ||
        "max_results must be an integer between 1 and 50",
    },
  },

  analyze_content: {
    required: ["brand_slug"],
    rules: {
      platform: (v) =>
        v === undefined ||
        ["youtube", "tiktok", "instagram"].includes(v) ||
        `platform must be "youtube", "tiktok", or "instagram" — got "${v}"`,
    },
  },

  generate_copy: {
    required: ["brand_slug", "format"],
    rules: {
      format: (v) =>
        ["email", "caption", "product_desc"].includes(v) ||
        `format must be "email", "caption", or "product_desc" — got "${v}"`,
    },
  },

  aicreator: {
    required: ["brand_slug", "objective"],
    rules: {
      objective: (v) =>
        typeof v === "string" && v.trim().length > 0 ||
        "objective must be a non-empty string",
      output_format: (v) =>
        v === undefined || ["email", "caption", "product_desc", "script", "landing_copy"].includes(v) ||
        `output_format must be "email", "caption", "product_desc", "script", or "landing_copy" — got "${v}"`,
      platform: (v) =>
        v === undefined || ["youtube", "tiktok", "instagram", "email", "web"].includes(v) ||
        `platform must be "youtube", "tiktok", "instagram", "email", or "web" — got "${v}"`,
      step_count: (v) =>
        v === undefined || (Number.isInteger(v) && v >= 3 && v <= 10) ||
        "step_count must be an integer between 3 and 10",
    },
  },

  copy_research_pack: {
    required: ["brand_slug", "channel", "topic"],
    rules: {
      channel: (v) =>
        ["email", "sms", "blog", "instagram", "linkedin", "push_notification"].includes(v) ||
        `channel must be one of: email, sms, blog, instagram, linkedin, push_notification — got "${v}"`,
      topic: (v) =>
        typeof v === "string" && v.trim().length > 0 ||
        "topic must be a non-empty string",
      sources: (v) =>
        v === undefined || (Array.isArray(v) && v.every((x) => typeof x === "string")) ||
        "sources must be an array of URL strings when provided",
    },
  },

  copy_critique: {
    required: ["brand_slug", "channel", "draft_text"],
    rules: {
      channel: (v) =>
        ["email", "sms", "blog", "instagram", "linkedin", "push_notification"].includes(v) ||
        `channel must be one of: email, sms, blog, instagram, linkedin, push_notification — got "${v}"`,
      draft_text: (v) =>
        typeof v === "string" && v.trim().length >= 20 ||
        "draft_text must be a non-empty string with at least 20 characters",
    },
  },

  copy_improve: {
    required: ["brand_slug", "channel", "draft_text", "critique"],
    rules: {
      channel: (v) =>
        ["email", "sms", "blog", "instagram", "linkedin", "push_notification"].includes(v) ||
        `channel must be one of: email, sms, blog, instagram, linkedin, push_notification — got "${v}"`,
      draft_text: (v) =>
        typeof v === "string" && v.trim().length >= 20 ||
        "draft_text must be a non-empty string with at least 20 characters",
      iteration: (v) =>
        v === undefined || (Number.isInteger(v) && v >= 1 && v <= 5) ||
        "iteration must be an integer between 1 and 5",
    },
  },

  copy_lab_run: {
    required: ["brand_slug", "channel", "topic"],
    rules: {
      channel: (v) =>
        ["email", "sms", "blog", "instagram", "linkedin", "push_notification"].includes(v) ||
        `channel must be one of: email, sms, blog, instagram, linkedin, push_notification — got "${v}"`,
      iterations: (v) =>
        v === undefined || (Number.isInteger(v) && v >= 1 && v <= 3) ||
        "iterations must be an integer between 1 and 3",
    },
  },

  website_content_generator: {
    required: ["brand_slug", "market", "objective", "industry", "page_type"],
    rules: {
      industry: (v) =>
        ["health_brand", "saas", "general"].includes(v) ||
        `industry must be one of: health_brand, saas, general — got "${v}"`,
      page_type: (v) =>
        ["homepage", "landing_page", "service_page", "product_page"].includes(v) ||
        `page_type must be one of: homepage, landing_page, service_page, product_page — got "${v}"`,
      market: (v) =>
        typeof v === "string" && v.trim().length > 0 || "market must be a non-empty string",
      objective: (v) =>
        typeof v === "string" && v.trim().length > 0 || "objective must be a non-empty string",
    },
  },
  social_media_copywriter: {
    required: ["brand_slug", "platform", "topic"],
    rules: {
      platform: (v) =>
        ["instagram", "x", "linkedin", "tiktok", "facebook"].includes(String(v || "").toLowerCase()) ||
        `platform must be one of: instagram, x, linkedin, tiktok, facebook — got "${v}"`,
      topic: (v) =>
        typeof v === "string" && v.trim().length > 0 || "topic must be a non-empty string",
      variations: (v) =>
        v === undefined || (Number.isInteger(v) && v >= 1 && v <= 5) ||
        "variations must be an integer between 1 and 5",
    },
  },

  fetch_leads: {
    required: ["brand_slug", "category", "location"],
    rules: {
      location: (v) => {
        if (typeof v !== "string") return "location must be a string";
        const lower = v.toLowerCase().trim();
        if (lower === "united states" || lower === "usa" || lower === "us") {
          return 'location must be a specific city or zip code (e.g. "Phoenix, AZ") — not the whole country';
        }
        return true;
      },
      radius_m: (v) =>
        v === undefined || (typeof v === "number" && v > 0 && v <= 100000) ||
        "radius_m must be a number between 1 and 100000",
    },
  },

  send_email: {
    required: ["brand_slug", "lead_id", "template"],
    rules: {
      lead_id: (v) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ||
        `lead_id must be a valid UUID — got "${v}"`,
      template: (v) => {
        const valid = [
          "skynpatch_b2b_intro",
          "skynpatch_b2b_followup",
          "plushtrap_collab_intro",
          "blackwallstreetopoly_wholesale_intro",
        ];
        return valid.includes(v) || `template must be one of: ${valid.join(", ")} — got "${v}"`;
      },
    },
  },

  loyalty_webhook_ingest: {
    required: ["provider", "event_type"],
    rules: {
      provider: (v) =>
        typeof v === "string" && v.trim().length > 0 ||
        'provider must be a non-empty string',
      event_type: (v) =>
        typeof v === "string" && v.trim().length > 0 ||
        'event_type must be a non-empty string',
      payload: (v) =>
        v === undefined || (v && typeof v === "object" && !Array.isArray(v)) ||
        "payload must be an object when provided",
    },
  },

  loyalty_process_webhooks: {
    rules: {
      limit: (v) =>
        v === undefined || (Number.isInteger(v) && v > 0 && v <= 10000) ||
        "limit must be an integer between 1 and 10000",
    },
  },

  loyalty_send_outreach: {
    rules: {
      limit: (v) =>
        v === undefined || (Number.isInteger(v) && v > 0 && v <= 10000) ||
        "limit must be an integer between 1 and 10000",
      channel: (v) =>
        v === undefined || ["email", "sms", "wallet_pass"].includes(v) ||
        'channel must be one of: email, sms, wallet_pass',
    },
  },

  loyalty_maintenance: {
    rules: {
      webhook_limit: (v) =>
        v === undefined || (Number.isInteger(v) && v > 0 && v <= 10000) ||
        "webhook_limit must be an integer between 1 and 10000",
      outreach_limit: (v) =>
        v === undefined || (Number.isInteger(v) && v > 0 && v <= 10000) ||
        "outreach_limit must be an integer between 1 and 10000",
    },
  },

  github_sync: {
    rules: {
      _root: (payload) => {
        const hasRepoIds = Array.isArray(payload.repo_ids) && payload.repo_ids.length > 0;
        const hasRepo = typeof payload.repo === "string" && payload.repo.trim().length > 0;
        const hasRepos = Array.isArray(payload.repos) && payload.repos.length > 0;
        if (!payload.all && !hasRepoIds && !hasRepo && !hasRepos) {
          return "github_sync requires { all: true } or repo filters via repo_ids/repo/repos";
        }
        return true;
      },
    },
  },

  github_repo_status: {},

  github_repo_audit: {},

  github_add_repo: {
    required: ["repo_url"],
    rules: {
      repo_url: (v) =>
        /^(https?:\/\/|git@)/.test(v) ||
        `repo_url must be an HTTPS or SSH URL — got "${v}"`,
      branch: (v) =>
        v === undefined || (typeof v === "string" && v.trim().length > 0) ||
        "branch must be a non-empty string when provided",
    },
  },

  github_observability_scan: {},

  research_sync: {},
  research_signals: {},
  platform_health_report: {},
  affiliate_research: {
    rules: {
      host: (v) =>
        v === undefined || (typeof v === "string" && v.trim().length > 0) ||
        "host must be a non-empty string when provided",
      limit: (v) =>
        v === undefined || (Number.isInteger(v) && v >= 1 && v <= 200) ||
        "limit must be an integer between 1 and 200",
      dry_run: (v) =>
        v === undefined || typeof v === "boolean" ||
        "dry_run must be boolean when provided",
    },
  },
  subscription_audit_run: {
    rules: {
      days_back: (v) =>
        v === undefined || (Number.isInteger(v) && v >= 30 && v <= 730) ||
        "days_back must be an integer between 30 and 730",
      max_email_scan: (v) =>
        v === undefined || (Number.isInteger(v) && v >= 10 && v <= 500) ||
        "max_email_scan must be an integer between 10 and 500",
      dry_run: (v) =>
        v === undefined || typeof v === "boolean" ||
        "dry_run must be boolean when provided",
    },
  },
  tax_prep_automation_run: {
    rules: {
      year: (v) =>
        v === undefined || (Number.isInteger(v) && v >= 2000 && v <= 2100) ||
        "year must be an integer between 2000 and 2100",
      days_back: (v) =>
        v === undefined || (Number.isInteger(v) && v >= 30 && v <= 730) ||
        "days_back must be an integer between 30 and 730",
      dry_run: (v) =>
        v === undefined || typeof v === "boolean" ||
        "dry_run must be boolean when provided",
    },
  },

  quant_trading_signal_scan: {
    rules: {
      agent_id: (v) =>
        v === undefined || (typeof v === "string" && v.trim().length > 0) ||
        "agent_id must be a non-empty string when provided",
      mode: (v) =>
        v === undefined || ["paper", "live"].includes(String(v).toLowerCase()) ||
        "mode must be paper or live when provided",
      symbols: (v) =>
        v === undefined || (Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === "string")) ||
        "symbols must be a non-empty array of strings when provided",
      timeframe: (v) =>
        v === undefined || (typeof v === "string" && v.trim().length > 0) ||
        "timeframe must be a non-empty string when provided",
      source: (v) =>
        v === undefined || (typeof v === "string" && v.trim().length > 0) ||
        "source must be a non-empty string when provided",
    },
  },

  quant_trading_strategy_run: {
    rules: {
      agent_id: (v) =>
        v === undefined || (typeof v === "string" && v.trim().length > 0) ||
        "agent_id must be a non-empty string when provided",
      symbols: (v) =>
        v === undefined || (Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === "string")) ||
        "symbols must be a non-empty array of strings when provided",
      timeframe: (v) =>
        v === undefined || (typeof v === "string" && v.trim().length > 0) ||
        "timeframe must be a non-empty string when provided",
    },
  },

  quant_trading_execute_orders: {
    rules: {
      agent_id: (v) =>
        v === undefined || (typeof v === "string" && v.trim().length > 0) ||
        "agent_id must be a non-empty string when provided",
      mode: (v) =>
        v === undefined || ["paper", "live"].includes(String(v).toLowerCase()) ||
        "mode must be paper or live when provided",
      confirm_live: (v) =>
        v === undefined || typeof v === "boolean" ||
        "confirm_live must be boolean when provided",
      account_equity_usd: (v) =>
        v === undefined || (typeof v === "number" && v > 0) ||
        "account_equity_usd must be a positive number when provided",
      limit: (v) =>
        v === undefined || (Number.isInteger(v) && v >= 1 && v <= 50) ||
        "limit must be an integer between 1 and 50 when provided",
    },
  },

  quant_trading_close_order: {
    required: ["order_id", "exit_price"],
    rules: {
      order_id: (v) =>
        typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(v) ||
        "order_id must be a valid UUID",
      exit_price: (v) =>
        typeof v === "number" && v > 0 ||
        "exit_price must be a positive number",
      agent_id: (v) =>
        v === undefined || (typeof v === "string" && v.trim().length > 0) ||
        "agent_id must be a non-empty string when provided",
    },
  },

  quant_trading_backtest: {
    rules: {
      agent_id: (v) =>
        v === undefined || (typeof v === "string" && v.trim().length > 0) ||
        "agent_id must be a non-empty string when provided",
      symbol: (v) =>
        v === undefined || (typeof v === "string" && v.trim().length > 0) ||
        "symbol must be a non-empty string when provided",
      timeframe: (v) =>
        v === undefined || (typeof v === "string" && v.trim().length > 0) ||
        "timeframe must be a non-empty string when provided",
      candles: (v) =>
        v === undefined || (Array.isArray(v) && v.every((c) => c && typeof c === "object")) ||
        "candles must be an array of candle objects when provided",
    },
  },

  quant_trading_daily_summary: {
    rules: {
      agent_id: (v) =>
        v === undefined || (typeof v === "string" && v.trim().length > 0) ||
        "agent_id must be a non-empty string when provided",
      metric_date: (v) =>
        v === undefined || (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) ||
        "metric_date must be YYYY-MM-DD when provided",
    },
  },

  quant_trading_pause: {
    rules: {
      agent_id: (v) =>
        v === undefined || (typeof v === "string" && v.trim().length > 0) ||
        "agent_id must be a non-empty string when provided",
      reason: (v) =>
        v === undefined || (typeof v === "string" && v.trim().length > 0) ||
        "reason must be a non-empty string when provided",
      actor: (v) =>
        v === undefined || (typeof v === "string" && v.trim().length > 0) ||
        "actor must be a non-empty string when provided",
    },
  },

  quant_trading_resume: {
    rules: {
      agent_id: (v) =>
        v === undefined || (typeof v === "string" && v.trim().length > 0) ||
        "agent_id must be a non-empty string when provided",
      actor: (v) =>
        v === undefined || (typeof v === "string" && v.trim().length > 0) ||
        "actor must be a non-empty string when provided",
    },
  },

  quant_trading_config_update: {
    rules: {
      agent_id: (v) =>
        v === undefined || (typeof v === "string" && v.trim().length > 0) ||
        "agent_id must be a non-empty string when provided",
      mode: (v) =>
        v === undefined || ["paper", "live"].includes(String(v).toLowerCase()) ||
        "mode must be paper or live when provided",
      risk_per_trade_pct: (v) =>
        v === undefined || (typeof v === "number" && v >= 0.1 && v <= 10) ||
        "risk_per_trade_pct must be a number between 0.1 and 10 when provided",
      max_position_notional_pct: (v) =>
        v === undefined || (typeof v === "number" && v >= 1 && v <= 100) ||
        "max_position_notional_pct must be a number between 1 and 100 when provided",
      daily_loss_limit_pct: (v) =>
        v === undefined || (typeof v === "number" && v >= 0.1 && v <= 50) ||
        "daily_loss_limit_pct must be a number between 0.1 and 50 when provided",
      max_drawdown_pct: (v) =>
        v === undefined || (typeof v === "number" && v >= 0.5 && v <= 90) ||
        "max_drawdown_pct must be a number between 0.5 and 90 when provided",
      allowed_symbols: (v) =>
        v === undefined || (Array.isArray(v) && v.every((s) => typeof s === "string")) ||
        "allowed_symbols must be an array of strings when provided",
    },
  },

  quant_trading_status: {
    rules: {
      agent_id: (v) =>
        v === undefined || (typeof v === "string" && v.trim().length > 0) ||
        "agent_id must be a non-empty string when provided",
    },
  },
  hardware_research_report: {
    required: ["topic"],
    rules: {
      topic: (v) =>
        typeof v === "string" && v.trim().length > 0 ||
        "topic must be a non-empty string",
      reference_files: (v) =>
        v === undefined || (Array.isArray(v) && v.every((x) => typeof x === "string")) ||
        "reference_files must be an array of file paths when provided",
      focus_areas: (v) =>
        v === undefined || (Array.isArray(v) && v.every((x) => typeof x === "string")) ||
        "focus_areas must be an array of strings when provided",
      output_path: (v) =>
        v === undefined || (typeof v === "string" && v.trim().length > 0) ||
        "output_path must be a non-empty string when provided",
      include_web_research: (v) =>
        v === undefined || typeof v === "boolean" ||
        "include_web_research must be boolean when provided",
    },
  },
  security_secrets_scan: {
    rules: {
      no_fail: (v) =>
        v === undefined || typeof v === "boolean" ||
        "no_fail must be boolean when provided",
    },
  },
  security_deps_audit: {
    rules: {
      no_fail: (v) =>
        v === undefined || typeof v === "boolean" ||
        "no_fail must be boolean when provided",
      fail_on: (v) =>
        v === undefined || ["critical", "high", "moderate", "low", "info"].includes(String(v)) ||
        "fail_on must be one of: critical, high, moderate, low, info",
    },
  },
  security_runtime_audit: {
    rules: {
      no_fail: (v) =>
        v === undefined || typeof v === "boolean" ||
        "no_fail must be boolean when provided",
    },
  },
  security_sweep: {
    rules: {
      no_fail: (v) =>
        v === undefined || typeof v === "boolean" ||
        "no_fail must be boolean when provided",
      dep_fail_on: (v) =>
        v === undefined || ["critical", "high", "moderate", "low", "info"].includes(String(v)) ||
        "dep_fail_on must be one of: critical, high, moderate, low, info",
    },
  },

  site_audit: {
    rules: {
      _root: (p) => {
        if (!p.brand && !p.repo && !p.url) {
          return 'site_audit requires one of: { brand }, { repo }, or { url }';
        }
        return true;
      },
      url: (v) =>
        v === undefined || /^https?:\/\//.test(v) ||
        'url must start with http:// or https://',
    },
  },

  site_compare: {
    required: ["pattern"],
    rules: {
      pattern: (v) =>
        typeof v === "string" && v.trim().length > 0 ||
        "pattern must be a non-empty string",
    },
  },

  site_fix_plan: {
    rules: {
      _root: (p) => {
        if (!p.brand && !p.repo) return 'site_fix_plan requires { brand } or { repo }';
        return true;
      },
    },
  },

  site_extract_patterns: {
    required: ["pattern"],
    rules: {
      pattern: (v) =>
        typeof v === "string" && v.trim().length > 0 ||
        "pattern must be a non-empty string",
    },
  },

  opencode_controller: {
    required: ["repo", "objective"],
    rules: {
      repo: (v) =>
        typeof v === "string" && v.trim().length > 0 ||
        "repo must be a non-empty string",
      objective: (v) =>
        typeof v === "string" && v.trim().length > 0 ||
        "objective must be a non-empty string",
      source: (v) =>
        v === undefined || (typeof v === "string" && v.trim().length > 0) ||
        "source must be a non-empty string when provided",
      iteration: (v) =>
        v === undefined || (Number.isInteger(v) && v >= 1 && v <= 10) ||
        "iteration must be an integer between 1 and 10",
      max_iterations: (v) =>
        v === undefined || (Number.isInteger(v) && v >= 1 && v <= 10) ||
        "max_iterations must be an integer between 1 and 10",
      quality_target: (v) =>
        v === undefined || (typeof v === "number" && v >= 1 && v <= 100) ||
        "quality_target must be a number between 1 and 100",
      auto_iterate: (v) =>
        v === undefined || typeof v === "boolean" ||
        "auto_iterate must be boolean when provided",
      force_implement: (v) =>
        v === undefined || typeof v === "boolean" ||
        "force_implement must be boolean when provided",
    },
  },

  repo_index_autopatch: {
    required: ["repo"],
    rules: {
      repo: (v) =>
        typeof v === "string" && v.trim().length > 0 ||
        "repo must be a non-empty string",
      repo_path: (v) =>
        v === undefined || (typeof v === "string" && v.trim().length > 0) ||
        "repo_path must be a non-empty string when provided",
      source: (v) =>
        v === undefined || (typeof v === "string" && v.trim().length > 0) ||
        "source must be a non-empty string when provided",
      reasons: (v) =>
        v === undefined || (Array.isArray(v) && v.every((x) => typeof x === "string")) ||
        "reasons must be an array of strings when provided",
      queue_opencode_after: (v) =>
        v === undefined || typeof v === "boolean" ||
        "queue_opencode_after must be boolean when provided",
      objective: (v) =>
        v === undefined || (typeof v === "string" && v.trim().length > 0) ||
        "objective must be a non-empty string when provided",
      force: (v) =>
        v === undefined || typeof v === "boolean" ||
        "force must be boolean when provided",
    },
  },

  repo_autofix: {
    required: ["repo"],
    rules: {
      repo: (v) =>
        typeof v === "string" && v.trim().length > 0 ||
        "repo must be a non-empty string",
      source: (v) =>
        v === undefined || (typeof v === "string" && v.trim().length > 0) ||
        "source must be a non-empty string when provided",
      reason: (v) =>
        v === undefined || (typeof v === "string" && v.trim().length > 0) ||
        "reason must be a non-empty string when provided",
      checks_failed: (v) =>
        v === undefined || (Array.isArray(v) && v.every((x) => typeof x === "string")) ||
        "checks_failed must be an array of strings when provided",
      pulse_hour: (v) =>
        v === undefined || (typeof v === "string" && v.trim().length > 0) ||
        "pulse_hour must be a non-empty string when provided",
    },
  },

  brand_provision: {
    required: ["brand_id"],
    rules: {
      brand_id: (v) =>
        typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(v) ||
        "brand_id must be a valid UUID",
      requested_by: (v) =>
        v === undefined || (typeof v === "string" && v.trim().length > 0) ||
        "requested_by must be a non-empty string when provided",
      force: (v) =>
        v === undefined || typeof v === "boolean" ||
        "force must be boolean when provided",
    },
  },

  orchestrate: {
    rules: {
      _root: (p) => {
        if (!p.goal || typeof p.goal !== "string" || !p.goal.trim()) {
          return 'orchestrate requires { goal: "non-empty string" }';
        }
        return true;
      },
    },
  },

  openclaw_creator_pack_generate: {
    rules: {
      package_name: (v) =>
        v === undefined || (typeof v === "string" && v.trim().length > 0) ||
        "package_name must be a non-empty string when provided",
      client_name: (v) =>
        v === undefined || (typeof v === "string" && v.trim().length > 0) ||
        "client_name must be a non-empty string when provided",
      output_dir: (v) =>
        v === undefined || (typeof v === "string" && v.trim().length > 0) ||
        "output_dir must be a non-empty string when provided",
      complexity: (v) =>
        v === undefined || ["simple", "standard", "premium"].includes(String(v)) ||
        'complexity must be one of: simple, standard, premium',
      outcome: (v) =>
        v === undefined || (typeof v === "string" && v.trim().length > 0) ||
        "outcome must be a non-empty string when provided",
    },
  },

  dev_pipeline_run: {
    required: ["task"],
    rules: {
      task: (v) =>
        typeof v === "string" && v.trim().length > 0 ||
        "task must be a non-empty string",
      task_slug: (v) =>
        v === undefined || (typeof v === "string" && v.trim().length > 0) ||
        "task_slug must be a non-empty string when provided",
      repo_path: (v) =>
        v === undefined || (typeof v === "string" && v.trim().length > 0) ||
        "repo_path must be a non-empty string when provided",
      base_branch: (v) =>
        v === undefined || (typeof v === "string" && v.trim().length > 0) ||
        "base_branch must be a non-empty string when provided",
      branch_name: (v) =>
        v === undefined || (typeof v === "string" && v.trim().length > 0) ||
        "branch_name must be a non-empty string when provided",
      test_command: (v) =>
        v === undefined || (typeof v === "string" && v.trim().length > 0) ||
        "test_command must be a non-empty string when provided",
      security_command: (v) =>
        v === undefined || (typeof v === "string" && v.trim().length > 0) ||
        "security_command must be a non-empty string when provided",
      dry_run: (v) =>
        v === undefined || typeof v === "boolean" ||
        "dry_run must be boolean when provided",
    },
  },

  security_council: {
    rules: {
      dry_run: (v) =>
        v === undefined || typeof v === "boolean" ||
        "dry_run must be boolean when provided",
      max_files: (v) =>
        v === undefined || (typeof v === "number" && v > 0) ||
        "max_files must be a positive number when provided",
    },
  },

  // Business Intelligence task types — routed via task-routing.js to claw_tasks_ai.
  // Handlers are stubs (standalone PM2 agents, not inline workers).
  // Empty schema: any payload accepted, no required fields.
  business_research: {},
  business_build: {},
  business_update: {},
  business_improve: {},
  business_coordinate: {},
};

const AJV_SCHEMAS = {
  _default: {
    type: "object",
    additionalProperties: true,
  },
  report: { type: "object", required: ["plan_id"], properties: { plan_id: { type: "string", minLength: 1 } }, additionalProperties: true },
  index: { type: "object", required: ["path"], properties: { path: { type: "string", minLength: 1 }, force: { type: "boolean" } }, additionalProperties: true },
  media_detect: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 50000 }, hostname: { type: "string", minLength: 1 } }, additionalProperties: true },
  classify: { type: "object", properties: { path: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 50000 }, force: { type: "boolean" }, low_confidence_threshold: { type: "number", minimum: 0, maximum: 1 }, files: { type: "array", items: { type: "string" } } }, additionalProperties: true },
  dedupe: { type: "object", properties: { clear: { type: "boolean" }, summary: { type: "boolean" } }, additionalProperties: true },
  media_enrich: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 2000 }, hostname: { type: "string", minLength: 1 }, force: { type: "boolean" }, dry_run: { type: "boolean" } }, additionalProperties: true },
  media_hash: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 5000 }, hostname: { type: "string", minLength: 1 }, force: { type: "boolean" }, dry_run: { type: "boolean" }, frame_second: { type: "number", minimum: 0, maximum: 3600 } }, additionalProperties: true },
  media_visual_catalog: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 5000 }, hostname: { type: "string", minLength: 1 }, force: { type: "boolean" }, dry_run: { type: "boolean" }, use_openai_vision: { type: "boolean" } }, additionalProperties: true },
  cluster_media: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 50000 }, hostname: { type: "string", minLength: 1 }, force: { type: "boolean" }, dry_run: { type: "boolean" }, time_window_minutes: { type: "number", minimum: 5, maximum: 1440 }, hash_hamming_threshold: { type: "number", minimum: 0, maximum: 64 }, gps_delta: { type: "number", minimum: 0, maximum: 1 } }, additionalProperties: true },
  resourceful_file_resolve: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 5000 }, hostname: { type: "string", minLength: 1 }, path_prefix: { type: "string", minLength: 1 }, force: { type: "boolean" }, dry_run: { type: "boolean" } }, additionalProperties: true },
  triage: { type: "object", properties: { task_id: { type: "string" }, error: { type: "string" }, context: { type: "object" } }, additionalProperties: true },
  qa_run: { type: "object", required: ["url"], properties: { url: { type: "string", pattern: "^https?://" } }, additionalProperties: true },
  claw_search: { type: "object", required: ["query"], properties: { query: { type: "string", minLength: 1 }, ext: { type: "string" }, min_size_mb: { type: "number" }, max_size_mb: { type: "number" }, limit: { type: "integer", minimum: 1, maximum: 1000 } }, additionalProperties: true },
  qa_pack: { type: "object", required: ["pack"], properties: { pack: { type: "string", minLength: 1 }, url: { type: "string", pattern: "^https?://" } }, additionalProperties: true },
  fetch_content: { type: "object", required: ["brand_slug", "platform", "handle"], properties: { brand_slug: { type: "string", minLength: 1 }, platform: { type: "string", enum: ["youtube", "tiktok", "instagram"] }, handle: { type: "string", minLength: 1 }, max_results: { type: "integer", minimum: 1, maximum: 50 } }, additionalProperties: true },
  analyze_content: { type: "object", required: ["brand_slug"], properties: { brand_slug: { type: "string", minLength: 1 }, platform: { type: "string", enum: ["youtube", "tiktok", "instagram"] }, limit: { type: "integer", minimum: 1 } }, additionalProperties: true },
  generate_copy: { type: "object", required: ["brand_slug", "format"], properties: { brand_slug: { type: "string", minLength: 1 }, format: { type: "string", enum: ["email", "caption", "product_desc"] }, brief: { type: "string" } }, additionalProperties: true },
  aicreator: { type: "object", required: ["brand_slug", "objective"], properties: { brand_slug: { type: "string", minLength: 1 }, objective: { type: "string", minLength: 1 }, output_format: { type: "string", enum: ["email", "caption", "product_desc", "script", "landing_copy"] }, platform: { type: "string", enum: ["youtube", "tiktok", "instagram", "email", "web"] }, audience: { type: "string" }, tone: { type: "string" }, step_count: { type: "integer", minimum: 3, maximum: 10 }, brief: { type: "string" } }, additionalProperties: true },
  copy_research_pack: { type: "object", required: ["brand_slug", "channel", "topic"], properties: { brand_slug: { type: "string", minLength: 1 }, channel: { type: "string", enum: ["email", "sms", "blog", "instagram", "linkedin", "push_notification"] }, topic: { type: "string", minLength: 1 }, target_audience: { type: "string" }, tone: { type: "string" }, goal: { type: "string" }, notebook_context: { type: "string" }, sources: { type: "array", items: { type: "string" } }, persist_brief: { type: "boolean" } }, additionalProperties: true },
  copy_critique: { type: "object", required: ["brand_slug", "channel", "draft_text"], properties: { brand_slug: { type: "string", minLength: 1 }, channel: { type: "string", enum: ["email", "sms", "blog", "instagram", "linkedin", "push_notification"] }, draft_id: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" }, topic: { type: "string" }, target_audience: { type: "string" }, tone: { type: "string" }, goal: { type: "string" }, draft_text: { type: "string", minLength: 20 }, rubric: { type: "string" } }, additionalProperties: true },
  copy_improve: { type: "object", required: ["brand_slug", "channel", "draft_text", "critique"], properties: { brand_slug: { type: "string", minLength: 1 }, channel: { type: "string", enum: ["email", "sms", "blog", "instagram", "linkedin", "push_notification"] }, draft_id: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" }, topic: { type: "string" }, target_audience: { type: "string" }, tone: { type: "string" }, goal: { type: "string" }, draft_text: { type: "string", minLength: 20 }, critique: { oneOf: [{ type: "string" }, { type: "object" }] }, iteration: { type: "integer", minimum: 1, maximum: 5 } }, additionalProperties: true },
  copy_lab_run: { type: "object", required: ["brand_slug", "channel", "topic"], properties: { brand_slug: { type: "string", minLength: 1 }, channel: { type: "string", enum: ["email", "sms", "blog", "instagram", "linkedin", "push_notification"] }, topic: { type: "string", minLength: 1 }, target_audience: { type: "string" }, tone: { type: "string" }, goal: { type: "string" }, notebook_context: { type: "string" }, sources: { type: "array", items: { type: "string" } }, iterations: { type: "integer", minimum: 1, maximum: 3 }, persist_brief: { type: "boolean" } }, additionalProperties: true },
  website_content_generator: { type: "object", required: ["brand_slug", "market", "objective", "industry", "page_type"], properties: { brand_slug: { type: "string", minLength: 1 }, market: { type: "string", minLength: 1 }, objective: { type: "string", minLength: 1 }, industry: { type: "string", enum: ["health_brand", "saas", "general"] }, page_type: { type: "string", enum: ["homepage", "landing_page", "service_page", "product_page"] }, target_audience: { type: "string" }, tone: { type: "string" }, reading_level: { type: "string" }, primary_keyword: { type: "string" }, secondary_keywords: { type: "array", items: { type: "string" } }, competitors: { type: "array", items: { type: "string" } }, compliance_region: { type: "string" }, notebook_context: { type: "string" }, sources: { type: "array", items: { type: "string" } } }, additionalProperties: true },
  social_media_copywriter: { type: "object", required: ["brand_slug", "platform", "topic"], properties: { brand_slug: { type: "string", minLength: 1 }, platform: { type: "string", enum: ["instagram", "x", "linkedin", "tiktok", "facebook"] }, topic: { type: "string", minLength: 1 }, objective: { type: "string" }, tone: { type: "string" }, target_audience: { type: "string" }, primary_keyword: { type: "string" }, compliance_mode: { type: "string", enum: ["standard", "health_brand", "saas"] }, variations: { type: "integer", minimum: 1, maximum: 5 }, website_context: { type: "string" } }, additionalProperties: true },
  fetch_leads: { type: "object", required: ["brand_slug", "category", "location"], properties: { brand_slug: { type: "string", minLength: 1 }, category: { type: "string", minLength: 1 }, location: { type: "string", minLength: 1 }, radius_m: { type: "number", minimum: 1, maximum: 100000 } }, additionalProperties: true },
  send_email: { type: "object", required: ["brand_slug", "lead_id", "template"], properties: { brand_slug: { type: "string", minLength: 1 }, lead_id: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" }, template: { type: "string", minLength: 1 }, subject: { type: "string" } }, additionalProperties: true },
  loyalty_webhook_ingest: { type: "object", required: ["provider", "event_type"], properties: { provider: { type: "string", minLength: 1 }, event_type: { type: "string", minLength: 1 }, payload: { type: "object" } }, additionalProperties: true },
  loyalty_process_webhooks: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 10000 } }, additionalProperties: true },
  loyalty_send_outreach: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 10000 }, channel: { type: "string", enum: ["email", "sms", "wallet_pass"] } }, additionalProperties: true },
  loyalty_maintenance: { type: "object", properties: { webhook_limit: { type: "integer", minimum: 1, maximum: 10000 }, outreach_limit: { type: "integer", minimum: 1, maximum: 10000 } }, additionalProperties: true },
  github_repo_audit: { type: "object", properties: { repo_ids: { type: "array", items: { type: "string" } }, all: { type: "boolean" } }, additionalProperties: true },
  github_observability_scan: { type: "object", properties: { repos: { type: "array", items: { type: "string" } }, save: { type: "boolean" } }, additionalProperties: true },
  research_sync: { type: "object", properties: { dry_run: { type: "boolean" } }, additionalProperties: true },
  research_signals: { type: "object", properties: { dry_run: { type: "boolean" } }, additionalProperties: true },
  platform_health_report: { type: "object", properties: { dry_run: { type: "boolean" } }, additionalProperties: true },
  affiliate_research: { type: "object", properties: { host: { type: "string", minLength: 1 }, limit: { type: "integer", minimum: 1, maximum: 200 }, dry_run: { type: "boolean" } }, additionalProperties: true },
  subscription_audit_run: { type: "object", properties: { days_back: { type: "integer", minimum: 30, maximum: 730 }, max_email_scan: { type: "integer", minimum: 10, maximum: 500 }, dry_run: { type: "boolean" } }, additionalProperties: true },
  tax_prep_automation_run: { type: "object", properties: { year: { type: "integer", minimum: 2000, maximum: 2100 }, days_back: { type: "integer", minimum: 30, maximum: 730 }, dry_run: { type: "boolean" } }, additionalProperties: true },
  quant_trading_signal_scan: { type: "object", properties: { agent_id: { type: "string", minLength: 1 }, mode: { type: "string", enum: ["paper", "live"] }, symbols: { type: "array", minItems: 1, items: { type: "string" } }, timeframe: { type: "string", minLength: 1 }, source: { type: "string", minLength: 1 } }, additionalProperties: true },
  quant_trading_strategy_run: { type: "object", properties: { agent_id: { type: "string", minLength: 1 }, symbols: { type: "array", minItems: 1, items: { type: "string" } }, timeframe: { type: "string", minLength: 1 } }, additionalProperties: true },
  quant_trading_execute_orders: { type: "object", properties: { agent_id: { type: "string", minLength: 1 }, mode: { type: "string", enum: ["paper", "live"] }, confirm_live: { type: "boolean" }, account_equity_usd: { type: "number", exclusiveMinimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 50 } }, additionalProperties: true },
  quant_trading_close_order: { type: "object", required: ["order_id", "exit_price"], properties: { agent_id: { type: "string", minLength: 1 }, order_id: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" }, exit_price: { type: "number", exclusiveMinimum: 0 } }, additionalProperties: true },
  quant_trading_backtest: { type: "object", properties: { agent_id: { type: "string", minLength: 1 }, symbol: { type: "string", minLength: 1 }, timeframe: { type: "string", minLength: 1 }, candles: { type: "array", items: { type: "object" } } }, additionalProperties: true },
  quant_trading_daily_summary: { type: "object", properties: { agent_id: { type: "string", minLength: 1 }, metric_date: { type: "string", minLength: 10, maxLength: 10 } }, additionalProperties: true },
  quant_trading_pause: { type: "object", properties: { agent_id: { type: "string", minLength: 1 }, reason: { type: "string", minLength: 1 }, actor: { type: "string", minLength: 1 } }, additionalProperties: true },
  quant_trading_resume: { type: "object", properties: { agent_id: { type: "string", minLength: 1 }, actor: { type: "string", minLength: 1 } }, additionalProperties: true },
  quant_trading_config_update: { type: "object", properties: { agent_id: { type: "string", minLength: 1 }, mode: { type: "string", enum: ["paper", "live"] }, risk_per_trade_pct: { type: "number", minimum: 0.1, maximum: 10 }, max_position_notional_pct: { type: "number", minimum: 1, maximum: 100 }, daily_loss_limit_pct: { type: "number", minimum: 0.1, maximum: 50 }, max_drawdown_pct: { type: "number", minimum: 0.5, maximum: 90 }, allowed_symbols: { type: "array", items: { type: "string" } } }, additionalProperties: true },
  quant_trading_status: { type: "object", properties: { agent_id: { type: "string", minLength: 1 } }, additionalProperties: true },
  hardware_research_report: { type: "object", required: ["topic"], properties: { topic: { type: "string", minLength: 1 }, reference_files: { type: "array", items: { type: "string" } }, focus_areas: { type: "array", items: { type: "string" } }, output_path: { type: "string", minLength: 1 }, include_web_research: { type: "boolean" }, budget_target_usd: { type: "number", minimum: 0 } }, additionalProperties: true },
  security_secrets_scan: { type: "object", properties: { no_fail: { type: "boolean" } }, additionalProperties: true },
  security_deps_audit: { type: "object", properties: { no_fail: { type: "boolean" }, fail_on: { type: "string", enum: ["critical", "high", "moderate", "low", "info"] } }, additionalProperties: true },
  security_runtime_audit: { type: "object", properties: { no_fail: { type: "boolean" } }, additionalProperties: true },
  security_sweep: { type: "object", properties: { no_fail: { type: "boolean" }, dep_fail_on: { type: "string", enum: ["critical", "high", "moderate", "low", "info"] } }, additionalProperties: true },
  site_audit: { type: "object", properties: { brand: { type: "string" }, repo: { type: "string" }, url: { type: "string", pattern: "^https?://" }, depth: { type: "integer", minimum: 1, maximum: 10 } }, additionalProperties: true },
  site_compare: { type: "object", required: ["pattern"], properties: { pattern: { type: "string", minLength: 1 } }, additionalProperties: true },
  site_fix_plan: { type: "object", properties: { brand: { type: "string" }, repo: { type: "string" } }, additionalProperties: true },
  site_extract_patterns: { type: "object", required: ["pattern"], properties: { pattern: { type: "string", minLength: 1 } }, additionalProperties: true },
  opencode_controller: { type: "object", required: ["repo", "objective"], properties: { repo: { type: "string", minLength: 1 }, objective: { type: "string", minLength: 1 }, source: { type: "string" }, iteration: { type: "integer", minimum: 1, maximum: 10 }, max_iterations: { type: "integer", minimum: 1, maximum: 10 }, quality_target: { type: "number", minimum: 1, maximum: 100 }, auto_iterate: { type: "boolean" }, force_implement: { type: "boolean" } }, additionalProperties: true },
  repo_index_autopatch: { type: "object", required: ["repo"], properties: { repo: { type: "string", minLength: 1 }, repo_path: { type: "string" }, source: { type: "string" }, reasons: { type: "array", items: { type: "string" } }, queue_opencode_after: { type: "boolean" }, objective: { type: "string" }, force: { type: "boolean" } }, additionalProperties: true },
  repo_autofix: { type: "object", required: ["repo"], properties: { repo: { type: "string", minLength: 1 }, source: { type: "string" }, reason: { type: "string" }, checks_failed: { type: "array", items: { type: "string" } }, pulse_hour: { type: "string" } }, additionalProperties: true },
  brand_provision: { type: "object", required: ["brand_id"], properties: { brand_id: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" }, requested_by: { type: "string" }, force: { type: "boolean" } }, additionalProperties: true },
  github_add_repo: { type: "object", required: ["repo_url"], properties: { repo_url: { type: "string", pattern: "^(https?://|git@)" }, client_name: { type: "string" }, branch: { type: "string", minLength: 1 }, notes: { type: "string" } }, additionalProperties: true },
  orchestrate: { type: "object", required: ["goal"], properties: { goal: { type: "string", minLength: 1 }, context: { type: "object" }, dry_run: { type: "boolean" } }, additionalProperties: true },
  openclaw_creator_pack_generate: { type: "object", properties: { package_name: { type: "string", minLength: 1 }, client_name: { type: "string", minLength: 1 }, output_dir: { type: "string", minLength: 1 }, complexity: { type: "string", enum: ["simple", "standard", "premium"] }, outcome: { type: "string", minLength: 1 } }, additionalProperties: true },
  dev_pipeline_run: { type: "object", required: ["task"], properties: { task: { type: "string", minLength: 1 }, task_slug: { type: "string", minLength: 1 }, repo_path: { type: "string", minLength: 1 }, base_branch: { type: "string", minLength: 1 }, branch_name: { type: "string", minLength: 1 }, test_command: { type: "string", minLength: 1 }, security_command: { type: "string", minLength: 1 }, dry_run: { type: "boolean" } }, additionalProperties: true },
};

const AJV_VALIDATORS = new Map();
for (const [type, schema] of Object.entries(AJV_SCHEMAS)) {
  AJV_VALIDATORS.set(type, ajv.compile(schema));
}

/**
 * Validate a task payload against its schema.
 * @param {string} type - task type
 * @param {object} payload - task payload
 * @throws {Error} with a clear message if validation fails
 */
function validatePayload(type, payload) {
  if (payload == null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`INVALID_SCHEMA: task "${type}" payload must be an object`);
  }

  const ajvValidator = AJV_VALIDATORS.get(type) || AJV_VALIDATORS.get("_default");
  if (ajvValidator && !ajvValidator(payload)) {
    const detail = (ajvValidator.errors || [])
      .map((e) => `${e.instancePath || "/"} ${e.message}`)
      .join("; ");
    throw new Error(`INVALID_SCHEMA: ${detail}`);
  }

  const schema = SCHEMAS[type];
  if (!schema) {
    // Unknown types are caught by planner via shared task capabilities (task-routing).
    return;
  }

  const p = payload || {};

  // Check required fields
  for (const field of schema.required || []) {
    if (p[field] === undefined || p[field] === null || p[field] === "") {
      throw new Error(
        `Task type "${type}" is missing required payload field: "${field}"`
      );
    }
  }

  // Run field-level rules
  for (const [field, ruleFn] of Object.entries(schema.rules || {})) {
    // _root is a whole-payload check
    const val    = field === "_root" ? p : p[field];
    const result = ruleFn(val);
    if (result !== true) {
      throw new Error(`Task type "${type}" payload error — ${result}`);
    }
  }
}

module.exports = { validatePayload, SCHEMAS };
