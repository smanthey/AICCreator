#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { chromium } = require("playwright");

const BASE = "https://idm-tmng.uspto.gov/id-master-list-public.html";

function arg(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  if (idx < 0) return fallback;
  return process.argv[idx + 1] || fallback;
}

function numArg(name, fallback) {
  const v = parseInt(arg(name, String(fallback)), 10);
  return Number.isFinite(v) ? v : fallback;
}

async function extractRows(page) {
  return page.evaluate(() => {
    const table = document.querySelector("table");
    if (!table) return [];
    const headers = Array.from(table.querySelectorAll("thead th, tr th")).map((th) =>
      (th.textContent || "").trim()
    );
    const rows = [];
    const bodyRows = table.querySelectorAll("tbody tr, tr");
    for (const tr of bodyRows) {
      const tds = tr.querySelectorAll("td");
      if (!tds.length) continue;
      const cells = Array.from(tds).map((td) => (td.textContent || "").replace(/\s+/g, " ").trim());
      const row = {};
      for (let i = 0; i < cells.length; i += 1) {
        row[headers[i] || `col_${i + 1}`] = cells[i];
      }
      rows.push(row);
    }
    return rows;
  });
}

async function clickNext(page) {
  const candidates = [
    'button[aria-label="Next"]',
    'a[aria-label="Next"]',
    "button.next",
    "a.next",
    "button[title='Next']",
    "a[title='Next']",
  ];

  for (const selector of candidates) {
    const handle = await page.$(selector);
    if (!handle) continue;
    const disabled = await handle.evaluate((el) => el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true");
    if (disabled) return false;
    await Promise.allSettled([
      page.waitForLoadState("networkidle", { timeout: 10000 }),
      handle.click({ timeout: 10000 }),
    ]);
    return true;
  }

  return false;
}

async function scrapeClass(page, classNum, maxPages, rowsPerPage) {
  const params = new URLSearchParams([
    ["class-num", classNum],
    ["class-valid", "true"],
    ["pageNum", "1"],
    ["rows", String(rowsPerPage)],
    ["search-by", "all"],
    ["status", "A"],
    ["status", "D"],
    ["status", "M"],
    ["status", "X"],
    ["status-all", "All"],
  ]);
  const url = `${BASE}?${params.toString()}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

  const seen = new Set();
  const out = [];
  for (let pageNo = 1; pageNo <= maxPages; pageNo += 1) {
    const rows = await extractRows(page);
    if (!rows.length) break;

    let added = 0;
    for (const row of rows) {
      const key = JSON.stringify(row);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ class_num: classNum, row });
      added += 1;
    }
    if (added === 0) break;

    const moved = await clickNext(page);
    if (!moved) break;
  }

  return out;
}

async function main() {
  const classStart = numArg("--class-start", 1);
  const classEnd = numArg("--class-end", 45);
  const maxPages = numArg("--max-pages", 25);
  const rowsPerPage = numArg("--rows", 200);
  const outPath = path.resolve(arg("--out", path.join("scripts", "idm-playwright-rows.json")));
  const dbPath = arg("--db", null);
  const tier = arg("--tier", "authoritative");

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const allRows = [];

  try {
    for (let cls = classStart; cls <= classEnd; cls += 1) {
      const classNum = String(cls).padStart(3, "0");
      const rows = await scrapeClass(page, classNum, maxPages, rowsPerPage);
      allRows.push(...rows);
      console.log(`[ip-kb-ingest-idm:pw] class=${classNum} rows=${rows.length}`);
    }
  } finally {
    await browser.close();
  }

  fs.writeFileSync(outPath, JSON.stringify(allRows, null, 2), "utf8");
  console.log(`[ip-kb-ingest-idm:pw] wrote ${allRows.length} rows -> ${outPath}`);

  if (allRows.length === 0) {
    console.log("[ip-kb-ingest-idm:pw] zero rows discovered; nothing imported");
    return;
  }

  const args = ["./scripts/ip-kb-ingest-idm.py", "--from-json", outPath, "--tier", tier];
  if (dbPath) {
    args.push("--db", dbPath);
  }

  const venvPython = path.join(process.cwd(), ".venv", "bin", "python");
  const pythonBin = fs.existsSync(venvPython) ? venvPython : "python3";
  const py = spawnSync(pythonBin, args, { stdio: "inherit" });
  if (py.status !== 0) {
    process.exit(py.status || 1);
  }
}

main().catch((err) => {
  console.error("[ip-kb-ingest-idm:pw] fatal:", err.message);
  process.exit(1);
});
