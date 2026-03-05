#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");
const pg = require("../infra/postgres");
const { upsertPerson, insertReport } = require("../control/credit/intake");
const { fileSha256 } = require("../control/credit/utils");

const args = process.argv.slice(2);
const getArg = (flag, fallback = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};

function detectBureau(filePath, explicit) {
  if (explicit) return String(explicit).toLowerCase();
  const f = path.basename(filePath).toLowerCase();
  if (f.includes("equifax") || f.includes("eqifax") || f.includes("eq")) return "equifax";
  if (f.includes("experian") || f.includes("ex")) return "experian";
  if (f.includes("transunion") || f.includes("trans")) return "transunion";
  return "other";
}

function detectPersonName(personKey, explicit) {
  if (explicit) return explicit;
  const key = String(personKey || "").trim();
  if (!key) return null;
  return key
    .split(/[_\-\s]+/g)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1).toLowerCase())
    .join(" ");
}

async function main() {
  const personKey = getArg("--person-key");
  const filePath = getArg("--file");
  const bureauArg = getArg("--bureau", null);
  const reportDate = getArg("--date", null);
  const fullName = getArg("--name", null);

  if (!personKey || !filePath) {
    throw new Error("Usage: node scripts/credit-intake-pdf.js --person-key <key> --file <pdf-path> [--bureau equifax] [--date YYYY-MM-DD] [--name 'Full Name']");
  }

  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    throw new Error(`File not found: ${abs}`);
  }

  const buffer = fs.readFileSync(abs);
  const parsed = await pdfParse(buffer);
  const rawText = String(parsed.text || "").trim();

  if (!rawText) {
    throw new Error(`PDF text extraction returned empty text: ${abs}`);
  }

  const sourceHash = fileSha256(abs);
  const bureau = detectBureau(abs, bureauArg);

  const person = await upsertPerson(personKey, {
    full_name: detectPersonName(personKey, fullName),
    metadata: {
      intake_type: "pdf",
    },
  });

  const report = await insertReport(
    person.id,
    {
      bureau,
      report_date: reportDate || new Date().toISOString().slice(0, 10),
      source_type: "upload",
      source_path: abs,
      raw_text: rawText,
      metadata: {
        extractor: "pdf-parse",
        pages: Number(parsed.numpages || 0),
        info: parsed.info || {},
        text_length: rawText.length,
      },
    },
    abs,
    sourceHash
  );

  // Replace synthetic ingestion items if any existed for this exact report.
  await pg.query(`DELETE FROM credit_items WHERE report_id = $1`, [report.id]);

  console.log("\n=== Credit PDF Intake ===\n");
  console.log(`person_key:     ${personKey}`);
  console.log(`person_id:      ${person.id}`);
  console.log(`report_id:      ${report.id}`);
  console.log(`bureau:         ${report.bureau}`);
  console.log(`report_date:    ${report.report_date}`);
  console.log(`pages:          ${Number(parsed.numpages || 0)}`);
  console.log(`text_length:    ${rawText.length}`);
  console.log(`source_path:    ${abs}`);
  console.log(`source_hash:    ${sourceHash}`);
}

main()
  .then(async () => { await pg.end(); })
  .catch(async (err) => {
    console.error("Fatal:", err.message);
    try { await pg.end(); } catch (_) {}
    process.exit(1);
  });
