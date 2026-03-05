#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const INDEX_DIR = path.join(process.env.HOME || os.homedir(), ".code-index");
const REPORT_DIR = path.join(ROOT, "reports");

function arg(flag, fallback = null) {
  const args = process.argv.slice(2);
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
}

function normalizeRepoKey(name) {
  const raw = String(name || "").trim();
  if (!raw) return "";
  const clean = raw.replace(/^local\//i, "");
  return `local-${clean}`.toLowerCase();
}

function resolveIndexFile(repo) {
  const want = normalizeRepoKey(repo);
  if (!fs.existsSync(INDEX_DIR)) return null;
  const files = fs.readdirSync(INDEX_DIR).filter((f) => f.endsWith(".json") && !f.startsWith("_"));
  for (const file of files) {
    if (file.toLowerCase() === `${want}.json`) {
      return path.join(INDEX_DIR, file);
    }
  }
  return null;
}

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function repomapPath(repo) {
  const slug = String(repo || "").replace(/^local\//i, "").toLowerCase();
  return path.join(ROOT, "scripts", "reports", "repomaps", `${slug}-repomap.md`);
}

async function main() {
  const repos = String(arg("--repos", "cookiespass,payclaw,gocrawdaddy"))
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const maxAgeHours = Math.max(1, Number(arg("--max-age-hours", "24")) || 24);

  const perRepo = [];
  for (const repo of repos) {
    const indexFile = resolveIndexFile(repo);
    if (!indexFile) {
      perRepo.push({ repo, ok: false, reason: "index_missing" });
      continue;
    }
    const stat = fs.statSync(indexFile);
    const ageHours = (Date.now() - Number(stat.mtimeMs || 0)) / 3600000;
    const index = readJsonSafe(indexFile);
    const symbols = Array.isArray(index?.symbols) ? index.symbols : [];
    const first = symbols.find((s) => s && s.id);

    const mapPath = repomapPath(repo);
    const mapExists = fs.existsSync(mapPath);
    const mapAgeHours = mapExists ? (Date.now() - fs.statSync(mapPath).mtimeMs) / 3600000 : null;

    perRepo.push({
      repo,
      index_file: indexFile,
      index_age_hours: Number(ageHours.toFixed(2)),
      index_fresh: ageHours <= maxAgeHours,
      symbols_total: symbols.length,
      sample_symbol_id: first?.id || null,
      repomap_path: mapPath,
      repomap_exists: mapExists,
      repomap_age_hours: mapAgeHours == null ? null : Number(mapAgeHours.toFixed(2)),
      repomap_fresh: mapExists ? mapAgeHours <= maxAgeHours : false,
      symbol_probe: {
        ok: Boolean(first?.id),
        symbol_id: first?.id || null,
        file: first?.file || null,
      },
    });
  }

  const ok = perRepo.every(
    (r) =>
      r.index_fresh &&
      r.symbols_total > 0 &&
      r.repomap_exists &&
      r.repomap_fresh &&
      r.symbol_probe?.ok
  );

  const report = {
    ok,
    generated_at: new Date().toISOString(),
    max_age_hours: maxAgeHours,
    repos: perRepo,
  };

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[.:]/g, "-");
  const jsonPath = path.join(REPORT_DIR, `${stamp}-symbol-index-preflight.json`);
  const latestPath = path.join(REPORT_DIR, "symbol-index-preflight-latest.json");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(latestPath, JSON.stringify(report, null, 2));

  console.log(JSON.stringify({ ...report, report: { jsonPath, latestPath } }, null, 2));
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error("symbol-index-preflight failed:", err.message);
  process.exit(1);
});
