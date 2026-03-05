#!/usr/bin/env node
"use strict";

require("dotenv").config();

const pg = require("../infra/postgres");
const { insertItems } = require("../control/credit/intake");
const { parseCreditReportText } = require("../control/credit/pdf-parser");

const args = process.argv.slice(2);
const getArg = (flag, fallback = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};

const reportId = getArg("--report-id", null);
const personKey = getArg("--person-key", null);
const limit = Math.max(1, Number(getArg("--limit", "50")) || 50);
const force = args.includes("--force");

async function resolveReports() {
  if (reportId) {
    const { rows } = await pg.query(
      `SELECT r.id, r.person_id, r.bureau, r.raw_text, p.external_key
         FROM credit_reports r
         JOIN credit_person_profiles p ON p.id = r.person_id
        WHERE r.id = $1`,
      [reportId]
    );
    return rows;
  }

  if (personKey) {
    const { rows } = await pg.query(
      `SELECT r.id, r.person_id, r.bureau, r.raw_text, p.external_key
         FROM credit_reports r
         JOIN credit_person_profiles p ON p.id = r.person_id
        WHERE p.external_key = $1
        ORDER BY r.report_date DESC, r.created_at DESC`,
      [personKey]
    );
    return rows;
  }

  const { rows } = await pg.query(
    `SELECT r.id, r.person_id, r.bureau, r.raw_text, p.external_key
       FROM credit_reports r
       JOIN credit_person_profiles p ON p.id = r.person_id
      WHERE r.raw_text IS NOT NULL
      ORDER BY r.created_at DESC
      LIMIT $1`,
    [limit]
  );
  return rows;
}

async function existingItemCount(reportIdValue) {
  const { rows } = await pg.query(
    `SELECT COUNT(*)::int AS n FROM credit_items WHERE report_id = $1`,
    [reportIdValue]
  );
  return Number(rows[0]?.n || 0);
}

async function processReport(report) {
  const has = await existingItemCount(report.id);
  if (has > 0 && !force) {
    return { report_id: report.id, external_key: report.external_key, bureau: report.bureau, skipped: true, inserted: 0, parsed: 0 };
  }

  const parsed = parseCreditReportText(report.raw_text || "", report.bureau);
  await pg.query(`DELETE FROM credit_items WHERE report_id = $1`, [report.id]);
  const inserted = await insertItems(report.person_id, report.id, report.bureau, parsed.items || []);

  return {
    report_id: report.id,
    external_key: report.external_key,
    bureau: report.bureau,
    skipped: false,
    inserted,
    parsed: parsed.stats?.total || 0,
    stats: parsed.stats,
  };
}

async function main() {
  const reports = await resolveReports();
  if (!reports.length) {
    console.log("No matching credit reports found.");
    return;
  }

  console.log("\n=== Credit PDF Parse ===\n");
  let insertedTotal = 0;
  let parsedTotal = 0;
  let skipped = 0;

  for (const r of reports) {
    const res = await processReport(r);
    if (res.skipped) {
      skipped += 1;
      console.log(`- ${res.external_key} ${res.bureau} ${res.report_id} | skipped (items already exist)`);
      continue;
    }

    insertedTotal += res.inserted;
    parsedTotal += res.parsed;
    console.log(
      `- ${res.external_key} ${res.bureau} ${res.report_id} | parsed=${res.parsed} inserted=${res.inserted} ` +
      `(trade_lines=${res.stats.trade_lines}, inquiries=${res.stats.inquiries}, personal=${res.stats.personal_info})`
    );
  }

  console.log("");
  console.log(`reports: ${reports.length}`);
  console.log(`skipped: ${skipped}`);
  console.log(`parsed_items_total: ${parsedTotal}`);
  console.log(`inserted_items_total: ${insertedTotal}`);
}

main()
  .then(async () => { await pg.end(); })
  .catch(async (err) => {
    console.error("Fatal:", err.message);
    try { await pg.end(); } catch (_) {}
    process.exit(1);
  });
