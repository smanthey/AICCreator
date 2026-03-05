"use strict";

const fs = require("fs");
const path = require("path");
const pg = require("../../infra/postgres");
const {
  getRules,
  classifyDocumentByRules,
  detectIssuesByRules,
  buildDeadlineByRules,
} = require("./rules-engine");
const { applyJsonPatch, deepClone } = require("./rule-patch");

function getByPointer(obj, pointer) {
  if (!pointer || pointer === "/" || pointer === "") return obj;
  const parts = String(pointer).split("/").slice(1).map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    if (Array.isArray(cur)) cur = cur[Number(p)];
    else cur = cur[p];
  }
  return cur;
}

function toJsonPointerFromRulePath(rulePath) {
  if (!rulePath) return "";
  return `/${String(rulePath).split(".").map((p) => p.replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}`;
}

function buildPatchOpsFromProposal(proposal) {
  if (!proposal) return [];
  if (Array.isArray(proposal.patch)) return proposal.patch;
  if (Array.isArray(proposal.proposals)) {
    return proposal.proposals
      .filter((p) => p && p.rule_path)
      .map((p) => ({
        op: p.change_type === "remove" ? "remove" : "replace",
        path: toJsonPointerFromRulePath(p.rule_path),
        value: p.after,
        rationale: p.expected_impact || p.reason || null,
      }));
  }
  return [];
}

function computePrf(tp, fp, fn) {
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f1, tp, fp, fn };
}

function round3(n) {
  return Math.round((Number(n || 0) + Number.EPSILON) * 1000) / 1000;
}

function normalizeType(type) {
  return String(type || "").toLowerCase();
}

async function fetchEvaluationDocs(limit = 2000) {
  const { rows } = await pg.query(
    `SELECT id, case_id, doc_type, title, source_path, extracted_text
     FROM ip_documents
     WHERE extracted_text IS NOT NULL
       AND extracted_text <> ''
       AND doc_type IS NOT NULL
       AND doc_type <> 'other'
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

async function fetchIssueTruth(limit = 5000) {
  const { rows } = await pg.query(
    `SELECT detected_from_doc_id AS doc_id, issue_type
     FROM ip_issues
     WHERE detected_from_doc_id IS NOT NULL
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );

  const map = new Map();
  for (const row of rows) {
    const docId = row.doc_id;
    if (!map.has(docId)) map.set(docId, new Set());
    map.get(docId).add(String(row.issue_type || ""));
  }
  return map;
}

