#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const os = require("os");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const pg = require("../infra/postgres");
const { resolveRouting, isKnownTaskType } = require("../config/task-routing");
const { validatePayload } = require("../schemas/payloads");
const { buildTaskIdempotencyKey } = require("../control/idempotency");

const ROOT = path.join(__dirname, "..");
const REPORT_DIR = path.join(ROOT, "reports");
const INDEX_DIR = path.join(process.env.HOME || os.homedir(), ".code-index");
const ACTIVE_STATUSES = ["CREATED", "DISPATCHED", "RUNNING", "RETRY", "PENDING_APPROVAL"];

function arg(flag, fallback = null) {
  const args = process.argv.slice(2);
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
}

function has(flag) {
  return process.argv.slice(2).includes(flag);
}

function safeReadJson(fp) {
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    return null;
  }
}

function loadIndex(repoKey) {
  const fp = path.join(INDEX_DIR, `${String(repoKey || "").replace(/\//g, "-")}.json`);
  return safeReadJson(fp);
}

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9_./ -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text) {
  return normalize(text)
    .split(" ")
    .filter((x) => x.length >= 3)
    .slice(0, 24);
}

function scoreSymbol(sym, tokens) {
  const hay = normalize([
    sym.name,
    sym.qualified_name,
    sym.signature,
    sym.summary,
    sym.docstring,
    sym.file,
  ].filter(Boolean).join(" "));
  let score = 0;
  for (const t of tokens) {
    if (hay.includes(t)) score += 1;
  }
  return score;
}

