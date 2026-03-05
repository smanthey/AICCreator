"use strict";

const pg = require("../../infra/postgres");
const { clamp01 } = require("./utils");
const { EVIDENCE_REQUIRED_BY_ISSUE } = require("./policy");

function severityFromConfidence(c) {
  if (c >= 0.86) return "blocker";
  if (c >= 0.65) return "warn";
  return "info";
}

function workflowForIssue(issueType) {
  switch (issueType) {
    case "duplicate_collection":
    case "duplicate_tradeline":
    case "balance_mismatch":
    case "date_inconsistency":
    case "mixed_file_indicator":
    case "unauthorized_inquiry":
    case "collection_status_validation":
      return "bureau_dispute";
    case "transfer_validation_needed":
      return "furnisher_dispute";
    case "collection_validation_needed":
      return "debt_validation";
    case "high_utilization":
      return "utilization_tuneup";
    default:
      return "manual_review";
  }
}

function pushIssue(out, issue) {
  out.push({
    ...issue,
    confidence: clamp01(issue.confidence),
    severity: issue.severity || severityFromConfidence(issue.confidence),
    recommended_workflow: issue.recommended_workflow || workflowForIssue(issue.issue_type),
    evidence_required: issue.evidence_required || EVIDENCE_REQUIRED_BY_ISSUE[issue.issue_type] || [],
    evidence_present: issue.evidence_present || [],
    score_impact_estimate: Number(issue.score_impact_estimate || 0),
  });
}

function detectDuplicates(rows, out) {
  const byKey = new Map();
  for (const r of rows) {
    const ref = String(r.account_ref || "").trim().toLowerCase();
    if (!ref) continue;
    const key = `${r.item_type}|${ref}|${String(r.furnisher_name || "").trim().toLowerCase()}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(r);
  }

  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    const first = group[0];
    const issueType = first.item_type === "collection" ? "duplicate_collection" : "duplicate_tradeline";
    pushIssue(out, {
      person_id: first.person_id,
      report_id: first.report_id,
      item_id: first.id,
      issue_type: issueType,
      confidence: 0.93,
      title: `Potential duplicate ${first.item_type.replace("_", " ")}`,
      details: `${group.length} records share account_ref=${first.account_ref || "(blank)"}`,
      rule_key: "dup_account_ref_furnisher",
      score_impact_estimate: first.item_type === "collection" ? 24 : 12,
    });
  }
}

function detectUtilization(rows, out) {
  const seen = new Set();
  for (const r of rows) {
    if (r.item_type !== "trade_line") continue;
    const k = `${String(r.account_ref || "").trim().toLowerCase()}|${String(r.furnisher_name || "").trim().toLowerCase()}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const bal = Number(r.balance);
    const lim = Number(r.credit_limit);
    if (!Number.isFinite(bal) || !Number.isFinite(lim) || lim <= 0) continue;
    const util = bal / lim;
    if (util < 0.70) continue;
    pushIssue(out, {
      person_id: r.person_id,
      report_id: r.report_id,
      item_id: r.id,
      issue_type: "high_utilization",
      confidence: util >= 0.9 ? 0.9 : 0.78,
      title: `High utilization (${Math.round(util * 100)}%)`,
      details: `Balance ${bal.toFixed(2)} on limit ${lim.toFixed(2)}`,
      rule_key: "utilization_threshold",
      score_impact_estimate: util >= 0.9 ? 30 : 16,
      evidence_required: [],
    });
  }
}

function detectBalanceMismatches(rows, out) {
  for (const r of rows) {
    if (r.item_type !== "trade_line") continue;
    const bal = Number(r.balance);
    const lim = Number(r.credit_limit);
    if (!Number.isFinite(bal) || !Number.isFinite(lim) || lim <= 0) continue;
    if (bal <= lim * 1.2) continue;

    pushIssue(out, {
      person_id: r.person_id,
      report_id: r.report_id,
      item_id: r.id,
      issue_type: "balance_mismatch",
      confidence: 0.84,
      title: "Balance exceeds expected credit limit range",
      details: `Balance ${bal.toFixed(2)} > 120% of limit ${lim.toFixed(2)}`,
      rule_key: "balance_gt_limit_multiplier",
      score_impact_estimate: 18,
    });
  }
}

