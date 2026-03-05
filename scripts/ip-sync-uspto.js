#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const pg = require("../infra/postgres");
const { v4: uuidv4 } = require("uuid");

const args = process.argv.slice(2);
const getArg = (flag, fallback = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};

const LIMIT = Math.max(1, Number(getArg("--limit", "100")) || 100);
const SERIAL = getArg("--serial", null);
const OUT_ROOT = getArg("--out", path.join(process.cwd(), "vault", "uspto_pull", "tsdr"));
const URL_TEMPLATE = process.env.USPTO_TSDR_CASE_URL_TEMPLATE || "https://tsdrapi.uspto.gov/ts/cd/casestatus/sn{serial}/info.json";

function renderCaseUrl(serial) {
  return URL_TEMPLATE.replace("{serial}", encodeURIComponent(serial));
}

function safeDate(v) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

async function upsertCaseStatus(caseRow, payload) {
  const status = payload?.statusDesc || payload?.statusCode || payload?.status || null;
  const updatedAt = payload?.statusDate || payload?.lastUpdateDate || payload?.modifiedDate || null;

  await pg.query(
    `UPDATE ip_cases
     SET status = COALESCE($2, status),
         updated_at = COALESCE($3::timestamptz, updated_at)
     WHERE id = $1`,
    [caseRow.id, status ? String(status).toLowerCase() : null, updatedAt]
  );

  await pg.query(
    `INSERT INTO ip_events (case_id, event_type, event_date, summary, metadata_json)
     VALUES ($1, 'uspto_status_sync', $2, $3, $4::jsonb)`,
    [
      caseRow.id,
      safeDate(updatedAt),
      `USPTO status sync: ${status || "unknown"}`,
      JSON.stringify({ source: "TSDR", payload }),
    ]
  );
}

async function savePayloadDocument(caseRow, serial, payload) {
  const dir = path.join(OUT_ROOT, serial);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${Date.now()}-status.json`);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));

  const sha = require("crypto").createHash("sha256").update(JSON.stringify(payload)).digest("hex");

  await pg.query(
    `INSERT INTO ip_documents
      (case_id, source_type, source_machine, source_path, title, doc_type, doc_date, sha256, mime_type, file_path_original, file_path_normalized, extracted_text)
     VALUES ($1,'uspto_pull','sync',$2,$3,'uspto_case_status',$4,$5,'application/json',$2,$2,$6)
     ON CONFLICT (sha256) DO NOTHING`,
    [
      caseRow.id,
      filePath,
      `TSDR status ${serial}`,
      safeDate(payload?.statusDate || payload?.lastUpdateDate),
      sha,
      JSON.stringify(payload).slice(0, 250000),
    ]
  );
}

async function main() {
  const syncRunId = uuidv4();
  await pg.query(
    `INSERT INTO ip_sync_runs (id, sync_type, status, stats_json)
     VALUES ($1, 'uspto_tsdr', 'running', '{}'::jsonb)`,
    [syncRunId]
  ).catch(() => {});

  const params = [];
  let where = `serial_number IS NOT NULL`;
  if (SERIAL) {
    params.push(SERIAL);
    where += ` AND serial_number = $1`;
  }

  const q = `SELECT id, case_key, serial_number FROM ip_cases WHERE ${where} ORDER BY updated_at DESC LIMIT ${SERIAL ? "1" : "$1"}`;
  if (!SERIAL) params.push(LIMIT);
  const { rows } = await pg.query(q, params);

  const stats = { total: rows.length, ok: 0, failed: 0 };

  for (const c of rows) {
    try {
      const url = renderCaseUrl(c.serial_number);
      const res = await fetch(url, {
        headers: {
          ...(process.env.USPTO_API_KEY ? { "USPTO-API-KEY": process.env.USPTO_API_KEY } : {}),
          "Accept": "application/json",
        },
        signal: AbortSignal.timeout(30000),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      await savePayloadDocument(c, c.serial_number, data);
      await upsertCaseStatus(c, data);
      stats.ok += 1;
      console.log(`[ip-sync-uspto] synced ${c.serial_number}`);
    } catch (err) {
      stats.failed += 1;
      console.warn(`[ip-sync-uspto] failed ${c.serial_number}: ${err.message}`);
    }
  }

  await pg.query(
    `UPDATE ip_sync_runs
     SET status = $2,
         completed_at = NOW(),
         stats_json = $3::jsonb
     WHERE id = $1`,
    [syncRunId, stats.failed > 0 ? "failed" : "completed", JSON.stringify(stats)]
  ).catch(() => {});

  console.log(`\n[ip-sync-uspto] total=${stats.total} ok=${stats.ok} failed=${stats.failed}`);
}

main()
  .then(async () => { await pg.end(); })
  .catch(async (err) => {
    console.error("Fatal:", err.message);
    await pg.end();
    process.exit(1);
  });
