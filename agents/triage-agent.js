// agents/triage-agent.js
// Analyzes QA results or failed task errors using Claude LLM.
// Produces structured diagnosis that judge.js can evaluate.
//
// Payload:
//   { task_id: "<uuid>" }          — triage a failed/completed task by ID
//   { error: "...", context: {} }  — triage arbitrary error inline

require("dotenv").config();
const pg           = require("../infra/postgres");
const { register } = require("./registry");
const { chatJson } = require("../infra/model-router");
// route "triage": deepseek_chat → gemini_flash → api_haiku (cheapest capable models)

const MAX_TOKENS = 1024;

const SYSTEM_PROMPT = `You are a diagnostic agent for an automated task orchestration system.
Analyze the provided error, context, and any test results, then return a JSON diagnosis.

ALWAYS respond with ONLY valid JSON matching this exact schema:
{
  "has_diagnosis": true,
  "diagnosis": "One clear sentence describing what went wrong",
  "root_cause": "Technical root cause (e.g. 'null pointer on line 42', 'HTTP 429 rate limit')",
  "has_evidence": true,
  "evidence": ["evidence point 1", "evidence point 2"],
  "suggested_fix": "Concrete actionable fix",
  "confidence": 0.85,
  "severity": "low|medium|high|critical",
  "category": "network|logic|auth|timeout|resource|unknown"
}

confidence must be 0.0–1.0. Be precise and concise.`;

register("triage", async (payload) => {
  let errorText = "";
  let contextData = {};
  let taskType = "unknown";

  // ── Load from DB if task_id provided ──────────────────────
  if (payload?.task_id) {
    const { rows } = await pg.query(
      `SELECT type, last_error, result, payload, status
       FROM tasks WHERE id = $1`,
      [payload.task_id]
    );
    if (!rows.length) throw new Error(`Task not found: ${payload.task_id}`);
    const t     = rows[0];
    taskType    = t.type;
    errorText   = t.last_error || JSON.stringify(t.result) || "(no error recorded)";
    contextData = { task_type: t.type, status: t.status, payload: t.payload };
  } else if (payload?.error) {
    errorText   = payload.error;
    contextData = payload.context || {};
    taskType    = payload.task_type || "unknown";
  } else {
    throw new Error("triage payload must include { task_id } or { error }");
  }

  const userMessage = `
Task type: ${taskType}
Error: ${errorText}
Context: ${JSON.stringify(contextData, null, 2)}
${payload?.qa_result ? `\nQA Result: ${JSON.stringify(payload.qa_result, null, 2)}` : ""}
`.trim();

  console.log(`[triage] Calling model-router for task_type=${taskType}...`);

  let llmResult, diagnosis;
  try {
    llmResult = await chatJson("triage", SYSTEM_PROMPT, userMessage,
      { max_tokens: MAX_TOKENS, task_id: payload?.task_id });
    diagnosis = llmResult.json;
  } catch (err) {
    console.warn("[triage] LLM failed:", err.message);
    diagnosis = {
      has_diagnosis: false,
      diagnosis:     "LLM call failed — manual investigation required",
      has_evidence:  false,
      evidence:      [err.message],
      suggested_fix: "Retry triage or investigate manually",
      confidence:    0.1,
      severity:      "unknown",
      category:      "unknown",
    };
    llmResult = { cost_usd: 0, model_id: "none", provider: "none" };
  }

  console.log(
    `[triage] severity=${diagnosis?.severity} confidence=${diagnosis?.confidence} ` +
    `cost=$${(llmResult.cost_usd || 0).toFixed(5)} model=${llmResult.model_id}`
  );

  return {
    ...diagnosis,
    task_id:    payload?.task_id || null,
    task_type:  taskType,
    cost_usd:   llmResult.cost_usd || 0,
    model_used: llmResult.model_id || llmResult.model_key,
    provider:   llmResult.provider,
  };
});