function detectDateInconsistency(rows, out) {
  for (const r of rows) {
    const opened = r.opened_date ? new Date(r.opened_date) : null;
    const dofd = r.dofd_date ? new Date(r.dofd_date) : null;
    const lastPay = r.last_payment_date ? new Date(r.last_payment_date) : null;
    if (!dofd) continue;

    if (opened && dofd < opened) {
      pushIssue(out, {
        person_id: r.person_id,
        report_id: r.report_id,
        item_id: r.id,
        issue_type: "date_inconsistency",
        confidence: 0.88,
        title: "DOFD earlier than account opened date",
        details: `opened=${r.opened_date} dofd=${r.dofd_date}`,
        rule_key: "dofd_before_opened",
        score_impact_estimate: 14,
      });
    }

    if (lastPay && dofd > lastPay) {
      pushIssue(out, {
        person_id: r.person_id,
        report_id: r.report_id,
        item_id: r.id,
        issue_type: "date_inconsistency",
        confidence: 0.76,
        title: "DOFD occurs after last payment date",
        details: `last_payment=${r.last_payment_date} dofd=${r.dofd_date}`,
        rule_key: "dofd_after_last_payment",
        score_impact_estimate: 10,
      });
    }
  }
}

function detectCollectionValidationNeeded(rows, out) {
  for (const r of rows) {
    if (r.item_type !== "collection") continue;
    const hasRef = String(r.account_ref || "").trim().length > 0;
    if (hasRef) continue;
    pushIssue(out, {
      person_id: r.person_id,
      report_id: r.report_id,
      item_id: r.id,
      issue_type: "collection_validation_needed",
      confidence: 0.81,
      title: "Collection missing account reference",
      details: "Collection entry lacks account_ref; validation should be requested.",
      rule_key: "collection_missing_ref",
      score_impact_estimate: 20,
      evidence_required: [],
    });
  }
}

function detectUnauthorizedInquiries(rows, out) {
  const now = Date.now();
  for (const r of rows) {
    if (r.item_type !== "inquiry") continue;
    const opened = r.opened_date ? new Date(r.opened_date).getTime() : null;
    if (!opened) continue;
    const days = (now - opened) / (1000 * 60 * 60 * 24);
    if (days > 730) continue; // keep recent inquiries only
    pushIssue(out, {
      person_id: r.person_id,
      report_id: r.report_id,
      item_id: r.id,
      issue_type: "unauthorized_inquiry",
      confidence: 0.6,
      severity: "info",
      title: "Recent hard inquiry requires user confirmation",
      details: `Inquiry date ${r.opened_date}; confirm authorized vs unauthorized.`,
      rule_key: "recent_inquiry_review",
      score_impact_estimate: 6,
    });
  }
}

function detectMixedFileIndicators(rows, out) {
  const identityRows = rows.filter((r) => r.item_type === "personal_info");
  const buckets = new Map();
  for (const r of identityRows) {
    const raw = r.raw_data_json || {};
    const label = String(raw.field || raw.label || "").toLowerCase();
    const value = String(raw.value || r.remarks || "").trim().toLowerCase();
    if (!label || !value) continue;
    if (!buckets.has(label)) buckets.set(label, new Set());
    buckets.get(label).add(value);
  }

  const riskLabels = ["name", "address", "employer"];
  for (const label of riskLabels) {
    const vals = buckets.get(label);
    if (!vals || vals.size < 3) continue;
    const source = identityRows.find((r) => {
      const raw = r.raw_data_json || {};
      return String(raw.field || raw.label || "").toLowerCase() === label;
    });
    pushIssue(out, {
      person_id: source?.person_id || null,
      report_id: source?.report_id || null,
      item_id: source?.id || null,
      issue_type: "mixed_file_indicator",
      confidence: 0.89,
      title: `Mixed-file indicator: many ${label} variants`,
      details: `${vals.size} unique ${label} values detected in personal info.`,
      rule_key: "identity_variant_count",
      score_impact_estimate: 22,
    });
  }
}

