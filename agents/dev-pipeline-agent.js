"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { register } = require("./registry");

function nowIso() {
  return new Date().toISOString();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function safeSlug(value) {
  return String(value || "task")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "task";
}

function runLine(line, cwd, timeoutMs = 20 * 60 * 1000) {
  const r = spawnSync("bash", ["-lc", line], {
    cwd,
    env: { ...process.env, CI: "1" },
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
  });
  return {
    ok: Number(r.status || 0) === 0,
    code: Number(r.status || 0),
    stdout: String(r.stdout || ""),
    stderr: String(r.stderr || ""),
  };
}

function writeStage(stagePath, title, lines) {
  const out = [];
  out.push(`# ${title}`);
  out.push("");
  out.push(`- timestamp: ${nowIso()}`);
  out.push("");
  out.push(...lines);
  out.push("");
  fs.writeFileSync(stagePath, out.join("\n"), "utf8");
}

function summarizeResult(label, result) {
  const stdoutTail = result.stdout.slice(-2500);
  const stderrTail = result.stderr.slice(-2500);
  return [
    `## ${label}`,
    `- ok: ${result.ok}`,
    `- code: ${result.code}`,
    "",
    "### stdout_tail",
    "```text",
    stdoutTail || "(empty)",
    "```",
    "",
    "### stderr_tail",
    "```text",
    stderrTail || "(empty)",
    "```",
  ];
}

register("dev_pipeline_run", async (payload = {}) => {
  const taskText = String(payload.task || "").trim();
  if (!taskText) throw new Error("dev_pipeline_run requires payload.task");

  const taskSlug = safeSlug(payload.task_slug || taskText);
  const repoPath = path.resolve(payload.repo_path || process.cwd());
  const baseBranch = String(payload.base_branch || "main");
  const dryRun = payload.dry_run !== false;
  const testCommand = String(payload.test_command || "npm run -s qa:fast");
  const securityCommand = String(payload.security_command || "npm run -s security:sweep -- --dep-fail-on high");

  const root = path.join(os.homedir(), "notes", "dev", "pipelines", taskSlug);
  fs.mkdirSync(root, { recursive: true });

  const stage1 = path.join(root, "stage_1_research.md");
  const stage2 = path.join(root, "stage_2_implement.md");
  const stage3 = path.join(root, "stage_3_review.md");
  const stage4 = path.join(root, "stage_4_test.md");
  const stage5 = path.join(root, "stage_5_security.md");
  const finalPath = path.join(root, "final_output.md");

  const branchName = String(payload.branch_name || `codex/dev-pipeline-${taskSlug}-${today()}`);

  const stageOrder = ["research", "implement", "review", "test", "security audit"];

  // Stage 1: research
  const status = runLine("git status --short", repoPath, 120000);
  const topFiles = runLine("rg --files | head -n 60", repoPath, 120000);
  writeStage(stage1, "Stage 1 - Research", [
    `- objective: ${taskText}`,
    `- repo_path: ${repoPath}`,
    `- base_branch: ${baseBranch}`,
    `- dry_run: ${dryRun}`,
    "",
    "## Stage Plan",
    ...stageOrder.map((s, i) => `${i + 1}. ${s}`),
    "",
    ...summarizeResult("Git Status Snapshot", status),
    "",
    ...summarizeResult("Top File Inventory", topFiles),
  ]);

  // Stage 2: implement
  const implLines = [
    `- branch_target: ${branchName}`,
    `- dry_run: ${dryRun}`,
    "",
    "## Intended Actions",
    `1. Checkout base branch \`${baseBranch}\` and create branch \`${branchName}\`.`,
    "2. Implement scoped changes for requested task.",
    "3. Capture change summary + risks for PR notes.",
  ];
  let branchCreate = { ok: true, code: 0, stdout: "dry_run", stderr: "" };
  if (!dryRun) {
    runLine(`git fetch origin ${baseBranch}`, repoPath, 120000);
    runLine(`git checkout ${baseBranch}`, repoPath, 120000);
    runLine(`git pull --rebase origin ${baseBranch}`, repoPath, 120000);
    branchCreate = runLine(`git checkout -B ${branchName}`, repoPath, 120000);
  }
  writeStage(stage2, "Stage 2 - Implement", [...implLines, "", ...summarizeResult("Branch Setup", branchCreate)]);

  // Stage 3: review
  const reviewCmd = "npm run -s ship:checklist";
  const reviewRes = dryRun ? { ok: true, code: 0, stdout: "dry_run", stderr: "" } : runLine(reviewCmd, repoPath, 15 * 60 * 1000);
  writeStage(stage3, "Stage 3 - Review", [
    `- review_command: ${reviewCmd}`,
    `- dry_run: ${dryRun}`,
    "",
    "## Pain Points To Refactor (named)",
    "- Naming ambiguity in touched modules",
    "- Duplicate control flow/logic where feasible",
    "- Hidden side effects in handlers/scripts",
    "",
    ...summarizeResult("Review Check", reviewRes),
  ]);

  // Stage 4: test
  const testRes = dryRun ? { ok: true, code: 0, stdout: "dry_run", stderr: "" } : runLine(testCommand, repoPath, 30 * 60 * 1000);
  writeStage(stage4, "Stage 4 - Test", [
    `- test_command: ${testCommand}`,
    `- dry_run: ${dryRun}`,
    "",
    ...summarizeResult("Test Evidence", testRes),
  ]);

  // Stage 5: security
  const secRes = dryRun ? { ok: true, code: 0, stdout: "dry_run", stderr: "" } : runLine(securityCommand, repoPath, 30 * 60 * 1000);
  writeStage(stage5, "Stage 5 - Security Audit", [
    `- security_command: ${securityCommand}`,
    `- dry_run: ${dryRun}`,
    "",
    ...summarizeResult("Security Evidence", secRes),
  ]);

  // Final output
  const finalLines = [];
  finalLines.push("# Dev Pipeline Final Output");
  finalLines.push("");
  finalLines.push(`- task: ${taskText}`);
  finalLines.push(`- task_slug: ${taskSlug}`);
  finalLines.push(`- repo_path: ${repoPath}`);
  finalLines.push(`- pr_branch: ${branchName}`);
  finalLines.push(`- dry_run: ${dryRun}`);
  finalLines.push("");
  finalLines.push("## Change Summary");
  finalLines.push("- Research completed and staged artifacts generated.");
  finalLines.push("- Implementation branch prepared for PR workflow.");
  finalLines.push("- Review/test/security stages executed or simulated via dry-run.");
  finalLines.push("");
  finalLines.push("## Test Evidence");
  finalLines.push(`- stage_4_test: ${stage4}`);
  finalLines.push(`- test_ok: ${testRes.ok}`);
  finalLines.push(`- test_code: ${testRes.code}`);
  finalLines.push("");
  finalLines.push("## Risk Notes");
  if (!testRes.ok) finalLines.push("- Test stage failed; PR not ready until failures are resolved.");
  if (!secRes.ok) finalLines.push("- Security stage reported issues; triage before merge.");
  if (dryRun) finalLines.push("- Dry-run mode used; commands were not executed destructively.");
  if (testRes.ok && secRes.ok) finalLines.push("- No immediate blocking risk from executed pipeline checks.");
  finalLines.push("");
  finalLines.push("## Stage Files");
  finalLines.push(`1. ${stage1}`);
  finalLines.push(`2. ${stage2}`);
  finalLines.push(`3. ${stage3}`);
  finalLines.push(`4. ${stage4}`);
  finalLines.push(`5. ${stage5}`);
  finalLines.push("");
  fs.writeFileSync(finalPath, finalLines.join("\n"), "utf8");

  return {
    ok: true,
    task_slug: taskSlug,
    repo_path: repoPath,
    branch: branchName,
    dry_run: dryRun,
    stages: [stage1, stage2, stage3, stage4, stage5],
    final_output: finalPath,
    change_summary: [
      "Created 5-stage pipeline artifacts",
      "Prepared PR branch target",
      "Captured review/test/security evidence",
    ],
    test_evidence: {
      command: testCommand,
      ok: testRes.ok,
      code: testRes.code,
      file: stage4,
    },
    risk_notes: [
      ...(dryRun ? ["Pipeline executed in dry-run mode."] : []),
      ...(!testRes.ok ? ["Tests failed."] : []),
      ...(!secRes.ok ? ["Security audit failed."] : []),
    ],
    model_used: "deterministic-dev-pipeline-v1",
    cost_usd: 0,
  };
});

