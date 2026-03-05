#!/usr/bin/env node
/**
 * audit-missing-brands.js
 * Run from Mac terminal: node scripts/audit-missing-brands.js
 * Finds undetected brands in claw.files, focusing on scottmanthey repos,
 * aloc, cookies, and any other uncategorized path clusters.
 */
"use strict";

const path = require("path");
const { Pool } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const pool = new Pool({
  host:     process.env.CLAW_DB_HOST      || "192.168.1.164",
  port:     parseInt(process.env.CLAW_DB_PORT || "15432"),
  user:     process.env.POSTGRES_USER     || "claw",
  password: process.env.POSTGRES_PASSWORD || process.env.CLAW_DB_PASSWORD,
  database: process.env.CLAW_DB_NAME || "claw_architect",
});

async function main() {
  console.log("\n══════════════════════════════════════════════════════");
  console.log(" Brand / Project Path Audit");
  console.log("══════════════════════════════════════════════════════\n");

  // ── 1. Current brand coverage ────────────────────────────────────────────
  const { rows: [cov] } = await pool.query(`
    SELECT COUNT(*) total, COUNT(brand) branded,
           COUNT(*)-COUNT(brand) unbranded,
           ROUND(COUNT(brand)::numeric/COUNT(*)*100,1) pct
    FROM files
  `);
  console.log(`📊 Coverage: ${cov.branded}/${cov.total} branded (${cov.pct}%) | ${cov.unbranded} unbranded\n`);

  // ── 2. Search for known-missing brands ──────────────────────────────────
  const targets = [
    { name: "aloc",          pattern: "aloc"              },
    { name: "cookies",       pattern: "cookie"            },
    { name: "scottmanthey",  pattern: "scottmanthey"      },
    { name: "smat (git)",    pattern: "smat"              },
  ];

  console.log("🎯 Checking for known-missing brands:");
  for (const t of targets) {
    const { rows: [r] } = await pool.query(
      `SELECT COUNT(*) cnt, COUNT(brand) branded FROM files WHERE path ILIKE $1`,
      [`%${t.pattern}%`]
    );
    console.log(`   ${t.name.padEnd(18)} ${r.cnt.toString().padStart(7)} files | ${r.branded} already branded`);
  }

  // ── 3. Deep path audit — unbranded folder clusters ───────────────────────
  console.log("\n🔍 Top unbranded folder clusters (depth 4-6):");
  const { rows: deep } = await pool.query(`
    WITH splits AS (
      SELECT
        path,
        split_part(path,'/',4) AS d4,
        split_part(path,'/',5) AS d5,
        split_part(path,'/',6) AS d6
      FROM files WHERE brand IS NULL
    )
    SELECT d4, d5, COUNT(*) cnt
    FROM splits
    WHERE d4 != '' AND d5 != ''
    GROUP BY d4, d5
    ORDER BY cnt DESC
    LIMIT 40
  `);
  deep.forEach(r =>
    console.log(`   /${r.d4}/${r.d5}`.padEnd(50) + `  ${r.cnt.toString().padStart(7)} files`)
  );

  // ── 4. scottmanthey folder tree ──────────────────────────────────────────
  console.log("\n📁 scottmanthey path breakdown:");
  const { rows: smPaths } = await pool.query(`
    SELECT
      split_part(path,'/',5) AS folder,
      COUNT(*) cnt,
      COUNT(DISTINCT ext) exts,
      SUM(size_bytes) bytes
    FROM files
    WHERE path ILIKE '%scottmanthey%'
    GROUP BY folder ORDER BY cnt DESC LIMIT 30
  `);
  if (smPaths.length === 0) {
    console.log("   (none found — may be under a different path segment)");
    // fallback: check machine-level
    const { rows: smAny } = await pool.query(`
      SELECT source_machine, COUNT(*) cnt FROM files
      WHERE path ILIKE '%scottmanthey%' OR path ILIKE '%scott_man%'
      GROUP BY source_machine ORDER BY cnt DESC
    `);
    smAny.forEach(r => console.log(`   machine=${r.source_machine}  ${r.cnt} files`));
  } else {
    smPaths.forEach(r =>
      console.log(`   /${r.folder || '(root)'}`
        .padEnd(40) + `  ${r.cnt.toString().padStart(7)} files | ${r.exts} ext types | ${(r.bytes/1e6).toFixed(1)} MB`)
    );
  }

  // ── 5. Repos/sites discovered in git folders ─────────────────────────────
  console.log("\n🔗 Git repo paths (package.json or index.html hits):");
  const { rows: repos } = await pool.query(`
    SELECT
      split_part(path,'/',4) AS root,
      split_part(path,'/',5) AS project,
      COUNT(*) cnt
    FROM files
    WHERE (filename = 'package.json' OR filename = 'index.html')
      AND brand IS NULL
    GROUP BY root, project
    ORDER BY cnt DESC
    LIMIT 30
  `);
  repos.forEach(r =>
    console.log(`   /${r.root}/${r.project}`.padEnd(50) + `  ${r.cnt.toString().padStart(5)} hits`)
  );

  // ── 6. Web-file clusters (html/css/js) without brands ────────────────────
  console.log("\n🌐 Largest unbranded web code clusters:");
  const { rows: web } = await pool.query(`
    SELECT
      split_part(path,'/',4) AS d4,
      split_part(path,'/',5) AS d5,
      COUNT(*) FILTER (WHERE ext IN ('html','htm')) html,
      COUNT(*) FILTER (WHERE ext IN ('css','scss','sass','less')) css,
      COUNT(*) FILTER (WHERE ext IN ('js','ts','jsx','tsx')) js,
      COUNT(*) total
    FROM files
    WHERE brand IS NULL
      AND ext IN ('html','htm','css','scss','sass','less','js','ts','jsx','tsx')
    GROUP BY d4, d5
    HAVING COUNT(*) > 20
    ORDER BY total DESC
    LIMIT 25
  `);
  web.forEach(r =>
    console.log(`   /${r.d4}/${r.d5}`.padEnd(48)
      + `  html:${r.html.toString().padStart(4)} css:${r.css.toString().padStart(4)} js:${r.js.toString().padStart(5)} | total:${r.total}`)
  );

  await pool.end();
  console.log("\n══════════════════════════════════════════════════════\n");
}

main().catch(e => { console.error(e); process.exit(1); });
