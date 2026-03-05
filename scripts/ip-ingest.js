#!/usr/bin/env node
"use strict";

require("dotenv").config();

const path = require("path");
const pg = require("../infra/postgres");
const {
  sha256File,
  detectMime,
  extractText,
  classifyDocType,
  extractIpIdentifiers,
  extractLikelyMarkText,
  recursiveListFiles,
  normalizeMachine,
  toDateOnly,
} = require("../control/ip/utils");
const { parseOfficeAction } = require("../control/ip/office-action");
const { getRules, classifyDocumentByRules, detectIssuesByRules, buildDeadlineByRules } = require("../control/ip/rules-engine");

const args = process.argv.slice(2);
const getArg = (flag, fallback = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};
const hasFlag = (flag) => args.includes(flag);

const SOURCE_MODE = String(getArg("--source", "files")).toLowerCase();
const DOC_SOURCE_TYPE = SOURCE_MODE === "file_index" ? "files" : SOURCE_MODE;
const ROOT = getArg("--root", null);
const MACHINE = normalizeMachine(getArg("--machine", "unknown"));
const LIMIT = Math.max(1, Number(getArg("--limit", "5000")) || 5000);
const DRY_RUN = hasFlag("--dry-run");

const ALLOWED_EXT = new Set([
  ".pdf", ".txt", ".md", ".html", ".htm", ".eml", ".jpg", ".jpeg", ".png", ".docx", ".json", ".csv",
]);

async function upsertEntity(entityType, value) {
  const { rows } = await pg.query(
    `INSERT INTO ip_entities (entity_type, value, normalized_value)
     VALUES ($1, $2, $3)
     ON CONFLICT (entity_type, value)
     DO UPDATE SET normalized_value = EXCLUDED.normalized_value
     RETURNING id`,
    [entityType, value, String(value || "").toLowerCase()]
  );
  return rows[0].id;
}

async function linkDocEntity(docId, entityId, confidence = 0.9) {
  await pg.query(
    `INSERT INTO ip_document_entities (doc_id, entity_id, confidence)
     VALUES ($1, $2, $3)
     ON CONFLICT (doc_id, entity_id, offset_start, offset_end) DO NOTHING`,
    [docId, entityId, confidence]
  );
}

async function resolveCase({ ids, title, text, sourceHint }) {
  const serial = ids.tm_serials[0] || null;
  const reg = ids.tm_regs[0] || null;
  const patentApp = ids.patent_apps[0] || null;
  const copyright = ids.copyrights[0] || null;

  if (serial) {
    const hit = await pg.query(`SELECT id FROM ip_cases WHERE serial_number = $1 LIMIT 1`, [serial]);
    if (hit.rows.length) return hit.rows[0].id;
  }
  if (reg) {
    const hit = await pg.query(`SELECT id FROM ip_cases WHERE registration_number = $1 LIMIT 1`, [reg]);
    if (hit.rows.length) return hit.rows[0].id;
  }

  const ipType = serial || reg ? "TM" : (patentApp ? "PT" : (copyright ? "CR" : "TM"));
  const mark = extractLikelyMarkText(title, text);
  const caseKey = serial ? `TM-${serial}` : reg ? `TMR-${reg}` : patentApp ? `PT-${patentApp}` : copyright ? `CR-${copyright}` : `DISC-${Buffer.from(String(title || "untitled")).toString("hex").slice(0, 16)}`;

  const created = await pg.query(
    `INSERT INTO ip_cases
      (ip_type, case_key, primary_mark_text, serial_number, registration_number, patent_application_number, copyright_reg_number,
       status, source_discovered_from, confidence)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'open',$8,$9)
     ON CONFLICT (case_key)
     DO UPDATE SET
       primary_mark_text = COALESCE(ip_cases.primary_mark_text, EXCLUDED.primary_mark_text),
       serial_number = COALESCE(ip_cases.serial_number, EXCLUDED.serial_number),
       registration_number = COALESCE(ip_cases.registration_number, EXCLUDED.registration_number),
       patent_application_number = COALESCE(ip_cases.patent_application_number, EXCLUDED.patent_application_number),
       copyright_reg_number = COALESCE(ip_cases.copyright_reg_number, EXCLUDED.copyright_reg_number),
       updated_at = NOW()
     RETURNING id`,
    [ipType, caseKey, mark, serial, reg, patentApp, copyright, sourceHint || "ingest", mark ? 0.85 : 0.55]
  );
  return created.rows[0].id;
}

