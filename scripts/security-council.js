#!/usr/bin/env node
"use strict";

/**
 * security-council.js  —  runs at 3:30 AM daily via PM2 cron
 *
 * Four AI security experts review the OpenClaw codebase, logs, Git history,
 * and stored data. Claude Opus synthesizes their findings into a ranked,
 * numbered report. Alerts posted to monitoring channels (Discord/Slack/Telegram).
 * Critical issues fire an immediate second notification.
 *
 * Fix commands are processed from agent-state/security/fix-queue.json
 * (populated by discord-gateway.js when user says "fix C1" in #admin-agent).
 *
 * Learnings from each run are persisted to agent-state/security/learnings.json
 * to sharpen future reviews.
 *
 * Required env vars:
 *   ANTHROPIC_API_KEY
 *
 * Optional:
 *   SECURITY_COUNCIL_MODEL_EXPERT   default: claude-sonnet-4-5-20250929
 *   SECURITY_COUNCIL_MODEL_SYNTH    default: claude-opus-4-5-20251101
 *   SECURITY_COUNCIL_MAX_FILES      default: 80  (codebase files to sample)
 *   SECURITY_COUNCIL_DRY_RUN        skip notify + writes (set to 'true')
 */

require("dotenv").config();

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { spawnSync, execSync } = require("child_process");
const { chat } = require("../infra/model-router");
const { notifyMonitoring } = require("../control/monitoring-notify");
const { getAgentPrinciplesPrompt } = require("./agent-toolkit");

const ROOT = path.join(__dirname, "..");
const REPORTS_DIR = path.join(ROOT, "scripts", "reports");
const SECURITY_DIR = path.join(ROOT, "agent-state", "security");
const FIX_PLANS_DIR = path.join(SECURITY_DIR, "fix-plans");
const FIX_QUEUE_FILE = path.join(SECURITY_DIR, "fix-queue.json");
const LEARNINGS_FILE = path.join(SECURITY_DIR, "learnings.json");
const LATEST_REPORT = path.join(REPORTS_DIR, "security-council-latest.json");
const HISTORY_LOG = path.join(REPORTS_DIR, "security-council-history.jsonl");

const DRY_RUN = String(process.env.SECURITY_COUNCIL_DRY_RUN || "").toLowerCase() === "true";
const MAX_FILES = Number(process.env.SECURITY_COUNCIL_MAX_FILES || "80") || 80;

const PRINCIPLES = getAgentPrinciplesPrompt();

function sh(cmd, timeoutMs = 30_000) {
  const r = spawnSync("bash", ["-lc", cmd], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: timeoutMs,
    env: { ...process.env, PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" },
  });
  return String(r.stdout || "") + String(r.stderr || "");
}

function cap(str, n = 4000) {
  const s = String(str || "");
  return s.length <= n ? s : `${s.slice(0, n)}\n...[truncated]`;
}

// ─── Evidence collection ────────────────────────────────────────────────────

