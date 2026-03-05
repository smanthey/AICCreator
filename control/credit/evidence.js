"use strict";

const fs = require("fs");
const path = require("path");
const pg = require("../../infra/postgres");
const { EVIDENCE_REQUIRED_BY_ISSUE } = require("./policy");

const TYPE_ALIASES = new Map([
  ["id", "government_id"],
  ["government_id", "government_id"],
  ["driver_license", "government_id"],
  ["passport", "government_id"],
  ["proof_of_address", "proof_of_address"],
  ["address", "proof_of_address"],
  ["utility_bill", "proof_of_address"],
  ["statement", "statement_or_billing_record"],
  ["billing_record", "statement_or_billing_record"],
  ["statement_or_billing_record", "statement_or_billing_record"],
  ["identity_theft_report", "identity_theft_report"],
  ["ftc_report", "identity_theft_report"],
  ["police_report", "identity_theft_report"],
  ["prior_dispute_packet", "prior_dispute_packet"],
  ["response_evidence", "response_evidence"],
]);

function normalizeType(raw) {
  const k = String(raw || "").trim().toLowerCase();
  return TYPE_ALIASES.get(k) || null;
}

function detectTypeFromFilename(fileName) {
  const n = String(fileName || "").toLowerCase();
  const tokens = Array.from(TYPE_ALIASES.keys());
  for (const t of tokens) {
    if (n.includes(t)) return TYPE_ALIASES.get(t);
  }
  return null;
}

function walkFiles(root, out = []) {
  let ents = [];
  try {
    ents = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of ents) {
    const p = path.join(root, e.name);
    if (e.isDirectory()) {
      walkFiles(p, out);
      continue;
    }
    if (e.isFile()) out.push(p);
  }
  return out;
}

async function attachEvidence({
  personId,
  issueId = null,
  evidenceType,
  filePath,
  notes = "",
  metadata = {},
}) {
  const type = normalizeType(evidenceType) || evidenceType;
  if (!type) throw new Error("evidence_type_required");
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) throw new Error(`evidence_file_missing:${abs}`);

  const { rows } = await pg.query(
    `INSERT INTO credit_evidence (issue_id, person_id, evidence_type, file_path, notes, metadata_json)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [issueId, personId, type, abs, notes || null, JSON.stringify(metadata || {})]
  );
  return rows[0] || null;
}

async function refreshIssueEvidence(issueId) {
  const { rows } = await pg.query(
    `SELECT i.id, i.person_id, i.issue_type
     FROM credit_issues i
     WHERE i.id = $1
     LIMIT 1`,
    [issueId]
  );
  const issue = rows[0];
  if (!issue) return { updated: false, reason: "issue_not_found" };

  const required = EVIDENCE_REQUIRED_BY_ISSUE[issue.issue_type] || [];
  const ev = await pg.query(
    `SELECT DISTINCT evidence_type
     FROM credit_evidence
     WHERE person_id = $1
       AND (issue_id = $2 OR issue_id IS NULL)`,
    [issue.person_id, issue.id]
  );
  const present = Array.from(new Set(ev.rows.map((r) => String(r.evidence_type || ""))).values()).filter(Boolean);

  await pg.query(
    `UPDATE credit_issues
     SET evidence_required = $2::text[],
         evidence_present = $3::text[],
         updated_at = NOW()
     WHERE id = $1`,
    [issue.id, required, present]
  );
  return { updated: true, required, present };
}

async function refreshOpenIssuesForPerson(personId) {
  const { rows } = await pg.query(
    `SELECT id FROM credit_issues WHERE person_id = $1 AND status = 'open'`,
    [personId]
  );
  let updated = 0;
  for (const r of rows) {
    const res = await refreshIssueEvidence(r.id);
    if (res.updated) updated += 1;
  }
  return { updated, issues: rows.length };
}

async function ingestFolderForPerson(personId, rootDir, defaultType = null) {
  const absRoot = path.resolve(rootDir);
  if (!fs.existsSync(absRoot)) return { scanned: 0, attached: 0 };
  const files = walkFiles(absRoot);
  let attached = 0;
  for (const file of files) {
    const type = normalizeType(defaultType) || detectTypeFromFilename(path.basename(file));
    if (!type) continue;
    const row = await attachEvidence({
      personId,
      evidenceType: type,
      filePath: file,
      notes: "auto-attached from folder scan",
      metadata: { source: "folder_scan" },
    });
    if (row) attached += 1;
  }
  return { scanned: files.length, attached };
}

module.exports = {
  attachEvidence,
  refreshIssueEvidence,
  refreshOpenIssuesForPerson,
  ingestFolderForPerson,
};

