// agents/patch-agent.js
// Drafts code fixes based on triage diagnosis.
// Creates a git branch and writes the patch to a file for human review.
//
// Payload:
//   { triage_task_id: "<uuid>", repo_path: "/path/to/repo" }
//   { diagnosis: "...", suggested_fix: "...", file_path: "/path/to/file.js", repo_path: "..." }
//
// Returns: { patch_content, branch_name, patch_file, diff_preview }

require("dotenv").config();
const fs        = require("fs");
const fsp       = require("fs").promises;
const path      = require("path");
const { execSync } = require("child_process");
const pg           = require("../infra/postgres");
const { register } = require("./registry");
const { chatJson } = require("../infra/model-router");
// route "patch": sub_sonnet → deepseek_r1 → api_sonnet

const MAX_TOKENS = 4096;

function resolveHome(p) {
  if (!p) return null;
  if (p.startsWith("~/")) return path.join(process.env.HOME, p.slice(2));
  return p;
}

function tryGitCommand(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
  } catch (err) {
    return null;
  }
}

register("patch", async (payload) => {
  let diagnosis    = "";
  let suggestedFix = "";
  let targetFile   = payload?.file_path ? resolveHome(payload.file_path) : null;
  const repoPath   = resolveHome(payload?.repo_path || process.env.REPO_PATH);

  // ── Load triage data if task_id provided ──────────────────
  if (payload?.triage_task_id) {
    const { rows } = await pg.query(
      `SELECT result FROM tasks WHERE id = $1 AND status = 'COMPLETED'`,
      [payload.triage_task_id]
    );
    if (!rows.length) throw new Error(`Triage task ${payload.triage_task_id} not found or not completed`);
    const triageResult = rows[0].result;
    diagnosis    = triageResult.diagnosis    || "";
    suggestedFix = triageResult.suggested_fix || "";
  } else {
    diagnosis    = payload?.diagnosis    || "";
    suggestedFix = payload?.suggested_fix || "";
  }

  if (!diagnosis) throw new Error("patch requires diagnosis (from triage_task_id or inline)");

  // ── Read target file if provided ──────────────────────────
  let existingCode = "";
  if (targetFile && fs.existsSync(targetFile)) {
    existingCode = await fsp.readFile(targetFile, "utf8");
  }

  // ── Build prompt ──────────────────────────────────────────
  const systemPrompt = `You are a precise code-repair agent.
Given a diagnosis and suggested fix, produce the minimal code change needed.

Respond with ONLY a JSON object:
{
  "branch_name": "fix/brief-slug",
  "explanation": "One sentence: what was wrong and what you changed",
  "patch_content": "Complete fixed file content OR unified diff",
  "patch_type": "full_file|diff",
  "file_path": "relative/path/to/file.js"
}

Rules:
- If existing code is provided, return the FULL fixed file as patch_content with patch_type="full_file"
- If no existing code, return a unified diff as patch_content with patch_type="diff"  
- branch_name must be lowercase, no spaces, max 40 chars, prefix with fix/
- Be minimal — change only what's broken`;

  const userMessage = `
Diagnosis: ${diagnosis}
Suggested fix: ${suggestedFix}
${targetFile ? `File: ${targetFile}` : ""}
${existingCode ? `\nExisting code:\n\`\`\`\n${existingCode.slice(0, 8000)}\n\`\`\`` : ""}
`.trim();

  console.log(`[patch] Generating fix for: ${diagnosis.slice(0, 80)}...`);

  // route "patch": sub_sonnet → deepseek_r1 → api_sonnet (needs real reasoning)
  const llmResult = await chatJson("patch", systemPrompt, userMessage,
    { max_tokens: MAX_TOKENS, task_id: payload?.task_id });

  const patchData = llmResult.json;
  if (!patchData) throw new Error(`Patch agent returned unparseable JSON: ${llmResult.text?.slice(0,300)}`);

  const branchName  = patchData.branch_name || `fix/patch-${Date.now()}`;
  const patchContent = patchData.patch_content || "";

  // ── Write patch file to artifacts dir ────────────────────
  const artifactsDir = path.join(__dirname, "../artifacts");
  await fsp.mkdir(artifactsDir, { recursive: true });
  const patchFilename = `${branchName.replace(/\//g, "-")}-${Date.now()}.patch`;
  const patchFile     = path.join(artifactsDir, patchFilename);
  await fsp.writeFile(patchFile, patchContent, "utf8");

  // ── Optionally create git branch ─────────────────────────
  let branchCreated = false;
  if (repoPath && fs.existsSync(repoPath)) {
    const created = tryGitCommand(
      `git checkout -b "${branchName}" 2>&1`,
      repoPath
    );
    branchCreated = created !== null;
    if (branchCreated) {
      console.log(`[patch] Created branch: ${branchName}`);
    }
  }

  // ── Apply patch if full_file and targetFile exists ───────
  let applied = false;
  if (patchData.patch_type === "full_file" && targetFile && patchContent) {
    await fsp.writeFile(targetFile, patchContent, "utf8");
    applied = true;
    console.log(`[patch] Applied full-file patch to ${targetFile}`);
  }

  console.log(
    `[patch] Done — branch=${branchName} applied=${applied} ` +
    `cost=$${(llmResult.cost_usd||0).toFixed(5)} model=${llmResult.model_id}`
  );

  return {
    branch_name:    branchName,
    explanation:    patchData.explanation || "",
    patch_file:     patchFile,
    patch_type:     patchData.patch_type || "diff",
    applied:        applied,
    branch_created: branchCreated,
    diff_preview:   patchContent.slice(0, 500),
    cost_usd:       llmResult.cost_usd || 0,
    model_used:     llmResult.model_id || llmResult.model_key,
    provider:       llmResult.provider,
  };
});
