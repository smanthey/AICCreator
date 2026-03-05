#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
function getArg(name, fallback = "") {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
}

const REPORTS_DIR = path.join(process.cwd(), "scripts", "reports");
const IN = getArg("--in", "");
const OUT_DIR = getArg("--out-dir", path.join(REPORTS_DIR, "remove-lists"));

function pickLatestDedupeCsv() {
  const files = fs
    .readdirSync(REPORTS_DIR)
    .filter((f) => f.endsWith("-dedupe-review.csv"))
    .sort();
  return files.length ? path.join(REPORTS_DIR, files[files.length - 1]) : null;
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === ",") {
      out.push(cur);
      cur = "";
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function csvEscape(v) {
  const s = String(v == null ? "" : v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, "\"\"")}"` : s;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function bytesToGb(bytes) {
  return Number(bytes || 0) / (1024 ** 3);
}

function run() {
  const inPath = IN || pickLatestDedupeCsv();
  if (!inPath || !fs.existsSync(inPath)) {
    throw new Error("No dedupe review CSV found. Run dedupe:review first or pass --in.");
  }
  ensureDir(OUT_DIR);

  const raw = fs.readFileSync(inPath, "utf8").split(/\r?\n/).filter(Boolean);
  if (raw.length < 2) throw new Error(`CSV has no data rows: ${inPath}`);

  const header = parseCsvLine(raw[0]);
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const byMachine = new Map();

  for (let i = 1; i < raw.length; i += 1) {
    const cols = parseCsvLine(raw[i]);
    const machine = cols[idx.source_machine] || "unknown";
    if (!byMachine.has(machine)) byMachine.set(machine, []);
    byMachine.get(machine).push(cols);
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outBase = path.join(OUT_DIR, ts);
  ensureDir(outBase);

  const summary = [];
  for (const [machine, rows] of [...byMachine.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const outCsv = path.join(outBase, `${machine}-remove-candidates.csv`);
    const totalBytes = rows.reduce((a, r) => a + Number(r[idx.size_bytes] || 0), 0);
    const outRows = [
      [
        "source_machine",
        "full_path",
        "size_bytes",
        "status",
        "brand",
        "category",
        "canonical_machine",
        "canonical_full_path",
        "sha256",
      ],
      ...rows.map((r) => [
        r[idx.source_machine],
        r[idx.full_path],
        r[idx.size_bytes],
        r[idx.status],
        r[idx.brand],
        r[idx.category],
        r[idx.canonical_machine],
        r[idx.canonical_full_path],
        r[idx.sha256],
      ]),
    ].map((r) => r.map(csvEscape).join(","));
    fs.writeFileSync(outCsv, outRows.join("\n") + "\n", "utf8");
    summary.push({
      machine,
      files: rows.length,
      bytes: totalBytes,
      gb: Number(bytesToGb(totalBytes).toFixed(2)),
      csv: outCsv,
    });
  }

  const summaryPath = path.join(outBase, "SUMMARY.json");
  fs.writeFileSync(summaryPath, JSON.stringify({ input_csv: inPath, generated_at: new Date().toISOString(), summary }, null, 2));

  console.log("\n=== Per-Machine Remove Lists ===");
  console.log(`input: ${inPath}`);
  console.log(`output_dir: ${outBase}`);
  for (const s of summary) {
    console.log(`- ${s.machine}: ${s.files} files (${s.gb} GB) -> ${s.csv}`);
  }
  console.log(`summary: ${summaryPath}`);
}

try {
  run();
} catch (e) {
  console.error("Fatal:", e.message);
  process.exit(1);
}