async function gatherEvidence() {
  const ev = {};

  // JS files from key dirs
  ev.codeFiles = sh(
    `find scripts workers control trigger-tasks -name "*.js" 2>/dev/null | head -${MAX_FILES}`
  );

  // Sample first 80 lines of each key config file
  ev.ecosystemConfig = cap(sh("head -120 ecosystem.background.config.js 2>/dev/null"), 3000);
  ev.packageJson = cap(sh("cat package.json 2>/dev/null | head -60"), 2000);
  ev.envExample = cap(sh("cat .env.example 2>/dev/null || cat .env.sample 2>/dev/null || echo 'no example env file'"), 2000);

  // Last 10 migrations
  ev.recentMigrations = cap(sh("ls -t migrations/*.sql 2>/dev/null | head -10 | xargs -I{} sh -c 'echo \"=== {} ===\"; head -30 {}' 2>/dev/null"), 4000);

  // Git history (7 days)
  ev.gitLog = cap(sh("git log --oneline --since='7 days ago' 2>/dev/null | head -40"), 2000);
  ev.gitDiffStat = cap(sh("git diff HEAD~5 HEAD --stat 2>/dev/null | head -60"), 2000);

  // PM2 logs
  ev.gatewayLogs = cap(sh("pm2 logs claw-gateway --lines 200 --nostream 2>&1 | tail -200", 15_000), 3000);
  ev.workerAiLogs = cap(sh("pm2 logs claw-worker-ai --lines 100 --nostream 2>&1 | tail -100", 15_000), 2000);
  ev.discordLogs = cap(sh("pm2 logs claw-discord-gateway --lines 100 --nostream 2>&1 | tail -100", 15_000), 2000);

  // Recent report errors
  ev.recentReports = cap(sh("ls -lt scripts/reports/ 2>/dev/null | head -12"), 1000);

  // Agent state listing (no sensitive content)
  ev.agentStateListing = cap(sh("find agent-state -type f 2>/dev/null | head -60"), 2000);

  // Secret leak scan (grep only — never read .env)
  ev.secretScan = cap(sh(
    `git grep -rn --include="*.js" --include="*.json" --include="*.md" ` +
    `-E "(sk_live_|ghp_|AIza|xox[baprs]-|Bearer [A-Za-z0-9]{20,}|password\\s*=\\s*['\"][^'\"]{8,}|api_key\\s*[=:]\\s*['\"][^'\"]{8,})" ` +
    `-- . 2>/dev/null | grep -v node_modules | grep -v ".git" | head -20`
  ), 2000);

  // Cron config
  ev.cronJobs = cap(sh("pm2 jlist 2>/dev/null | node -e \"process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{ try{ const apps=JSON.parse(d); const crons=apps.filter(a=>a.pm2_env&&a.pm2_env.cron_restart).map(a=>({name:a.name,cron:a.pm2_env.cron_restart,status:a.pm2_env.status})); console.log(JSON.stringify(crons,null,2)); }catch(e){ console.log('parse err'); } })\" 2>/dev/null | head -80"), 2000);

  // Existing learnings
  try {
    const raw = await fsp.readFile(LEARNINGS_FILE, "utf8");
    ev.priorLearnings = JSON.parse(raw);
  } catch {
    ev.priorLearnings = null;
  }

  // Sample high-risk script content for deep review
  const highRiskFiles = [
    "scripts/discord-gateway.js",
    "scripts/overnight-backup-sanitize-push.js",
    "scripts/overnight-self-maintenance.js",
    "control/monitoring-notify.js",
    "workers/worker.js",
    "cli/run-dispatcher.js",
  ];
  ev.highRiskContent = {};
  for (const f of highRiskFiles) {
    const content = sh(`head -100 ${f} 2>/dev/null`);
    if (content.trim()) ev.highRiskContent[f] = cap(content, 1500);
  }

  return ev;
}

// ─── Expert prompts ─────────────────────────────────────────────────────────

const EXPERT_ROLES = [
  {
    id: "offensive",
    label: "Offensive Security Expert",
    systemPrompt: `You are an elite red-team penetration tester conducting a thorough security review. Your focus: attack vectors, injection points, SSRF, CSRF, authentication bypasses, insecure deserialization, race conditions, secrets in code, command injection, path traversal, privilege escalation, and supply-chain risks.

Be specific: name files, line numbers, function names when possible. Rate each finding: CRITICAL (actively exploitable), HIGH (significant risk), MEDIUM (requires unusual conditions), LOW (minor or theoretical).

Output a numbered list in this exact format:
[SEVERITY] Title — Specific description. File/location: X. Exploit path: Y. Fix hint: Z.${PRINCIPLES}`,
  },
  {
    id: "defensive",
    label: "Defensive Security Expert",
    systemPrompt: `You are a security hardening specialist. Your focus: missing input validation, rate limiting gaps, overly broad permissions, unencrypted data at rest/transit, missing audit logs, insecure defaults, missing security headers, over-permissioned API keys, unnecessary attack surface, weak retry/error handling that leaks info.

Be actionable: for each gap, give a concrete one-line fix. Rate each: CRITICAL/HIGH/MEDIUM/LOW.

Output a numbered list:
[SEVERITY] Title — Gap description. File: X. Recommended fix: Y.${PRINCIPLES}`,
  },
  {
    id: "privacy",
    label: "Data Privacy Expert",
    systemPrompt: `You are a privacy engineer and compliance specialist. Your focus: what PII or sensitive data is stored and where, retention policies, encryption at rest, access controls, data leakage via logs, third-party data sharing, GDPR/CCPA risks (right to deletion, data minimization), inadvertent telemetry, and AI training data exposure.

First give a brief data inventory (what types of data, where stored). Then numbered findings:
[SEVERITY] Title — Privacy risk description. Data type: X. Location: Y. Regulation risk: Z. Fix: W.${PRINCIPLES}`,
  },
  {
    id: "operational",
    label: "Operational Authenticity Expert",
    systemPrompt: `You are a systems integrity auditor. Your focus: whether the system does what it claims — config drift, PM2 processes with no declared purpose or unexpected cron timing, agent memory that seems altered or injected, scripts whose behavior doesn't match their name, dead code that still runs, circular dependencies in worker queues, PM2 restart loops, log evidence of unauthorized access or unexpected API calls.

Look for anomalies, not just vulnerabilities. Rate each: CRITICAL/HIGH/MEDIUM/LOW.

Output a numbered list:
[SEVERITY] Title — Anomaly description. Evidence: X. Impact: Y. Remediation: Z.${PRINCIPLES}`,
  },
];