async function saveOfficeActionArtifacts({ caseId, docId, text, ruleSetVersion, rules }) {
  const parsed = parseOfficeAction(text);
  const detected = detectIssuesByRules(text, rules);
  const mergedIssues = new Map();
  for (const i of parsed.issues || []) mergedIssues.set(i.issue_type, i);
  for (const i of detected) {
    if (!mergedIssues.has(i.issue_type)) {
      mergedIssues.set(i.issue_type, {
        issue_type: i.issue_type,
        severity: i.severity,
        extracted_text_snippet: null,
        recommended_actions: [],
      });
    }
  }
  parsed.issues = [...mergedIssues.values()];
  if (!parsed.office_action_type && parsed.issues.length === 0) return;

  const deterministicDeadline = buildDeadlineByRules(parsed.office_action_type === "final" ? "final" : "nonfinal", parsed.issue_date, rules);
  if (deterministicDeadline) parsed.deadlines = [deterministicDeadline];

  const event = await pg.query(
    `INSERT INTO ip_events (case_id, doc_id, event_type, event_date, summary, metadata_json, rule_set_version)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
     RETURNING id`,
    [
      caseId,
      docId,
      parsed.office_action_type === "final" ? "office_action_final" : "office_action_nonfinal",
      parsed.issue_date,
      `Parsed office action (${parsed.office_action_type || "unknown"})`,
      JSON.stringify(parsed),
      ruleSetVersion || null,
    ]
  );
  const eventId = event.rows[0].id;

  for (const issue of parsed.issues) {
    await pg.query(
      `INSERT INTO ip_issues
        (case_id, event_id, detected_from_doc_id, issue_type, severity, extracted_text_snippet, recommended_actions_json, status, rule_set_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,'open',$8)`,
      [caseId, eventId, docId, issue.issue_type, issue.severity, issue.extracted_text_snippet || null, JSON.stringify(issue.recommended_actions || []), ruleSetVersion || null]
    );
  }

  for (const d of parsed.deadlines) {
    await pg.query(
      `INSERT INTO ip_deadlines (case_id, trigger_event_id, deadline_type, due_date, source, notes, status)
       VALUES ($1,$2,$3,$4,$5,$6,'open')
       ON CONFLICT DO NOTHING`,
      [caseId, eventId, d.deadline_type, d.due_date, d.source, d.notes || null]
    );
  }
}

