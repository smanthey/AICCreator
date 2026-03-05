"use strict";

const path = require("path");
const pg = require("../../infra/postgres");
const {
  toIsoDate,
  parseMoney,
  readJsonFile,
  fileSha256,
  normalizeArray,
} = require("./utils");

function normalizeBureau(v) {
  const b = String(v || "other").trim().toLowerCase();
  if (["equifax", "experian", "transunion"].includes(b)) return b;
  return "other";
}

function normalizeItemType(v) {
  const t = String(v || "other").trim().toLowerCase();
  const map = {
    tradeline: "trade_line",
    trade_line: "trade_line",
    collection: "collection",
    inquiry: "inquiry",
    public_record: "public_record",
    personal_info: "personal_info",
    other: "other",
  };
  return map[t] || "other";
}

async function upsertPerson(personKey, person = {}) {
  const { rows } = await pg.query(
    `INSERT INTO credit_person_profiles
       (external_key, full_name, legal_name, dob, ssn_last4, phone, email, current_address, metadata_json)
     VALUES
       ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
     ON CONFLICT (external_key)
     DO UPDATE SET
       full_name = COALESCE(EXCLUDED.full_name, credit_person_profiles.full_name),
       legal_name = COALESCE(EXCLUDED.legal_name, credit_person_profiles.legal_name),
       dob = COALESCE(EXCLUDED.dob, credit_person_profiles.dob),
       ssn_last4 = COALESCE(EXCLUDED.ssn_last4, credit_person_profiles.ssn_last4),
       phone = COALESCE(EXCLUDED.phone, credit_person_profiles.phone),
       email = COALESCE(EXCLUDED.email, credit_person_profiles.email),
       current_address = COALESCE(EXCLUDED.current_address, credit_person_profiles.current_address),
       metadata_json = credit_person_profiles.metadata_json || EXCLUDED.metadata_json
     RETURNING id, external_key`,
    [
      personKey,
      person.full_name || null,
      person.legal_name || null,
      toIsoDate(person.dob),
      person.ssn_last4 || null,
      person.phone || null,
      person.email || null,
      person.current_address || null,
      JSON.stringify(person.metadata || {}),
    ]
  );
  return rows[0];
}

async function insertReport(personId, report, filePath = null, sourceHash = null) {
  const bureau = normalizeBureau(report.bureau);
  const reportDate = toIsoDate(report.report_date || report.date || new Date());
  const sourceType = String(report.source_type || (filePath ? "upload" : "manual")).toLowerCase();
  const sourcePath = report.source_path || filePath || null;
  const rawText = report.raw_text || null;
  const metadata = report.metadata || {};

  const { rows } = await pg.query(
    `INSERT INTO credit_reports
       (person_id, bureau, report_date, source_type, source_path, source_hash, raw_text, metadata_json)
     VALUES
       ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
     ON CONFLICT (person_id, bureau, report_date, COALESCE(source_hash, ''))
     DO UPDATE SET
       source_path = COALESCE(EXCLUDED.source_path, credit_reports.source_path),
       raw_text = COALESCE(EXCLUDED.raw_text, credit_reports.raw_text),
       metadata_json = credit_reports.metadata_json || EXCLUDED.metadata_json
     RETURNING id, bureau, report_date`,
    [personId, bureau, reportDate, sourceType, sourcePath, sourceHash, rawText, JSON.stringify(metadata)]
  );
  const row = rows[0];
  return {
    ...row,
    report_date: row?.report_date instanceof Date
      ? row.report_date.toISOString().slice(0, 10)
      : String(row?.report_date || ""),
  };
}

async function insertItems(personId, reportId, bureau, items) {
  let inserted = 0;
  for (const raw of normalizeArray(items)) {
    const itemType = normalizeItemType(raw.item_type || raw.type);
    await pg.query(
      `INSERT INTO credit_items
         (report_id, person_id, bureau, item_type, account_ref, furnisher_name, creditor_type,
          account_status, payment_status, opened_date, last_reported_date, dofd_date, last_payment_date,
          closed_date, monthly_payment, balance, credit_limit, past_due_amount, high_balance,
          terms, remarks, is_disputed, raw_data_json)
       VALUES
         ($1,$2,$3,$4,$5,$6,$7,
          $8,$9,$10,$11,$12,$13,
          $14,$15,$16,$17,$18,$19,
          $20,$21,$22,$23::jsonb)`,
      [
        reportId,
        personId,
        bureau,
        itemType,
        raw.account_ref || raw.account_number || null,
        raw.furnisher_name || raw.creditor_name || null,
        raw.creditor_type || null,
        raw.account_status || raw.status || null,
        raw.payment_status || null,
        toIsoDate(raw.opened_date),
        toIsoDate(raw.last_reported_date),
        toIsoDate(raw.dofd_date || raw.date_of_first_delinquency),
        toIsoDate(raw.last_payment_date),
        toIsoDate(raw.closed_date),
        parseMoney(raw.monthly_payment),
        parseMoney(raw.balance),
        parseMoney(raw.credit_limit),
        parseMoney(raw.past_due_amount || raw.past_due),
        parseMoney(raw.high_balance),
        raw.terms || null,
        raw.remarks || null,
        Boolean(raw.is_disputed),
        JSON.stringify(raw || {}),
      ]
    );
    inserted += 1;
  }
  return inserted;
}

async function ingestCreditJson({ filePath, personKey, reportOverride = {} }) {
  const abs = path.resolve(filePath);
  const json = readJsonFile(abs);
  const sourceHash = fileSha256(abs);

  const person = await upsertPerson(personKey, json.person || {});
  const report = await insertReport(person.id, { ...(json.report || {}), ...reportOverride }, abs, sourceHash);
  await pg.query(`DELETE FROM credit_items WHERE report_id = $1`, [report.id]);
  const insertedItems = await insertItems(person.id, report.id, report.bureau, json.items || []);

  return {
    person_id: person.id,
    person_key: person.external_key,
    report_id: report.id,
    bureau: report.bureau,
    report_date: report.report_date,
    items_inserted: insertedItems,
    source_hash: sourceHash,
  };
}

module.exports = {
  upsertPerson,
  insertReport,
  insertItems,
  ingestCreditJson,
};