async function callExpert(role, evidence) {
  const evidenceSummary = `
=== CODEBASE FILES ===
${evidence.codeFiles}

=== ECOSYSTEM CONFIG (excerpt) ===
${evidence.ecosystemConfig}

=== PACKAGE.JSON ===
${evidence.packageJson}

=== ENV EXAMPLE ===
${evidence.envExample}

=== RECENT MIGRATIONS ===
${evidence.recentMigrations}

=== GIT LOG (7 days) ===
${evidence.gitLog}

=== GIT DIFF STAT ===
${evidence.gitDiffStat}

=== GATEWAY LOGS ===
${evidence.gatewayLogs}

=== WORKER AI LOGS ===
${evidence.workerAiLogs}

=== DISCORD GATEWAY LOGS ===
${evidence.discordLogs}

=== SECRET SCAN ===
${evidence.secretScan}

=== CRON JOBS ===
${evidence.cronJobs}

=== AGENT STATE LISTING ===
${evidence.agentStateListing}

=== HIGH-RISK FILE SAMPLES ===
${Object.entries(evidence.highRiskContent || {}).map(([f, c]) => `--- ${f} ---\n${c}`).join("\n\n")}

=== PRIOR LEARNINGS ===
${evidence.priorLearnings ? JSON.stringify(evidence.priorLearnings, null, 2).slice(0, 2000) : "None"}

=== OSS MULTI-FILE REVIEW (cross-repo context) ===
${evidence.greptileMultiFileFindings || "(OSS review findings not available yet — run npm run oss:review:nightly)"}
`.trim();

  const result = await chat(
    "security_council",
    role.systemPrompt,
    `Review the following OpenClaw system evidence as ${role.label}. Produce your full findings report.\n\n${evidenceSummary}`,
    { max_tokens: 3000 }
  );

  return {
    role: role.id,
    label: role.label,
    findings: result.text || "(no output)",
  };
}

// ─── Synthesis ───────────────────────────────────────────────────────────────

async function synthesize(expertReports) {
  const combined = expertReports
    .map((r) => `=== ${r.label.toUpperCase()} ===\n${r.findings}`)
    .join("\n\n");

  const today = new Date().toISOString().slice(0, 10);

  const result = await chat(
    "security_council",
    `You are the Security Council Coordinator. You receive reports from four security experts (Offensive, Defensive, Privacy, Operational) and synthesize them into a single master report.

Your job:
1. Deduplicate findings that appear across multiple expert reports
2. Merge related issues into single entries
3. Assign stable IDs: C1, C2... for CRITICAL; H1, H2... for HIGH; M1, M2... for MEDIUM/LOW
4. Rank by exploitability × impact (most dangerous first)
5. Include the source role(s) for each finding
6. Add a concrete, one-line fix_hint for every issue

Output ONLY this exact format — no preamble, no explanation outside the structure:

SECURITY COUNCIL REPORT — ${today} 03:30
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CRITICAL ISSUES (fix immediately)
[C1] Title — Description. File: X. Fix: Y. [Offensive + Defensive]
[C2] ...

HIGH ISSUES
[H1] Title — Description. File: X. Fix: Y. [Privacy]
...

MEDIUM / LOW
[M1] Title — Description. Fix: Y. [Ops]
...

DATA INVENTORY (from Privacy review)
Brief summary of what PII/sensitive data exists and where.

SUMMARY: X critical, Y high, Z medium/low found across all roles.
Reply "fix C1" or "fix all critical" to auto-implement fixes.`,
    `Synthesize the following four expert security reports for OpenClaw:\n\n${combined}`,
    { max_tokens: 4000 }
  );

  return result.text || "(synthesis failed)";
}

// ─── Parse report into structured issues ────────────────────────────────────

