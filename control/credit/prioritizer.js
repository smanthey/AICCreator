"use strict";

const PHASE_BY_ISSUE = Object.freeze({
  mixed_file_indicator: 1,
  not_mine_account: 1,
  duplicate_tradeline: 1,
  duplicate_collection: 1,
  high_utilization: 2,
  collection_validation_needed: 3,
  balance_mismatch: 3,
  date_inconsistency: 3,
  unauthorized_inquiry: 3,
});

function phaseForIssue(issueType) {
  return PHASE_BY_ISSUE[issueType] || 3;
}

function rankKey(issue) {
  return {
    phase: phaseForIssue(issue.issue_type),
    impact: Number(issue.score_impact_estimate || 0),
    confidence: Number(issue.confidence || 0),
    createdAt: issue.created_at ? new Date(issue.created_at).getTime() : 0,
  };
}

function compareIssues(a, b) {
  const ka = rankKey(a);
  const kb = rankKey(b);
  if (ka.phase !== kb.phase) return ka.phase - kb.phase;
  if (ka.impact !== kb.impact) return kb.impact - ka.impact;
  if (ka.confidence !== kb.confidence) return kb.confidence - ka.confidence;
  return kb.createdAt - ka.createdAt;
}

function orderIssues(issues = []) {
  return [...issues].sort(compareIssues);
}

module.exports = {
  phaseForIssue,
  orderIssues,
};