async function ingestFile(filePath, stats) {
  const { rules, version: ruleSetVersion } = await getRules();
  const sha = sha256File(filePath);
  const existing = await pg.query(`SELECT id FROM ip_documents WHERE sha256 = $1 LIMIT 1`, [sha]);
  if (existing.rows.length) {
    stats.duplicates += 1;
    return;
  }

  const title = path.basename(filePath);
  const text = extractText(filePath);
  const ids = extractIpIdentifiers(`${title}\n${text}`);
  const deterministicClass = classifyDocumentByRules({ title, text, filePath }, rules);
  const fallbackDocType = classifyDocType({ title, text, filePath });
  const docType = deterministicClass.doc_type !== "other" ? deterministicClass.doc_type : fallbackDocType;
  const caseId = await resolveCase({ ids, title, text, sourceHint: SOURCE_MODE });

  if (DRY_RUN) {
    stats.dry += 1;
    return;
  }

  const inserted = await pg.query(
    `INSERT INTO ip_documents
      (case_id, source_type, source_machine, source_path, title, doc_type, doc_date, sha256, mime_type, file_path_original, file_path_normalized, extracted_text)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING id`,
    [
      caseId,
      DOC_SOURCE_TYPE,
      MACHINE,
      filePath,
      title,
      docType,
      toDateOnly(new Date()),
      sha,
      detectMime(filePath),
      filePath,
      filePath,
      text || null,
    ]
  );

  const docId = inserted.rows[0].id;

  for (const serial of ids.tm_serials) {
    const entId = await upsertEntity("tm_serial", serial);
    await linkDocEntity(docId, entId, 0.98);
  }
  for (const reg of ids.tm_regs) {
    const entId = await upsertEntity("tm_registration", reg);
    await linkDocEntity(docId, entId, 0.98);
  }
  for (const app of ids.patent_apps) {
    const entId = await upsertEntity("patent_application", app);
    await linkDocEntity(docId, entId, 0.95);
  }
  for (const cr of ids.copyrights) {
    const entId = await upsertEntity("copyright_registration", cr);
    await linkDocEntity(docId, entId, 0.95);
  }

      if (docType === "office_action") {
    await saveOfficeActionArtifacts({ caseId, docId, text, ruleSetVersion, rules });
  }

  if (docType === "filing_receipt" || docType === "teas_filing") {
    await pg.query(
      `INSERT INTO ip_events (case_id, doc_id, event_type, event_date, summary)
       VALUES ($1, $2, $3, $4, $5)`,
      [caseId, docId, "filing_receipt", toDateOnly(new Date()), "Ingested filing receipt/TEAS document"]
    );
  }

  stats.ingested += 1;
}

async function ingestFromFileIndex(stats) {
  const { rows } = await pg.query(
    `SELECT path
     FROM file_index
     WHERE path IS NOT NULL
       AND (
         lower(path) LIKE '%uspto%'
         OR lower(path) LIKE '%trademark%'
         OR lower(path) LIKE '%copyright%'
         OR lower(path) LIKE '%patent%'
         OR lower(path) LIKE '%teas%'
         OR lower(path) LIKE '%tsdr%'
       )
     ORDER BY indexed_at DESC
     LIMIT $1`,
    [LIMIT]
  );
  stats.scanned = rows.length;

  for (const row of rows) {
    try {
      if (!require("fs").existsSync(row.path)) {
        stats.skipped_missing += 1;
        continue;
      }
      await ingestFile(row.path, stats);
    } catch (err) {
      stats.errors += 1;
      console.warn(`[ip-ingest] failed ${row.path}: ${err.message}`);
    }
  }
}

async function main() {
  if (SOURCE_MODE !== "file_index" && !ROOT) {
    throw new Error("--root is required unless --source file_index is used");
  }

  const stats = { scanned: 0, ingested: 0, duplicates: 0, skipped_missing: 0, errors: 0, dry: 0 };

  if (SOURCE_MODE === "file_index") {
    await ingestFromFileIndex(stats);
  } else {
    const files = recursiveListFiles(ROOT, ALLOWED_EXT).slice(0, LIMIT);
    stats.scanned = files.length;
    for (const file of files) {
      try {
        await ingestFile(file, stats);
      } catch (err) {
        stats.errors += 1;
        console.warn(`[ip-ingest] failed ${file}: ${err.message}`);
      }
    }
  }

  console.log(`\n[ip-ingest] source=${SOURCE_MODE} machine=${MACHINE}`);
  console.log(`[ip-ingest] scanned=${stats.scanned} ingested=${stats.ingested} duplicates=${stats.duplicates} skipped_missing=${stats.skipped_missing} dry=${stats.dry} errors=${stats.errors}`);
}

main()
  .then(async () => { await pg.end(); })
  .catch(async (err) => {
    console.error("Fatal:", err.message);
    await pg.end();
    process.exit(1);
  });