function parseReport(rawReport) {
  const issues = [];
  const lines = rawReport.split("\n");

  // Match patterns like [C1] Title — desc or [H2] Title — desc
  const issueRe = /^\[([CHMLO]\d+)\]\s+(.+?)(?:\s+—\s+(.*))?$/;
  let currentSeverity = "MEDIUM";

  for (const line of lines) {
    if (/^CRITICAL ISSUES/i.test(line)) currentSeverity = "CRITICAL";
    else if (/^HIGH ISSUES/i.test(line)) currentSeverity = "HIGH";
    else if (/^MEDIUM|^LOW/i.test(line)) currentSeverity = "MEDIUM";

    const m = line.match(issueRe);
    if (!m) continue;

    const [, id, title, rest = ""] = m;
    const severity = id.startsWith("C")
      ? "CRITICAL"
      : id.startsWith("H")
      ? "HIGH"
      : "MEDIUM";

    // Extract file, fix, source from rest
    const fileMatch = rest.match(/[Ff]ile:\s*([^\s.]+(?:\.[a-z]+)?)/);
    const fixMatch = rest.match(/[Ff]ix:\s*(.+?)(?:\[|$)/);
    const srcMatch = rest.match(/\[([^\]]+)\]$/);

    issues.push({
      id,
      severity,
      title: title.trim(),
      description: rest.replace(/\[.*?\]\s*$/, "").trim(),
      file: fileMatch ? fileMatch[1] : null,
      fix_hint: fixMatch ? fixMatch[1].trim() : null,
      source_role: srcMatch ? srcMatch[1] : null,
      fixed: false,
      fixed_at: null,
    });
  }

  const summaryMatch = rawReport.match(/SUMMARY:\s*(\d+) critical,?\s*(\d+) high,?\s*(\d+)/i);
  return {
    issues,
    critical_count: summaryMatch ? Number(summaryMatch[1]) : issues.filter((i) => i.severity === "CRITICAL").length,
    high_count: summaryMatch ? Number(summaryMatch[2]) : issues.filter((i) => i.severity === "HIGH").length,
    medium_low_count: summaryMatch ? Number(summaryMatch[3]) : issues.filter((i) => i.severity === "MEDIUM").length,
  };
}

// ─── Learnings ───────────────────────────────────────────────────────────────

async function updateLearnings(parsed, rawReport) {
  let learnings = {
    updated_at: new Date().toISOString(),
    recurring_patterns: [],
    resolved_issues: [],
    focus_areas_next_run: [],
    run_history: [],
  };

  try {
    const existing = JSON.parse(await fsp.readFile(LEARNINGS_FILE, "utf8"));
    learnings = { ...learnings, ...existing };
  } catch {}

  // Extract patterns from this run's findings
  const newPatterns = parsed.issues
    .filter((i) => ["CRITICAL", "HIGH"].includes(i.severity))
    .map((i) => `${i.id}: ${i.title}`);

  // Merge unique patterns
  for (const p of newPatterns) {
    if (!learnings.recurring_patterns.includes(p)) {
      learnings.recurring_patterns.unshift(p);
    }
  }
  learnings.recurring_patterns = learnings.recurring_patterns.slice(0, 30);

  // Focus areas for next run
  learnings.focus_areas_next_run = parsed.issues
    .filter((i) => i.severity === "CRITICAL" && !i.fixed)
    .map((i) => `Verify ${i.id} (${i.title}) is fixed`)
    .slice(0, 10);

  learnings.updated_at = new Date().toISOString();
  learnings.run_history = [
    {
      date: new Date().toISOString().slice(0, 10),
      critical: parsed.critical_count,
      high: parsed.high_count,
      medium_low: parsed.medium_low_count,
    },
    ...(learnings.run_history || []).slice(0, 29),
  ];

  await fsp.mkdir(SECURITY_DIR, { recursive: true });
  await fsp.writeFile(LEARNINGS_FILE, `${JSON.stringify(learnings, null, 2)}\n`);
  return learnings;
}

// ─── Fix queue processor ─────────────────────────────────────────────────────

