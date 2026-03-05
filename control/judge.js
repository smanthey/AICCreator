// control/judge.js
// Judge layer: verifies triage diagnoses before patch tasks run.
// Deterministic checks first, then LLM semantic check if needed.
//
// Usage (called by judge agent handler):
//   const judge = require("../control/judge");
//   const verdict = await judge.evaluate(triageResult);

const pg = require("../infra/postgres");

/**
 * Evaluate a triage result and return a verdict.
 * Deterministic checks run first — LLM only used if inconclusive.
 *
 * @param {object} triageResult - Output from a triage task
 * @returns {Promise<{ verdict: "confirmed"|"rejected"|"inconclusive", reasoning: string, checks: object[] }>}
 */
async function evaluate(triageResult) {
  const checks = [];

  // ── Check 1: triage must have a diagnosis ─────────────────
  if (!triageResult?.diagnosis) {
    checks.push({ name: "has_diagnosis", pass: false, note: "No diagnosis field" });
    return { verdict: "rejected", reasoning: "Triage result missing diagnosis", checks };
  }
  checks.push({ name: "has_diagnosis", pass: true });

  // ── Check 2: must have evidence references ─────────────────
  const hasEvidence = Array.isArray(triageResult.evidence_refs) &&
                      triageResult.evidence_refs.length > 0;
  checks.push({ name: "has_evidence", pass: hasEvidence,
    note: hasEvidence ? null : "No evidence_refs array or empty" });

  // ── Check 3: confidence must be above threshold ────────────
  const confidence = Number(triageResult.confidence || 0);
  const confPass   = confidence >= 0.6;
  checks.push({ name: "confidence_threshold", pass: confPass,
    note: `confidence=${confidence} (threshold=0.6)` });

  // ── Check 4: suggested_fix must exist ─────────────────────
  const hasFix = Boolean(triageResult.suggested_fix);
  checks.push({ name: "has_suggested_fix", pass: hasFix,
    note: hasFix ? null : "No suggested_fix field" });

  const failures = checks.filter(c => !c.pass);

  if (failures.length === 0) {
    return {
      verdict:   "confirmed",
      reasoning: `All ${checks.length} deterministic checks passed`,
      checks,
      confidence
    };
  }

  if (failures.length >= 2) {
    return {
      verdict:   "rejected",
      reasoning: `${failures.length} checks failed: ${failures.map(f => f.name).join(", ")}`,
      checks,
      confidence
    };
  }

  // One marginal failure → inconclusive (could escalate to LLM later)
  return {
    verdict:   "inconclusive",
    reasoning: `1 check failed (${failures[0].name}): ${failures[0].note}`,
    checks,
    confidence
  };
}

/**
 * Load triage result from DB by task_id, then evaluate.
 */
async function evaluateByTaskId(triageTaskId) {
  const { rows } = await pg.query(
    `SELECT result FROM tasks WHERE id = $1 AND type = 'triage'`,
    [triageTaskId]
  );
  if (!rows.length) throw new Error(`Triage task not found: ${triageTaskId}`);
  const result = rows[0].result;
  return evaluate(result);
}

module.exports = { evaluate, evaluateByTaskId };
