"use strict";

const pg = require("../../infra/postgres");
const { loadComplianceKb } = require("./compliance-kb");

const DISPUTE_CADENCE_WINDOW_DAYS = Number(process.env.CREDIT_DISPUTE_CADENCE_DAYS || "45");
const MAX_BUREAU_DISPUTES_PER_CYCLE = Number(process.env.CREDIT_MAX_BUREAU_DISPUTES_PER_CYCLE || "5");
const KB = loadComplianceKb();

const EVIDENCE_REQUIRED_BY_ISSUE = Object.freeze(KB.issueEvidence);

const ACTION_MATRIX = Object.freeze(
  Object.fromEntries(
    Object.entries(KB.allowedActions || {}).map(([action, issues]) => [action, new Set(issues)])
  )
);

function missingEvidence(issueType, evidenceTags = []) {
  const req = EVIDENCE_REQUIRED_BY_ISSUE[issueType] || [];
  const have = new Set((evidenceTags || []).map((x) => String(x)));
  return req.filter((k) => !have.has(k));
}

async function recordDecision({ action, allowed, reason, evidence = {}, decidedBy = "credit-policy-engine" }) {
  const { rows } = await pg.query(
    `INSERT INTO policy_decisions (domain, action, allowed, reason, evidence_json, decided_by)
     VALUES ('credit', $1, $2, $3, $4::jsonb, $5)
     RETURNING id, created_at`,
    [action, allowed, reason, JSON.stringify(evidence || {}), decidedBy]
  );
  return { ...rows[0], reason };
}

async function evaluateCreditAction({
  actionType,
  issueType,
  evidenceTags = [],
  assertedNotMine = false,
  recentBureauDisputes = 0,
}) {
  const allowedIssues = ACTION_MATRIX[actionType] || new Set();
  if (!allowedIssues.has(issueType)) {
    const decision = await recordDecision({
      action: actionType,
      allowed: false,
      reason: `Action "${actionType}" not allowed for issue "${issueType}"`,
      evidence: { issueType, evidenceTags },
    });
    return { allowed: false, reason: decision.reason, decision_id: decision.id };
  }

  if (issueType === "not_mine_account" && !assertedNotMine) {
    const decision = await recordDecision({
      action: actionType,
      allowed: false,
      reason: "Blocked: not_mine_account requires explicit assertedNotMine=true",
      evidence: { issueType, evidenceTags, assertedNotMine },
    });
    return { allowed: false, reason: decision.reason, decision_id: decision.id };
  }

  const missing = missingEvidence(issueType, evidenceTags);
  if (missing.length > 0) {
    const decision = await recordDecision({
      action: actionType,
      allowed: false,
      reason: `Missing required evidence: ${missing.join(", ")}`,
      evidence: { issueType, evidenceTags, missing },
    });
    return { allowed: false, reason: decision.reason, decision_id: decision.id };
  }

  if (actionType === "bureau_dispute" && Number(recentBureauDisputes || 0) >= MAX_BUREAU_DISPUTES_PER_CYCLE) {
    const decision = await recordDecision({
      action: actionType,
      allowed: false,
      reason: `Cadence cap reached: ${recentBureauDisputes}/${MAX_BUREAU_DISPUTES_PER_CYCLE} disputes in ${DISPUTE_CADENCE_WINDOW_DAYS}d`,
      evidence: {
        issueType,
        evidenceTags,
        recentBureauDisputes: Number(recentBureauDisputes || 0),
        max: MAX_BUREAU_DISPUTES_PER_CYCLE,
        window_days: DISPUTE_CADENCE_WINDOW_DAYS,
      },
    });
    return { allowed: false, reason: decision.reason, decision_id: decision.id };
  }

  const decision = await recordDecision({
    action: actionType,
    allowed: true,
    reason: "Allowed by credit policy matrix",
    evidence: { issueType, evidenceTags, assertedNotMine },
  });
  return { allowed: true, reason: decision.reason, decision_id: decision.id };
}

module.exports = {
  EVIDENCE_REQUIRED_BY_ISSUE,
  DISPUTE_CADENCE_WINDOW_DAYS,
  MAX_BUREAU_DISPUTES_PER_CYCLE,
  evaluateCreditAction,
};
