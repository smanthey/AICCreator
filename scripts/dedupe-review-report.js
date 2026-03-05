#!/usr/bin/env node
"use strict";

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const args = process.argv.slice(2);
function getArg(name, fallback) {
  const i = args.indexOf(name);
  if (i === -1 || i + 1 >= args.length) return fallback;
  return args[i + 1];
}
const INCLUDE_PROBABLE = args.includes("--include-probable");
const LIMIT = Math.max(1, Number(getArg("--limit", "5000")) || 5000);
const MIN_MB = Math.max(1, Number(getArg("--min-size-mb", "20")) || 20);
const OUT = getArg("--out", "");

const db = new Pool({
  host: process.env.CLAW_DB_HOST || process.env.POSTGRES_HOST || "192.168.1.164",
  port: Number(process.env.CLAW_DB_PORT || process.env.POSTGRES_PORT || 15432),
  user: process.env.CLAW_DB_USER || process.env.POSTGRES_USER || "claw",
  password: process.env.CLAW_DB_PASSWORD || process.env.POSTGRES_PASSWORD,
  database: process.env.CLAW_DB_NAME || "claw",
  max: 2,
});

function csvEscape(v) {
  const s = String(v == null ? "" : v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, "\"\"")}"` : s;
}

function fmtBytes(n) {
  const x = Number(n || 0);
  if (x >= 1e9) return `${(x / 1e9).toFixed(2)} GB`;
  if (x >= 1e6) return `${(x / 1e6).toFixed(1)} MB`;
  if (x >= 1e3) return `${(x / 1e3).toFixed(1)} KB`;
  return `${x} B`;
}

async function main() {
  const preflight = await db.query(
    `SELECT to_regclass('public.files') AS files_tbl,
            to_regclass('public.duplicate_groups') AS groups_tbl,
            to_regclass('public.duplicate_group_members') AS members_tbl`
  );
  const pf = preflight.rows[0] || {};
  if (!pf.files_tbl || !pf.groups_tbl || !pf.members_tbl) {
    throw new Error(
      `dedupe tables not found in DB "${db.options.database}". ` +
      `Set CLAW_DB_NAME=claw (current=${db.options.database || "unknown"}).`
    );
  }

  const statuses = INCLUDE_PROBABLE ? ["confirmed", "probable"] : ["confirmed"];
  const minBytes = MIN_MB * 1024 * 1024;

  const { rows } = await db.query(
    `SELECT
       dg.status,
       dg.brand,
       dg.category,
       f.source_machine,
       f.path,
       f.filename,
       f.size_bytes,
       f.sha256,
       canon.source_machine AS canonical_machine,
       canon.path AS canonical_path,
       canon.filename AS canonical_filename
     FROM duplicate_group_members dgm
     JOIN duplicate_groups dg ON dg.id = dgm.group_id
     JOIN files f ON f.id = dgm.file_id
     JOIN files canon ON canon.id = dg.canonical_file_id
     WHERE dg.status = ANY($1::text[])
       AND f.id <> dg.canonical_file_id
       AND f.source_machine <> 'nas_primary'
       AND f.size_bytes >= $2
     ORDER BY f.size_bytes DESC
     LIMIT $3`,
    [statuses, minBytes, LIMIT]
  );

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = OUT || path.join(process.cwd(), "scripts", "reports", `${ts}-dedupe-review.csv`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const header = [
    "status",
    "brand",
    "category",
    "source_machine",
    "full_path",
    "size_bytes",
    "canonical_machine",
    "canonical_full_path",
    "sha256",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push([
      r.status,
      r.brand || "",
      r.category || "",
      r.source_machine || "",
      path.join(r.path || "", r.filename || ""),
      r.size_bytes || 0,
      r.canonical_machine || "",
      path.join(r.canonical_path || "", r.canonical_filename || ""),
      r.sha256 || "",
    ].map(csvEscape).join(","));
  }
  fs.writeFileSync(outPath, lines.join("\n") + "\n", "utf8");

  const total = rows.reduce((a, r) => a + Number(r.size_bytes || 0), 0);
  console.log("\n=== Dedupe Review Report ===");
  console.log(`db: ${db.options.database}`);
  console.log(`statuses: ${statuses.join(", ")}`);
  console.log(`rows: ${rows.length}`);
  console.log(`bytes: ${fmtBytes(total)}`);
  console.log(`csv: ${outPath}`);
}

main()
  .then(async () => { await db.end(); })
  .catch(async (err) => {
    console.error("Fatal:", err.message);
    try { await db.end(); } catch (_) {}
    process.exit(1);
  });