function topSymbols(repoKey, queries, limit = 6) {
  const index = loadIndex(repoKey);
  if (!index || !Array.isArray(index.symbols)) return [];
  const tokens = tokenize((queries || []).join(" "));
  if (!tokens.length) return [];
  return index.symbols
    .map((s) => ({ symbol: s, score: scoreSymbol(s, tokens) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => ({
      id: x.symbol.id,
      file: x.symbol.file,
      name: x.symbol.name,
      line: x.symbol.line,
      score: x.score,
    }));
}

async function taskExists(idempotencyKey) {
  const { rows } = await pg.query(
    `SELECT 1
       FROM tasks
      WHERE idempotency_key = $1
        AND status = ANY($2::text[])
      LIMIT 1`,
    [idempotencyKey, ACTIVE_STATUSES]
  );
  return rows.length > 0;
}

async function createTaskIfNeeded(type, payload, priority = 9, dryRun = false) {
  if (!isKnownTaskType(type)) throw new Error(`Unknown task type: ${type}`);
  validatePayload(type, payload || {});
  const idempotencyKey = buildTaskIdempotencyKey(type, payload || {});

  if (dryRun) {
    return { created: true, dry_run: true, type, idempotencyKey, payload };
  }

  if (await taskExists(idempotencyKey)) {
    return { created: false, reason: "duplicate_active", type, idempotencyKey };
  }

  const routing = resolveRouting(type);
  const id = uuidv4();
  await pg.query(
    `INSERT INTO tasks (
      id, type, payload, status, priority, worker_queue, required_tags, idempotency_key
    ) VALUES ($1,$2,$3::jsonb,'CREATED',$4,$5,$6,$7)`,
    [id, type, JSON.stringify(payload || {}), priority, routing.queue, routing.required_tags, idempotencyKey]
  );
  await pg.query(`SELECT pg_notify('task_created', $1)`, [id]).catch(() => {});
  return { created: true, id, type, idempotencyKey };
}

function buildSystems() {
  const payclawRepo = "local/payclaw";
  const gocrawdaddyRepo = "local/gocrawdaddy";
  return [
    {
      id: "payclaw_lane_shipping",
      lane: "payclaw",
      summary: "PayClaw lane execution started but not shipping",
      compareRepos: ["local/autopay_ui", "local/payclaw", "local/CaptureInbound", "local/CookiesPass"],
      queries: ["stripe webhook checkout telnyx sms connect account-link invoice dashboard"],
      tasks: [
        { type: "opencode_controller", source: "payclaw_chunk_sms", repo: payclawRepo, objective: "Complete SMS lane with evidence: commit SHA + changed files + smoke proof. Compare against local/autopay_ui and local/CaptureInbound for canonical symbols." },
        { type: "opencode_controller", source: "payclaw_chunk_stripe", repo: payclawRepo, objective: "Complete Stripe lane (connect onboarding, checkout, webhook status updates) with evidence artifacts. Reuse best symbols from local/autopay_ui." },
        { type: "opencode_controller", source: "payclaw_chunk_api", repo: payclawRepo, objective: "Complete server endpoint lane for PayClaw routes and signatures. Produce test commands and passing output in artifact." },
        { type: "opencode_controller", source: "payclaw_chunk_dashboard", repo: payclawRepo, objective: "Complete dashboard lane (upload/manual invoice entry + status summary + audit views) with evidence and screenshots/artifacts." },
        { type: "opencode_controller", source: "payclaw_chunk_mac_shell", repo: payclawRepo, objective: "Complete mac shell + launchagent embedding lane, with packaging runbook evidence and build artifact path." },
        { type: "opencode_controller", source: "payclaw_chunk_compliance", repo: payclawRepo, objective: "Complete compliance lane (risk categories, locked templates, attestations, guardrails) with tests proving enforcement." },
      ],
    },
    {
      id: "gocrawdaddy_lane_activation",
      lane: "gocrawdaddy",
      summary: "GoCrawdaddy lane defined but idle",
      compareRepos: ["local/openclaw", "local/trigger.dev", "local/bullmq", "local/temporal", "local/langgraph"],
      queries: ["launch queue workflow runbook deploy health dashboard onboarding"],
      tasks: [
        { type: "research_sync", source: "gocrawdaddy_launch", payload: { system: "gocrawdaddy", host: "vps" } },
        { type: "research_signals", source: "gocrawdaddy_launch", payload: { system: "gocrawdaddy", lane: "launch" } },
        { type: "affiliate_research", source: "gocrawdaddy_launch", payload: { host: "vps", limit: 30 } },
        { type: "opencode_controller", source: "gocrawdaddy_launch", repo: gocrawdaddyRepo, objective: "Activate GoCrawdaddy MVP lane from scaffold to shipping checklist completion with evidence-gated outputs." },
      ],
    },
    {
      id: "indexing_closure",
      lane: "shared",
      summary: "Repo readiness detects issues but closure loop is weak",
      compareRepos: ["local/openclaw", "local/autogen", "local/crewAI"],
      queries: ["index freshness repomap remediation queue closure"],
      tasks: [
        { type: "repo_index_autopatch", source: "finish_fast_indexing", repo: "local/claw-architect", objective: "Make repo-readiness pulse auto-queue and auto-close remediations; remove dry-run drift." },
        { type: "opencode_controller", source: "finish_fast_indexing", repo: "local/claw-architect", objective: "Implement close-the-loop readiness remediation with evidence, trend deltas, and failure alerts." },
        { type: "opencode_controller", source: "finish_fast_indexing", repo: "local/claw-architect", objective: "Add stale-remediation watchdog that verifies queueing and completion for below-threshold repos." },
      ],
    },
    {
      id: "task_governor_backlog",
      lane: "shared",
      summary: "Task governor catches issues but backlog/concurrency pressure remains",
      compareRepos: ["local/bullmq", "local/temporal", "local/go-kit__kit"],
      queries: ["backpressure rate limit queue cap stale created retry budget"],
      tasks: [
        { type: "opencode_controller", source: "task_governor_finish_fast", repo: "local/claw-architect", objective: "Reduce stale_created and opencode backlog pressure with adaptive lane caps, per-lane concurrency guardrails, and measured KPI drop." },
        { type: "opencode_controller", source: "task_governor_finish_fast", repo: "local/claw-architect", objective: "Implement queue pressure routing for ai/io/cpu lanes and prove active_backlog reduction with before/after report." },
        { type: "opencode_controller", source: "task_governor_finish_fast", repo: "local/claw-architect", objective: "Add hard anti-loop governance for repeated opencode_controller stale tasks with quarantine + unblock tasks." },
      ],
    },
    {
      id: "symbol_powerups_finish",
      lane: "shared",
      summary: "Symbol powerups unfinished (duplicate suppression remains)",
      compareRepos: ["local/openclaw", "local/langgraph", "local/semantic-kernel"],
      queries: ["canonical symbol dedupe duplicate suppression ownership map"],
      tasks: [
        { type: "opencode_controller", source: "symbol_powerups_finish", repo: "local/claw-architect", objective: "Implement duplicate implementation suppression across indexed repos and enforce canonical symbol ownership hints in context packs." },
        { type: "opencode_controller", source: "symbol_powerups_finish", repo: "local/claw-architect", objective: "Enforce canonical-path recommendation in dispatcher payload enrichment and emit drift alerts when duplicate purpose symbols diverge." },
      ],
    },
    {
      id: "symbolic_qa_productize",
      lane: "shared",
      summary: "Symbolic QA exists but not fully productized",
      compareRepos: ["local/playwright", "local/cypress", "local/webdriverio", "local/BackstopJS", "local/testcafe"],
      queries: ["network contract trace replay cdp selector resilience stability"],
      tasks: [
        { type: "opencode_controller", source: "symbolic_qa_productize", repo: "local/claw-architect", objective: "Implement CDP/network-contract probes in symbolic QA path with targeted repro tasks before full browser flow." },
        { type: "opencode_controller", source: "symbolic_qa_productize", repo: "local/quantfusion", objective: "Apply symbolic QA playbooks to quantfusion critical flows and emit repair tasks from failure-to-symbol mapping." },
        { type: "opencode_controller", source: "symbolic_qa_productize", repo: "local/payclaw", objective: "Apply symbolic QA contracts to payclaw payment/webhook/sms critical paths with actionable repair routing." },
      ],
    },
    {
      id: "quantfusion_production_path",
      lane: "shared",
      summary: "QuantFusion operational in paper mode but needs production path",
      compareRepos: ["local/temporal", "local/k6", "local/ollama"],
      queries: ["live gate risk proof strategy validation safety rollout"],
      tasks: [
        { type: "opencode_controller", source: "quantfusion_prod_path", repo: "local/quantfusion", objective: "Build production-grade rollout gating from paper to live with explicit safety proofs and staged approval checks." },
        { type: "quant_trading_backtest", source: "quantfusion_prod_path", payload: { agent_id: "quantfusion_core", symbol: "SPY", timeframe: "5m" } },
        { type: "quant_trading_daily_summary", source: "quantfusion_prod_path", payload: { agent_id: "quantfusion_core" } },
      ],
    },
    {
      id: "offgrid_pattern_pack_maturity",
      lane: "shared",
      summary: "Offgrid pattern-pack auto-apply needs reliability scoring and ingestion depth",
      compareRepos: ["home-assistant/core", "local/zigbee2mqtt", "local/diyHue", "local/homebridge-hue"],
      queries: ["pattern pack offline reliability zigbee rejoin fallback automation scoring"],
      tasks: [
        { type: "opencode_controller", source: "offgrid_hue_pattern_pack", repo: "local/claw-architect", objective: "Harden offgrid pattern-pack apply flow with reliability scoring, evidence artifacts, and idempotent task creation." },
        { type: "opencode_controller", source: "offgrid_hue_pattern_pack", repo: "local/claw-architect", objective: "Add ingestion of indexed offgrid OSS symbol exemplars into pattern recommendations with confidence/risk score." },
        { type: "opencode_controller", source: "offgrid_hue_pattern_pack", repo: "local/claw-architect", objective: "Implement offline fallback verification checks for local bridge emulation, Zigbee rejoin, and automation failover." },
      ],
    },
  ];
}

function buildPayload(task, system, symbolHints) {
  const baseEvidence = [
    "git_commit_sha",
    "changed_files_diffstat",
    "passing_test_command_output",
    "artifact_path",
  ];

  if (task.type === "opencode_controller") {
    return {
      repo: task.repo,
      source: task.source,
      objective: task.objective,
      force_implement: true,
      auto_iterate: true,
      max_iterations: 3,
      quality_target: 85,
      evidence_required: baseEvidence,
      compare_repos: system.compareRepos,
      symbol_hints: symbolHints,
      finish_fast_system: system.id,
    };
  }

  const payload = {
    ...(task.payload || {}),
    ...(task.repo ? { repo: task.repo } : {}),
    ...(task.objective ? { objective: task.objective } : {}),
    source: task.source,
    finish_fast_system: system.id,
    compare_repos: system.compareRepos,
    symbol_hints: symbolHints,
    evidence_required: baseEvidence,
  };
  return payload;
}

function writeReport(report) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[.:]/g, "-");
  const jsonPath = path.join(REPORT_DIR, `${stamp}-finish-fast-matrix.json`);
  const latestPath = path.join(REPORT_DIR, "finish-fast-matrix-latest.json");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(latestPath, JSON.stringify(report, null, 2));
  return { jsonPath, latestPath };
}