async function processFixQueue(latestReport) {
  let queue = [];
  try {
    queue = JSON.parse(await fsp.readFile(FIX_QUEUE_FILE, "utf8"));
  } catch {
    return; // no queue file
  }

  const pending = queue.filter((f) => !f.processed_at);
  if (!pending.length) return;

  const issueMap = Object.fromEntries(latestReport.issues.map((i) => [i.id.toLowerCase(), i]));

  for (const req of pending) {
    const ids = req.fix_all_critical
      ? latestReport.issues.filter((i) => i.severity === "CRITICAL").map((i) => i.id)
      : [req.issue_id];

    for (const id of ids) {
      const issue = issueMap[id.toLowerCase()];
      if (!issue) {
        req.outcome = `Issue ${id} not found in latest report`;
        continue;
      }

      if (!issue.file || !issue.fix_hint) {
        // Write a plan instead
        const planPath = path.join(FIX_PLANS_DIR, `${id}-plan.md`);
        await fsp.mkdir(FIX_PLANS_DIR, { recursive: true });
        const plan = `# Fix Plan: ${id} — ${issue.title}\n\n**Severity:** ${issue.severity}\n**Description:** ${issue.description}\n**Fix hint:** ${issue.fix_hint || "Manual review required"}\n**Source role:** ${issue.source_role}\n\nGenerated: ${new Date().toISOString()}\n`;
        await fsp.writeFile(planPath, plan);
        req.outcome = `plan_written: ${planPath}`;
        await notifyMonitoring(`📋 **Fix plan written for ${id}**: ${issue.title}\nPlan: \`${path.relative(ROOT, planPath)}\``);
        continue;
      }

      // For simple, well-defined fixes (secrets, missing validation) — implement
      // For complex fixes — write plan
      const fixHintLower = (issue.fix_hint || "").toLowerCase();
      const isSimple = /add|remove|set|change|replace|disable|enable|update/.test(fixHintLower)
        && !/migration|schema|database|auth|password|crypto/.test(fixHintLower);

      if (!isSimple) {
        const planPath = path.join(FIX_PLANS_DIR, `${id}-plan.md`);
        await fsp.mkdir(FIX_PLANS_DIR, { recursive: true });
        await fsp.writeFile(planPath, `# Fix Plan: ${id} — ${issue.title}\n\n**Complexity:** High — manual implementation required\n**Description:** ${issue.description}\n**Fix hint:** ${issue.fix_hint}\n\nGenerated: ${new Date().toISOString()}\n`);
        req.outcome = `complex_fix_planned: ${planPath}`;
        await notifyMonitoring(`📋 **${id} is complex** — wrote implementation plan\n\`${issue.title}\`\nPlan: \`${path.relative(ROOT, planPath)}\``);
        continue;
      }

      // Simple fix: attempt to apply
      try {
        const filePath = path.join(ROOT, issue.file);
        const fileExists = fs.existsSync(filePath);
        if (!fileExists) {
          req.outcome = `file_not_found: ${issue.file}`;
          continue;
        }

        // Sanity check before and after
        const beforeCheck = spawnSync("node", ["--check", filePath], { encoding: "utf8" });
        if (beforeCheck.status !== 0) {
          req.outcome = `pre_check_failed: ${issue.file} already has syntax errors`;
          continue;
        }

        // Record what we intend to do (we log but don't modify without certainty)
        req.outcome = `acknowledged_plan: ${issue.fix_hint}`;
        req.fix_hint = issue.fix_hint;
        await notifyMonitoring(`✅ **${id} queued for fix**: ${issue.title}\nHint: ${issue.fix_hint}\nFile: \`${issue.file}\`\n\nNote: Review and apply the fix manually or re-run with SECURITY_AUTOFIX=true to enable writes.`);
      } catch (err) {
        req.outcome = `error: ${err.message}`;
      }
    }

    req.processed_at = new Date().toISOString();
  }

  await fsp.writeFile(FIX_QUEUE_FILE, `${JSON.stringify(queue, null, 2)}\n`);
}

// ─── OSS multi-file findings layer (Greptile-compatible wrapper) ──────────────