async function fetchDeadlineSamples(limit = 2000) {
  const { rows } = await pg.query(
    `SELECT e.id AS event_id,
            e.event_type,
            e.event_date,
            e.metadata_json,
            d.due_date
     FROM ip_events e
     LEFT JOIN ip_deadlines d ON d.trigger_event_id = e.id AND d.status = 'open'
     WHERE e.event_type IN ('office_action_nonfinal','office_action_final')
       AND e.event_date IS NOT NULL
     ORDER BY e.created_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

function evaluateDocsWithRules(docs, issueTruthMap, rules) {
  const docTypes = new Set(docs.map((d) => normalizeType(d.doc_type)).filter(Boolean));
  const docTypeCounts = new Map();

  for (const t of docTypes) {
    docTypeCounts.set(t, { tp: 0, fp: 0, fn: 0 });
  }

  const issueTypes = new Set();
  const issueCounts = new Map();

  let docCorrect = 0;

  for (const doc of docs) {
    const truthDocType = normalizeType(doc.doc_type);
    const predDocType = normalizeType(classifyDocumentByRules({
      title: doc.title,
      text: doc.extracted_text,
      filePath: doc.source_path,
    }, rules).doc_type);

    if (predDocType === truthDocType) docCorrect += 1;

    for (const t of docTypes) {
      const c = docTypeCounts.get(t);
      const truth = truthDocType === t;
      const pred = predDocType === t;
      if (truth && pred) c.tp += 1;
      else if (!truth && pred) c.fp += 1;
      else if (truth && !pred) c.fn += 1;
    }

    const predictedIssues = new Set(detectIssuesByRules(doc.extracted_text || "", rules).map((x) => String(x.issue_type || "")));
    const truthIssues = issueTruthMap.get(doc.id) || new Set();

    for (const it of truthIssues) issueTypes.add(it);
    for (const it of predictedIssues) issueTypes.add(it);

    for (const it of issueTypes) {
      if (!issueCounts.has(it)) issueCounts.set(it, { tp: 0, fp: 0, fn: 0 });
      const c = issueCounts.get(it);
      const truth = truthIssues.has(it);
      const pred = predictedIssues.has(it);
      if (truth && pred) c.tp += 1;
      else if (!truth && pred) c.fp += 1;
      else if (truth && !pred) c.fn += 1;
    }
  }

  const docTypeMetrics = {};
  for (const [type, c] of docTypeCounts.entries()) {
    docTypeMetrics[type] = computePrf(c.tp, c.fp, c.fn);
  }

  const issueMetrics = {};
  for (const [type, c] of issueCounts.entries()) {
    issueMetrics[type] = computePrf(c.tp, c.fp, c.fn);
  }

  const docMacro = Object.values(docTypeMetrics);
  const issueMacro = Object.values(issueMetrics);

  return {
    docs_scanned: docs.length,
    doc_accuracy: docs.length ? round3(docCorrect / docs.length) : 0,
    doc_type_metrics: docTypeMetrics,
    doc_type_macro: {
      precision: round3(docMacro.length ? docMacro.reduce((a, b) => a + b.precision, 0) / docMacro.length : 0),
      recall: round3(docMacro.length ? docMacro.reduce((a, b) => a + b.recall, 0) / docMacro.length : 0),
      f1: round3(docMacro.length ? docMacro.reduce((a, b) => a + b.f1, 0) / docMacro.length : 0),
    },
    issue_metrics: issueMetrics,
    issue_macro: {
      precision: round3(issueMacro.length ? issueMacro.reduce((a, b) => a + b.precision, 0) / issueMacro.length : 0),
      recall: round3(issueMacro.length ? issueMacro.reduce((a, b) => a + b.recall, 0) / issueMacro.length : 0),
      f1: round3(issueMacro.length ? issueMacro.reduce((a, b) => a + b.f1, 0) / issueMacro.length : 0),
    },
  };
}

function inferOfficeActionType(row) {
  if (row.event_type === "office_action_final") return "final";
  if (row.event_type === "office_action_nonfinal") return "nonfinal";

  const t = String(row.metadata_json?.office_action_type || "").toLowerCase();
  return t === "final" ? "final" : "nonfinal";
}

function evaluateDeadlines(rows, rules) {
  let checked = 0;
  let matches = 0;

  for (const row of rows) {
    const oaType = inferOfficeActionType(row);
    const expected = buildDeadlineByRules(oaType, row.event_date, rules);
    if (!expected || !row.due_date) continue;
    checked += 1;
    if (String(expected.due_date) === String(row.due_date).slice(0, 10)) matches += 1;
  }

  return {
    checked,
    matches,
    consistency: checked > 0 ? round3(matches / checked) : 0,
  };
}

async function simulateAgainstRules(rules, { limitDocs = 2000, limitIssues = 5000, limitDeadlines = 2000 } = {}) {
  const [docs, issueTruthMap, deadlines] = await Promise.all([
    fetchEvaluationDocs(limitDocs),
    fetchIssueTruth(limitIssues),
    fetchDeadlineSamples(limitDeadlines),
  ]);

  const docIssue = evaluateDocsWithRules(docs, issueTruthMap, rules);
  const deadline = evaluateDeadlines(deadlines, rules);

  return {
    evaluated_at: new Date().toISOString(),
    ...docIssue,
    deadline_consistency: deadline,
  };
}

function loadProposalFromFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);
  const ops = buildPatchOpsFromProposal(parsed);
  return { parsed, ops };
}

function buildPatchedRules(baseRules, patchOps) {
  if (!Array.isArray(patchOps) || patchOps.length === 0) return deepClone(baseRules);
  return applyJsonPatch(baseRules, patchOps);
}

function getPatchBeforeAfter(baseRules, patchOps) {
  const out = [];
  for (const op of patchOps || []) {
    const before = getByPointer(baseRules, op.path);
    out.push({
      op: op.op,
      path: op.path,
      before,
      after: op.op === "remove" ? null : op.value,
      rationale: op.rationale || null,
    });
  }
  return out;
}

async function getOutcomeStats() {
  const { rows } = await pg.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE result = 'accepted')::int AS accepted,
       AVG(NULLIF(cycles_to_resolution,0))::numeric(10,3) AS avg_cycles,
       AVG(NULLIF(time_to_resolution_days,0))::numeric(10,3) AS avg_days,
       COALESCE(SUM((metadata_json->>'scope_reduction_penalty')::numeric),0)::numeric(12,3) AS scope_penalty,
       COALESCE(SUM((metadata_json->>'fee_penalty')::numeric),0)::numeric(12,3) AS fee_penalty
     FROM ip_case_outcomes`
  );
  return rows[0] || {
    total: 0,
    accepted: 0,
    avg_cycles: 0,
    avg_days: 0,
    scope_penalty: 0,
    fee_penalty: 0,
  };
}

function computeWeightedScore(outcomeStats, weights = {}) {
  const approvalWeight = Number(weights.approval_weight ?? 0.5);
  const cycleWeight = Number(weights.cycle_weight ?? 0.3);
  const scopeWeight = Number(weights.scope_weight ?? 1.0);
  const feeWeight = Number(weights.fee_weight ?? 1.0);

  const total = Number(outcomeStats.total || 0);
  const approval = total > 0 ? Number(outcomeStats.accepted || 0) / total : 0;
  const avgCycles = Number(outcomeStats.avg_cycles || 0);
  const avgDays = Number(outcomeStats.avg_days || 0);

  const speedByCycles = 1 / (1 + Math.max(0, avgCycles - 1));
  const speedByDays = avgDays > 0 ? 1 / (1 + (avgDays / 90)) : 0;
  const speed = round3((speedByCycles + speedByDays) / 2);

  const scopePenalty = round3(Number(outcomeStats.scope_penalty || 0) * scopeWeight);
  const feePenalty = round3(Number(outcomeStats.fee_penalty || 0) * feeWeight);

  const score = round3((approvalWeight * approval) + (cycleWeight * speed) - scopePenalty - feePenalty);

  return {
    approval: round3(approval),
    speed,
    scope_penalty: scopePenalty,
    fee_penalty: feePenalty,
    score,
    weights: {
      approval_weight: approvalWeight,
      cycle_weight: cycleWeight,
      scope_weight: scopeWeight,
      fee_weight: feeWeight,
    },
    raw: {
      total,
      accepted: Number(outcomeStats.accepted || 0),
      avg_cycles: avgCycles,
      avg_days: avgDays,
    },
  };
}

async function getActiveRules() {
  const { rules, version, name, filePath } = await getRules();
  return { rules, version, name, filePath };
}

module.exports = {
  getActiveRules,
  loadProposalFromFile,
  buildPatchedRules,
  simulateAgainstRules,
  getPatchBeforeAfter,
  getOutcomeStats,
  computeWeightedScore,
};