async function main() {
  const dryRun = has("--dry-run");
  const maxTasksPerSystem = Math.max(1, Number(arg("--max-tasks-per-system", "3")) || 3);
  const systems = buildSystems();
  const results = [];
  let queuedTotal = 0;
  let createdTotal = 0;
  let duplicateTotal = 0;

  for (const system of systems) {
    const hintsByRepo = {};
    for (const repo of system.compareRepos) {
      hintsByRepo[repo] = topSymbols(repo, system.queries, 6);
    }
    const mergedHints = Object.entries(hintsByRepo)
      .flatMap(([repo, syms]) => syms.map((s) => ({ repo, ...s })))
      .slice(0, 12);

    const taskResults = [];
    for (const task of system.tasks.slice(0, maxTasksPerSystem)) {
      const payload = buildPayload(task, system, mergedHints);
      const out = await createTaskIfNeeded(task.type, payload, 9, dryRun);
      taskResults.push({
        type: task.type,
        source: task.source,
        payload_preview: {
          repo: payload.repo,
          source: payload.source,
          objective: payload.objective,
          finish_fast_system: payload.finish_fast_system,
        },
        queue_result: out,
      });
      queuedTotal += 1;
      if (out.created) createdTotal += 1;
      if (!out.created && out.reason === "duplicate_active") duplicateTotal += 1;
    }

    results.push({
      id: system.id,
      lane: system.lane,
      summary: system.summary,
      compare_repos: system.compareRepos,
      symbol_hints_by_repo: hintsByRepo,
      queued_tasks: taskResults,
    });
  }

  const report = {
    ok: true,
    generated_at: new Date().toISOString(),
    dry_run: dryRun,
    max_tasks_per_system: maxTasksPerSystem,
    totals: {
      systems: systems.length,
      tasks_considered: queuedTotal,
      tasks_created: createdTotal,
      duplicates_skipped: duplicateTotal,
    },
    systems: results,
  };

  const output = writeReport(report);
  console.log(JSON.stringify({ ...report.totals, report: output }, null, 2));
}

main().catch((err) => {
  console.error("[finish-fast-matrix] fatal:", err.message || String(err));
  process.exit(1);
});