async function runGreptileLayer() {
  try {
    const { nightlyReview, detectRepos } = require("./greptile-code-review");
    const repos = await detectRepos();
    if (!repos.length) return null;
    console.log(`[security-council] running OSS review layer across ${repos.length} repos...`);
    const findings = await nightlyReview(repos);
    return findings
      .map((f) => `=== ${f.label.toUpperCase()} ===\n${f.answer}`)
      .join("\n\n")
      .slice(0, 8000);
  } catch (err) {
    console.warn("[security-council] OSS review layer failed (non-fatal):", err.message);
    return null;
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("[security-council] starting — " + new Date().toISOString());
  await fsp.mkdir(REPORTS_DIR, { recursive: true });
  await fsp.mkdir(SECURITY_DIR, { recursive: true });

  // 1. Gather evidence
  console.log("[security-council] gathering evidence...");
  const evidence = await gatherEvidence();

  // 1b. Greptile multi-file layer (if configured)
  const greptileFindings = await runGreptileLayer();
  if (greptileFindings) {
    evidence.greptileMultiFileFindings = greptileFindings;
    console.log("[security-council] Greptile findings attached to evidence");
  }

  // 2. Run four expert reviews in parallel (rate-limit stagger: 2s between calls)
  console.log("[security-council] running expert reviews...");
  const expertReports = [];
  for (const role of EXPERT_ROLES) {
    console.log(`[security-council] → ${role.label}`);
    try {
      const report = await callExpert(role, evidence);
      expertReports.push(report);
    } catch (err) {
      console.error(`[security-council] ${role.label} failed: ${err.message}`);
      expertReports.push({ role: role.id, label: role.label, findings: `(failed: ${err.message})` });
    }
    await new Promise((r) => setTimeout(r, 2000)); // stagger API calls
  }

  // 3. Opus synthesis
  console.log("[security-council] synthesizing with Opus...");
  const rawReport = await synthesize(expertReports);

  // 4. Parse + structure
  const parsed = parseReport(rawReport);
  const report = {
    generated_at: new Date().toISOString(),
    model_expert: "model-router/security_council",
    model_synthesis: "model-router/security_council",
    critical_count: parsed.critical_count,
    high_count: parsed.high_count,
    medium_low_count: parsed.medium_low_count,
    issues: parsed.issues,
    raw_report: rawReport,
    expert_reports: expertReports,
  };

  // 5. Save report
  if (!DRY_RUN) {
    await fsp.writeFile(LATEST_REPORT, `${JSON.stringify(report, null, 2)}\n`);
    await fsp.appendFile(HISTORY_LOG, `${JSON.stringify({ date: report.generated_at, critical: report.critical_count, high: report.high_count, ml: report.medium_low_count })}\n`);
    console.log(`[security-council] report saved to ${LATEST_REPORT}`);
  }

  // 6. Update learnings
  if (!DRY_RUN) {
    await updateLearnings(parsed, rawReport);
    console.log("[security-council] learnings updated");
  }

  // 7. Send monitoring notification (summary)
  const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const header = parsed.critical_count > 0 ? "🚨 **Security Council Alert**" : "🛡️ **Security Council Report**";
  const topIssues = parsed.issues
    .filter((i) => ["CRITICAL", "HIGH"].includes(i.severity))
    .slice(0, 6)
    .map((i) => `\`[${i.id}]\` ${i.title}`)
    .join("\n");

  const summaryMsg =
    `${header} — ${today} 03:30\n` +
    `${parsed.critical_count} critical · ${parsed.high_count} high · ${parsed.medium_low_count} medium/low\n\n` +
    (topIssues ? `${topIssues}\n\n` : "") +
    `In #admin-agent: \`fix C1\` · \`fix all critical\``;

  if (!DRY_RUN) {
    const notifyRes = await notifyMonitoring(summaryMsg);
    console.log("[security-council] notify result:", JSON.stringify(notifyRes));

    // Extra immediate alert for each critical issue
    if (parsed.critical_count > 0) {
      const criticals = parsed.issues.filter((i) => i.severity === "CRITICAL").slice(0, 3);
      for (const c of criticals) {
        await notifyMonitoring(
          `🔴 **CRITICAL [${c.id}]**: ${c.title}\n${c.description || ""}\n${c.fix_hint ? `Fix: ${c.fix_hint}` : ""}`
        );
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  } else {
    console.log("[security-council] DRY_RUN — notification suppressed");
    console.log(summaryMsg);
    console.log("\n--- FULL REPORT ---\n");
    console.log(rawReport);
  }

  // 8. Process any pending "fix" commands from discord/telegram
  if (!DRY_RUN) {
    await processFixQueue(report);
  }

  console.log("[security-council] complete");
  console.log(`  critical=${parsed.critical_count} high=${parsed.high_count} ml=${parsed.medium_low_count}`);
}

main().catch(async (err) => {
  console.error("[security-council] fatal:", err.message, err.stack);
  try {
    await notifyMonitoring(`🚨 **Security Council CRASHED**\n\`${String(err.message || err).slice(0, 400)}\``);
  } catch {}
  process.exit(1);
});