function detectTransferValidationNeeded(rows, out) {
  const seen = new Set();
  const transferRe = /\b(transferred?|sold|assigned|assignment|purchased)\b/i;
  const closedLikeRe = /\b(closed|paid|transferred?)\b/i;

  for (const r of rows) {
    if (r.item_type !== "trade_line") continue;
    const blob = [
      r.furnisher_name,
      r.account_status,
      r.payment_status,
      r.remarks,
      JSON.stringify(r.raw_data_json || {}),
    ]
      .filter(Boolean)
      .join(" ");
    if (!transferRe.test(blob)) continue;

    const bal = Number(r.balance);
    if (Number.isFinite(bal) && bal > 1) continue;
    if (!closedLikeRe.test(blob)) continue;

    const dedupeKey = `transfer_validation_needed|${String(r.account_ref || "").toLowerCase()}|${String(r.furnisher_name || "").toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    pushIssue(out, {
      person_id: r.person_id,
      report_id: r.report_id,
      item_id: r.id,
      issue_type: "transfer_validation_needed",
      confidence: 0.82,
      title: "Transferred/closed account should be validated in writing",
      details: `Account appears transferred/assigned with zero or near-zero balance; request complete transfer chain and signed account records.`,
      rule_key: "transfer_zero_balance_validation",
      score_impact_estimate: 14,
      evidence_required: [],
    });
  }
}

function detectCollectionStatusValidation(rows, out) {
  const seen = new Set();
  const collectionRe = /\b(collection|charge[\s-]*off)\b/i;
  for (const r of rows) {
    if (r.item_type !== "trade_line") continue;
    const blob = [r.account_status, r.payment_status, r.remarks, JSON.stringify(r.raw_data_json || {})]
      .filter(Boolean)
      .join(" ");
    if (!collectionRe.test(blob)) continue;

    const dedupeKey = `collection_status_validation|${String(r.account_ref || "").toLowerCase()}|${String(r.furnisher_name || "").toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    pushIssue(out, {
      person_id: r.person_id,
      report_id: r.report_id,
      item_id: r.id,
      issue_type: "collection_status_validation",
      confidence: 0.74,
      title: "Collection/charge-off tradeline needs field-level validation",
      details: "Validate furnisher reporting fields, dates, and substantiation in writing.",
      rule_key: "collection_or_chargeoff_status_validation",
      score_impact_estimate: 16,
      evidence_required: [],
    });
  }
}

async function loadItemsByReport(reportId) {
  const { rows } = await pg.query(
    `SELECT id, person_id, report_id, bureau, item_type, account_ref, furnisher_name, creditor_type,
            account_status, payment_status, opened_date, last_reported_date, dofd_date, last_payment_date,
            balance, credit_limit, past_due_amount, terms, remarks, is_disputed, raw_data_json
     FROM credit_items
     WHERE report_id = $1`,
    [reportId]
  );
  return rows;
}

async function clearOpenIssuesForReport(reportId) {
  const { rows } = await pg.query(
    `SELECT id
     FROM credit_issues
     WHERE report_id = $1`,
    [reportId]
  );
  const issueIds = rows.map((r) => r.id);
  if (issueIds.length > 0) {
    await pg.query(
      `UPDATE credit_actions
       SET status = 'cancelled', updated_at = NOW()
       WHERE issue_id = ANY($1::uuid[])
         AND status IN ('draft', 'queued', 'blocked')`,
      [issueIds]
    );

    await pg.query(
      `UPDATE credit_deadlines
       SET status = 'done',
           notes = COALESCE(notes, '') || CASE WHEN COALESCE(notes, '') = '' THEN '' ELSE ' ' END || '[auto-closed by reanalysis]',
           updated_at = NOW()
       WHERE issue_id = ANY($1::uuid[])
         AND status = 'open'`,
      [issueIds]
    );
  }

  await pg.query(
    `UPDATE credit_issues
     SET status = 'dismissed', updated_at = NOW()
     WHERE report_id = $1 AND status IN ('open', 'in_review')`,
    [reportId]
  );
}

async function reconcileStaleArtifacts() {
  const closeActions = await pg.query(
    `UPDATE credit_actions a
     SET status = 'cancelled',
         updated_at = NOW()
     FROM credit_issues i
     WHERE a.issue_id = i.id
       AND a.status IN ('draft', 'queued', 'blocked')
       AND i.status IN ('dismissed', 'resolved', 'ignored')`
  );

  const closeDeadlines = await pg.query(
    `UPDATE credit_deadlines d
     SET status = 'done',
         notes = COALESCE(d.notes, '') || CASE WHEN COALESCE(d.notes, '') = '' THEN '' ELSE ' ' END || '[auto-closed by reconcile]',
         updated_at = NOW()
     FROM credit_issues i
     WHERE d.issue_id = i.id
       AND d.status = 'open'
       AND i.status IN ('dismissed', 'resolved', 'ignored')`
  );

  return {
    actions_closed: closeActions.rowCount || 0,
    deadlines_closed: closeDeadlines.rowCount || 0,
  };
}

async function insertIssues(issues) {
  let inserted = 0;
  let reopened = 0;

  for (const i of issues) {
    const upsertParams = [
      i.person_id,
      i.report_id,
      i.item_id,
      i.issue_type,
      i.severity,
      i.title,
      i.details || null,
      i.confidence,
      i.score_impact_estimate,
      i.rule_key || null,
      i.recommended_workflow,
      i.evidence_required || [],
      i.evidence_present || [],
      JSON.stringify(i.metadata || {}),
    ];

    const revived = await pg.query(
      `UPDATE credit_issues
       SET severity = $5,
           status = 'open',
           title = $6,
           details = $7,
           confidence = $8,
           score_impact_estimate = $9,
           rule_key = $10,
           recommended_workflow = $11,
           evidence_required = $12,
           evidence_present = $13,
           metadata_json = $14::jsonb,
           updated_at = NOW()
       WHERE id = (
         SELECT id
         FROM credit_issues
         WHERE person_id = $1::uuid
           AND report_id = $2::uuid
           AND item_id IS NOT DISTINCT FROM $3::uuid
           AND issue_type = $4::text
           AND COALESCE(rule_key, '') = COALESCE($10::text, '')
         ORDER BY created_at DESC
         LIMIT 1
       )
       RETURNING id`,
      upsertParams
    );

    if ((revived.rowCount || 0) > 0) {
      reopened += 1;
      continue;
    }

    await pg.query(
      `INSERT INTO credit_issues
         (person_id, report_id, item_id, issue_type, severity, status, title, details, confidence,
          score_impact_estimate, rule_key, recommended_workflow, evidence_required, evidence_present, metadata_json)
       VALUES
         ($1,$2,$3,$4,$5,'open',$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)`,
      upsertParams
    );
    inserted += 1;
  }
  return { inserted, reopened };
}

async function detectIssuesForReport(reportId, { clearExisting = true } = {}) {
  const rows = await loadItemsByReport(reportId);
  if (clearExisting) await clearOpenIssuesForReport(reportId);

  const issues = [];
  detectDuplicates(rows, issues);
  detectUtilization(rows, issues);
  detectBalanceMismatches(rows, issues);
  detectDateInconsistency(rows, issues);
  detectCollectionValidationNeeded(rows, issues);
  detectUnauthorizedInquiries(rows, issues);
  detectMixedFileIndicators(rows, issues);
  detectTransferValidationNeeded(rows, issues);
  detectCollectionStatusValidation(rows, issues);

  const write = await insertIssues(issues);
  return {
    scanned_items: rows.length,
    issues_detected: issues.length,
    issues_inserted: write.inserted,
    issues_reopened: write.reopened,
  };
}

async function detectIssuesPreviewForReport(reportId) {
  const rows = await loadItemsByReport(reportId);
  const issues = [];
  detectDuplicates(rows, issues);
  detectUtilization(rows, issues);
  detectBalanceMismatches(rows, issues);
  detectDateInconsistency(rows, issues);
  detectCollectionValidationNeeded(rows, issues);
  detectUnauthorizedInquiries(rows, issues);
  detectMixedFileIndicators(rows, issues);
  detectTransferValidationNeeded(rows, issues);
  detectCollectionStatusValidation(rows, issues);

  return {
    scanned_items: rows.length,
    issues_detected: issues.length,
    issues_inserted: 0,
    issues_reopened: 0,
  };
}

module.exports = {
  detectIssuesForReport,
  detectIssuesPreviewForReport,
  reconcileStaleArtifacts,
};
