#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { appendAgentDailyLog, extractTextMetrics, buildLearnedFromText } = require("../control/agent-memory");
const { preRunGate, evaluateAndRecordRunIntegrity } = require("../control/management-integrity");
const { logIntegrityEvent } = require("../control/integrity-events");
const { runRunnerPreflight } = require("../control/runner-preflight");

const ROOT = path.join(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "config", "status-review-agents.json");
const REPORT_DIR = path.join(ROOT, "scripts", "reports");

function readJsonSafe(filePath) {
  if (!filePath) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function parseTrailingJson(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  for (let i = raw.indexOf("{"); i >= 0; i = raw.indexOf("{", i + 1)) {
    const candidate = raw.slice(i);
    try {
      return JSON.parse(candidate);
    } catch {
      // keep scanning
    }
  }
  return null;
}

function summarizeKnownOutcome(obj) {
  if (!obj || typeof obj !== "object") return null;
  const parts = [];
  if (obj.ok != null) parts.push(`ok=${Boolean(obj.ok)}`);
  if (obj.migrations_applied != null) parts.push(`migrations=${Number(obj.migrations_applied) || 0}`);
  if (obj.foreign_keys_added != null) parts.push(`fks=${Number(obj.foreign_keys_added) || 0}`);
  if (obj.ensureschema_fixed != null) parts.push(`ensureschema=${Number(obj.ensureschema_fixed) || 0}`);
  if (obj.security_fixes != null) parts.push(`security=${Number(obj.security_fixes) || 0}`);
  if (obj.restart_rate != null) parts.push(`restarts=${Number(obj.restart_rate) || 0}`);
  if (obj.uptime_pct != null) parts.push(`uptime=${Number(obj.uptime_pct) || 0}%`);
  if (obj.fixes_applied != null) parts.push(`fixes=${Number(obj.fixes_applied) || 0}`);
  if (obj.issues_found != null) parts.push(`issues=${Number(obj.issues_found) || 0}`);
  if (obj.blockers != null) parts.push(`blockers=${Number(obj.blockers) || 0}`);
  return parts.length ? parts.join(" | ") : null;
}

function buildOutcomeWriteback(out, agentId = "") {
  const logSources = [out.stdout_tail, out.stderr_tail].filter(Boolean).join("\n");

  // --- Layer 1: Try structured JSON from stdout/stderr (best case) ---
  const trailing = parseTrailingJson(logSources);
  const trailingSummary = summarizeKnownOutcome(trailing);
  let reportSummary = null;
  const reportLatest = trailing?.report?.latestPath ? readJsonSafe(trailing.report.latestPath) : null;
  if (reportLatest && typeof reportLatest === "object") {
    reportSummary = summarizeKnownOutcome(reportLatest);
  }

  // --- Layer 2: Regex-based metric extraction from plain text ---
  const textExtract = extractTextMetrics(out.stdout_tail || "", out.stderr_tail || "");

  // Build summary line — prefer JSON, fall back to text metrics
  const metricLine = trailingSummary || reportSummary || textExtract.summary_line || null;
  const summary = [
    `status=${out.ok ? "ok" : "fail"}`,
    `code=${out.code}`,
    `dry_run=${Boolean(out.dry_run)}`,
    metricLine ? `task=${metricLine}` : null,
  ].filter(Boolean).join(" | ");

  // Build learned — prefer JSON summary, then text extraction, then raw output
  let learned;
  if (!out.ok) {
    // Failure: capture the actual error
    const errText = (out.stderr_tail || out.stdout_tail || "").slice(0, 400).trim();
    learned = errText || "Command failed; no output captured.";
  } else if (trailingSummary || reportSummary) {
    learned = trailingSummary || reportSummary;
  } else {
    learned = buildLearnedFromText(out.stdout_tail || "", out.stderr_tail || "", agentId);
  }

  // Extract metrics object for structured storage
  const metrics = Object.keys(textExtract.metrics).length > 0 ? textExtract.metrics : undefined;

  // Build tags from agent name keywords
  const agentTags = agentId.split("_").filter((t) => t.length > 2);

  // Open loops
  const openLoops = [];
  if (out.ok && !trailingSummary && !reportSummary && !textExtract.meaningful) {
    openLoops.push("Script emits no structured outcome (JSON or key metrics). Add writeback for compounding memory.");
  }
  if (!out.ok) {
    openLoops.push("Inspect status-review latest report stderr and patch failing command.");
  }

  // Next focus hint based on outcome
  let next_focus;
  if (!out.ok) next_focus = "Fix failing command before next run";
  else if (openLoops.length > 0) next_focus = "Add JSON outcome writeback to script";

  return { summary, learned, metrics, openLoops, tags: agentTags, next_focus };
}

function arg(flag, fallback = null) {
  const args = process.argv.slice(2);
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
}

function has(flag) {
  return process.argv.slice(2).includes(flag);
}

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

function runCommand(line, timeoutMs) {
  const res = spawnSync("bash", ["-lc", line], {
    cwd: ROOT,
    env: { ...process.env, CI: "1" },
    encoding: "utf8",
    timeout: timeoutMs,
  });
  return {
    ok: Number(res.status || 0) === 0,
    code: Number(res.status || 0),
    stdout_tail: String(res.stdout || "").slice(-2000),
    stderr_tail: String(res.stderr || "").slice(-2000),
    duration_ms: Number(res.signal ? timeoutMs : 0) || undefined,
  };
}

async function main() {
  const agentId = String(arg("--agent", "")).trim().toLowerCase();
  const dryRun = has("--dry-run");
  const skipCoordination = has("--skip-coordination");
  const timeoutMs = Math.max(30_000, Number(arg("--timeout-ms", "900000")) || 900000);
  if (!agentId) throw new Error("--agent is required");

  const preflight = runRunnerPreflight({
    syntaxTargets: [
      "scripts/mission-control-agent-runner.js",
      "scripts/status-review-agent-runner.js",
      "infra/model-router.js",
      "config/status-review-agents.json",
    ],
  });
  if (!preflight.ok) {
    const blocked = {
      generated_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      agent_id: agentId,
      dry_run: dryRun,
      ok: false,
      code: 76,
      stdout_tail: "",
      stderr_tail: "Preflight failed: merge conflict markers or syntax errors detected; runner hard-failed.",
      preflight,
      integrity: {
        status: "BLOCKED",
        fail_closed: true,
        reasons: ["RUNNER_PREFLIGHT_FAILED"],
      },
    };
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    const stampBlocked = Date.now();
    const jsonBlocked = path.join(REPORT_DIR, `${stampBlocked}-status-review-${agentId}.json`);
    const latestBlocked = path.join(REPORT_DIR, `status-review-${agentId}-latest.json`);
    fs.writeFileSync(jsonBlocked, JSON.stringify(blocked, null, 2));
    fs.writeFileSync(latestBlocked, JSON.stringify(blocked, null, 2));
    console.error(`[status-review] preflight failed for ${agentId}`);
    console.error(JSON.stringify(preflight, null, 2));
    return 2;
  }

  const config = loadConfig();
  const agent = config.find((a) => String(a.id).toLowerCase() === agentId);
  if (!agent) throw new Error(`Unknown status-review agent: ${agentId}`);
  const preGate = preRunGate({ runnerType: "status_review", agentId, agent, dryRun });
  if (preGate.blocked) {
    const blocked = {
      generated_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      agent_id: agentId,
      agent_name: agent.name,
      command: String(agent.primary_command || "").trim(),
      dry_run: dryRun,
      ok: false,
      code: 75,
      stdout_tail: "",
      stderr_tail: `Integrity quarantine active: ${preGate.reason}. ${preGate.required_action || ""}`.trim(),
      integrity: {
        status: "BLOCKED",
        fail_closed: true,
        lane: preGate.lane,
        repo: preGate.repo,
        reasons: [`${preGate.reason}: ${preGate.required_action || "Human unblock required"}`],
      },
    };
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    const stampBlocked = Date.now();
    const jsonBlocked = path.join(REPORT_DIR, `${stampBlocked}-status-review-${agentId}.json`);
    const latestBlocked = path.join(REPORT_DIR, `status-review-${agentId}-latest.json`);
    fs.writeFileSync(jsonBlocked, JSON.stringify(blocked, null, 2));
    fs.writeFileSync(latestBlocked, JSON.stringify(blocked, null, 2));
    await logIntegrityEvent({
      event_type: "RUN_INTEGRITY",
      lane: preGate.lane,
      repo: preGate.repo,
      runner_type: "status_review",
      agent_id: agentId,
      status: "BLOCKED",
      reason: preGate.reason,
      payload: blocked.integrity,
    }).catch(() => {});
    await appendAgentDailyLog(agentId, {
      goal: `${agent.job_description} | integrity_quarantine`,
      task_type: "status_review_agent_run",
      summary: `status=blocked | code=75 | lane=${preGate.lane} | repo=${preGate.repo}`,
      learned: blocked.stderr_tail.slice(0, 400),
      blocker: blocked.stderr_tail.slice(0, 300),
      next_focus: "Resolve quarantine reason and release lane",
      tags: [agentId, "integrity", "quarantine", preGate.lane].filter(Boolean),
      model_used: "status-review-runner",
      cost_usd: 0,
      open_loops: ["Quarantined lane blocked execution to prevent looped non-progress work."],
    });
    console.log("=== Status Review Agent Runner ===");
    console.log(`agent: ${agentId}`);
    console.log(`ok: false`);
    console.log(`code: 75`);
    console.log(`report: ${jsonBlocked}`);
    return 2;
  }

  // Check with system health coordinator (unless skipped)
  if (!skipCoordination && !dryRun) {
    try {
      // Fast health check first (<1s)
      const { fastHealthCheck, shouldEnterSafeMode, isCriticalAgent } = require("../control/coordinator-watchdog");
      const fastCheck = await fastHealthCheck();
      
      // Check safe mode
      const safeMode = await shouldEnterSafeMode();
      if (safeMode.safe_mode && !isCriticalAgent(agentId)) {
        console.log(`[status-review] Agent ${agentId} skipped: Safe mode active (coordinator stale)`);
        console.log(`[status-review] Only critical agents running. This agent is not critical.`);
        process.exit(0);
      }
      
      // Full coordination check
      const coordinator = require("../control/system-health-coordinator");
      await coordinator.loadHealthState();
      const healthState = coordinator.getHealthState();
      const decision = await coordinator.shouldAgentRun(agentId, agent, healthState);
      
      if (!decision.should_run) {
        console.log(`[status-review] Agent ${agentId} blocked: ${decision.reason}`);
        console.log(`[status-review] Priority: ${decision.priority}`);
        process.exit(0); // Exit gracefully, don't treat as error
      }
      
      // Log fast check result for monitoring
      if (!fastCheck.ok) {
        console.warn(`[status-review] Fast health check failed, but proceeding: ${fastCheck.error || "unknown"}`);
      }
    } catch (err) {
      console.warn(`[status-review] Coordination check failed, proceeding anyway: ${err.message}`);
    }
  }

  const startedAt = new Date().toISOString();
  const cmd = String(agent.primary_command || "").trim();
  if (!cmd) throw new Error(`Agent ${agentId} missing primary_command`);

  const result = dryRun
    ? { ok: true, code: 0, stdout_tail: "dry_run", stderr_tail: "", duration_ms: 0, dry_run: true }
    : runCommand(cmd, timeoutMs);

  const executionTime = result.duration_ms || (Date.now() - new Date(startedAt).getTime());

  const out = {
    generated_at: new Date().toISOString(),
    started_at: startedAt,
    agent_id: agentId,
    agent_name: agent.name,
    command: cmd,
    dry_run: dryRun,
    ...result,
  };
  const integrity = await evaluateAndRecordRunIntegrity({
    runnerType: "status_review",
    agentId,
    agent,
    out,
  });
  out.integrity = integrity;
  out.command_ok = out.ok;
  out.ok = integrity.effective_ok;
  out.status = integrity.status;
  if (!out.ok && out.code === 0) {
    out.code = 42;
  }

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = Date.now();
  const jsonPath = path.join(REPORT_DIR, `${stamp}-status-review-${agentId}.json`);
  const latestPath = path.join(REPORT_DIR, `status-review-${agentId}-latest.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2));
  fs.writeFileSync(latestPath, JSON.stringify(out, null, 2));

  const writeback = buildOutcomeWriteback(out, agentId);
  
  // Log performance metric for predictive scheduling
  if (!dryRun) {
    try {
      const { logPerformanceMetric } = require("../control/predictive-scheduler");
      await logPerformanceMetric({
        agent_id: agentId,
        timestamp: startedAt,
        execution_time_ms: executionTime,
        outcome: out.ok ? "success" : (out.duration_ms ? "timeout" : "fail"),
        resource_utilization: null, // Could be enhanced with actual resource monitoring
      });
    } catch (err) {
      console.warn(`[status-review] Performance logging failed: ${err.message}`);
    }
  }
  
  // Emit signal for cross-agent learning
  if (!dryRun) {
    try {
      const { emitSignal } = require("../control/cross-agent-learning");
      const entities = [agentId]; // Could extract from command/output
      await emitSignal({
        origin_agent_id: agentId,
        entities_touched: entities,
        sentiment: out.ok ? "positive" : "negative",
        error_type: out.ok ? null : (out.stderr_tail || "command_failed").split("\n")[0].substring(0, 50),
        metadata: {
          execution_time_ms: executionTime,
          command: cmd.substring(0, 100),
        },
        priority: out.ok ? "normal" : "high",
      });
    } catch (err) {
      console.warn(`[status-review] Signal emission failed: ${err.message}`);
    }
  }
  
  await appendAgentDailyLog(agentId, {
    goal: agent.job_description,
    task_type: "status_review_agent_run",
    summary: writeback.summary,
    learned: writeback.learned,
    metrics: writeback.metrics,
    blocker: out.ok
      ? undefined
      : (integrity.reasons.join(" | ") || out.stderr_tail || out.stdout_tail || "integrity_blocked").slice(0, 300),
    next_focus: writeback.next_focus,
    tags: writeback.tags,
    model_used: "status-review-runner",
    cost_usd: 0,
    open_loops: writeback.openLoops,
  });

  console.log("=== Status Review Agent Runner ===");
  console.log(`agent: ${agentId}`);
  console.log(`ok: ${out.ok}`);
  console.log(`status: ${out.status}`);
  console.log(`code: ${out.code}`);
  console.log(`report: ${jsonPath}`);
  return out.ok ? 0 : 2;
}

main()
  .then((code) => {
    process.exit(Number(code || 0));
  })
  .catch((err) => {
    console.error(`status-review-agent-runner failed: ${err.message}`);
    process.exit(1);
  });
