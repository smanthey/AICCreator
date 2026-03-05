#!/usr/bin/env node
/**
 * deep-categorizer.js
 * ──────────────────────────────────────────────────────────────────────────
 * Second-pass categorizer. Goes beyond file extension to determine:
 *   - sub_category (what kind of video/photo/document/code/etc.)
 *   - work_needed flags (what still requires attention)
 *   - review_status
 *
 * Uses 4 signals in order (no Ollama until signal 4):
 *   1. Path patterns  — folder names almost always tell you the context
 *   2. Filename patterns — dates, keywords, prefixes reveal intent
 *   3. Size heuristics  — raw footage is huge; thumbnails are tiny
 *   4. Ollama fallback  — only for genuinely ambiguous files
 *
 * Usage:
 *   node scripts/deep-categorizer.js                  # run all passes
 *   node scripts/deep-categorizer.js --dry-run        # report without writing
 *   node scripts/deep-categorizer.js --category video # one category only
 *   node scripts/deep-categorizer.js --ollama         # enable Ollama fallback
 *   node scripts/deep-categorizer.js --flags-only     # just set work_needed flags, skip sub_category
 *   node scripts/deep-categorizer.js --report         # print needs-work summary
 */

"use strict";

const path   = require("path");
const http   = require("http");
const { Pool } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const DRY_RUN     = process.argv.includes("--dry-run");
const USE_OLLAMA  = process.argv.includes("--ollama");
const FLAGS_ONLY  = process.argv.includes("--flags-only");
const REPORT_ONLY = process.argv.includes("--report");
const CATEGORY    = (() => { const i = process.argv.indexOf("--category"); return i >= 0 ? process.argv[i+1] : null; })();

const OLLAMA_HOST  = process.env.OLLAMA_HOST  || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_CLASSIFY_MODEL || "llama3";

const dbHost = process.env.CLAW_DB_HOST || process.env.POSTGRES_HOST;
const dbPort = parseInt(process.env.CLAW_DB_PORT || process.env.POSTGRES_PORT || "15432", 10);
const dbUser = process.env.CLAW_DB_USER || process.env.POSTGRES_USER || "claw";
const dbPass = process.env.CLAW_DB_PASSWORD || process.env.POSTGRES_PASSWORD;
const dbName = process.env.CLAW_DB_NAME || process.env.POSTGRES_DB || "claw_architect";

if (!dbHost || !dbPass) {
  throw new Error("Missing DB env vars. Set CLAW_DB_* or POSTGRES_* including password.");
}

const pool = new Pool({
  host: dbHost,
  port: dbPort,
  user: dbUser,
  password: dbPass,
  database: dbName,
});

const TABLE_NAME = "file_index";

// ── SUB-CATEGORY RULES ────────────────────────────────────────────────────
// Each rule set is checked in order. First match wins.
// Signals: path (full path), filename, ext, size_bytes, brand, source_machine

const SUB_CATEGORY_RULES = {

  video: [
    // Screen recordings — usually small, come from specific apps
    { test: f => /screen.?record|quicktime|obs|loom|screenflow|screencast/i.test(f.path) || (f.size_bytes < 50e6 && /screen/i.test(f.filename)), sub: "screen_recording" },
    // Tutorials / courses — usually in named course folders
    { test: f => /tutorial|course|lesson|chapter|module|academy|udemy|linkedin|skillshare|masterclass/i.test(f.path), sub: "tutorial" },
    // Raw footage — very large files, often in numbered sequences or from cameras
    { test: f => f.size_bytes > 500e6 || /\b(A|B|C)\d{3}|MVI_|MOV_|GOPR|GX\d{6}|R\d{3}[A-Z]\d{4}/i.test(f.filename), sub: "raw_footage" },
    // Social clips — small, square aspect ratio filenames, "reel", "story", "tiktok"
    { test: f => /reel|story|tiktok|instagram|ig_|_ig|short|vertical|9x16|1080x1920/i.test(f.path + f.filename), sub: "social_clip" },
    // Client deliverables — in brand folder, has "final", "export", "deliver", "approved"
    { test: f => f.brand && /final|export|deliver|approved|master|output|render/i.test(f.filename), sub: "edited_deliverable" },
    // Personal — in personal/home folders with no brand
    { test: f => !f.brand && /personal|family|vacation|holiday|trip|home|birthday|wedding/i.test(f.path), sub: "personal" },
    { test: () => true, sub: "video_unreviewed" },
  ],

  photo: [
    // Screenshots — common names, small files, from desktop
    { test: f => /screenshot|screen shot|capture|snagit|screen grab/i.test(f.filename) || (/Desktop|Pictures\/Screenshots/i.test(f.path) && f.size_bytes < 2e6), sub: "screenshot" },
    // Raw photos — camera raw formats, large files
    { test: f => /cr2|cr3|nef|arw|orf|sr2|dng|rw2|pef|raf|raw/i.test(f.ext), sub: "raw_photo" },
    // Product shots — in brand folder, often has product keywords
    { test: f => f.brand && /product|item|sku|listing|catalog|packshot|pack.?shot/i.test(f.path + f.filename), sub: "product_shot" },
    // Social posts — sized for social, in content/social folders
    { test: f => /social|instagram|ig_|tiktok|facebook|twitter|post|feed|story/i.test(f.path + f.filename), sub: "social_post" },
    // Event photos — shoots, events, dates in path
    { test: f => /\d{4}[-_]\d{2}[-_]\d{2}|shoot|event|session|portrait|headshot/i.test(f.path + f.filename), sub: "event_photo" },
    // Edited — in export/edit folders or has editing app artifacts
    { test: f => /edited|export|lightroom|adobe|processed|retouched|final/i.test(f.path), sub: "edited_photo" },
    // HEIC = iPhone photos usually personal
    { test: f => f.ext === "heic" && !f.brand, sub: "personal_photo" },
    { test: () => true, sub: "photo_unreviewed" },
  ],

  design: [
    { test: f => /logo|icon|mark|brandmark|wordmark/i.test(f.filename), sub: "brand_asset" },
    { test: f => /mockup|mock.up|preview|presentation|comp/i.test(f.filename), sub: "mockup" },
    { test: f => /template|boilerplate|starter/i.test(f.filename), sub: "template" },
    { test: f => /print|cmyk|bleed|dieline|press.?ready|prepress/i.test(f.filename + f.path), sub: "print_ready" },
    { test: f => /icon|favicon|app.?icon|launcher/i.test(f.filename), sub: "icon" },
    { test: f => /social|post|feed|story|banner|ad|advertisement/i.test(f.path + f.filename), sub: "social_asset" },
    { test: f => /illustration|illus|artwork|art/i.test(f.filename), sub: "illustration" },
    { test: () => true, sub: "design_unreviewed" },
  ],

  "3d_asset": [
    { test: f => /blenderkit|asset.?lib|library/i.test(f.path), sub: "asset_library" },
    { test: f => /course|lesson|tutorial|academy|chapter/i.test(f.path), sub: "course_asset" },
    { test: f => /character|char|rig|rigged|avatar|humanoid/i.test(f.filename + f.path), sub: "character" },
    { test: f => /texture|tex_|_tex|material|mat_|normal|diffuse|roughness|metallic|albedo/i.test(f.filename), sub: "texture" },
    { test: f => /environment|scene|level|world|terrain|hdri|sky/i.test(f.filename + f.path), sub: "environment" },
    { test: f => /render|output|final|composite/i.test(f.path), sub: "render" },
    { test: f => /prop|asset|object|furniture|vehicle|weapon/i.test(f.filename + f.path), sub: "prop" },
    { test: () => true, sub: "3d_unreviewed" },
  ],

  document: [
    { test: f => /invoice|inv_|_inv\b|receipt|payment|billing/i.test(f.filename), sub: "invoice" },
    { test: f => /contract|agreement|nda|terms|tos|sign/i.test(f.filename + f.path), sub: "contract" },
    { test: f => /brief|scope|proposal|sow|statement.?of.?work|quote|estimate/i.test(f.filename), sub: "brief_proposal" },
    { test: f => /manual|guide|documentation|readme|spec|specification/i.test(f.filename), sub: "manual" },
    { test: f => /notes|meeting|minutes|agenda|todo|plan/i.test(f.filename), sub: "notes" },
    { test: f => /resume|cv\b|curriculum/i.test(f.filename), sub: "resume" },
    { test: () => true, sub: "document_unreviewed" },
  ],

  code: [
    { test: f => /migration|migrate|\d{3}_.+\.sql/i.test(f.filename), sub: "migration" },
    { test: f => /test|spec|__tests__|\.test\.|\.spec\./i.test(f.filename + f.path), sub: "test" },
    { test: f => /config|\.env|\.ini|\.cfg|settings|constants/i.test(f.filename), sub: "config" },
    { test: f => /scratch|draft|experiment|playground|sandbox|temp/i.test(f.path + f.filename), sub: "scratch" },
    { test: f => /prototype|poc|proof.?of.?concept/i.test(f.path + f.filename), sub: "prototype" },
    { test: () => true, sub: "production_code" },
  ],

  ios_app: [
    { test: f => f.ext === "ipa", sub: "app_binary" },
    { test: f => /xcodeproj|xcworkspace/i.test(f.ext + f.filename), sub: "xcode_project" },
    { test: f => /storyboard|\.xib/i.test(f.ext + f.filename), sub: "ui_layout" },
    { test: f => /\.swift$/i.test(f.filename), sub: "swift_source" },
    { test: f => /\.m$|\.h$/i.test(f.filename), sub: "objc_source" },
    { test: f => /info\.plist|entitlements/i.test(f.filename), sub: "app_config" },
    { test: () => true, sub: "ios_asset" },
  ],

  audio: [
    { test: f => /voiceover|vo_|narration|voice/i.test(f.filename + f.path), sub: "voiceover" },
    { test: f => /sfx|sound.?effect|fx_/i.test(f.filename + f.path), sub: "sfx" },
    { test: f => /podcast|episode|ep\d+/i.test(f.filename + f.path), sub: "podcast" },
    { test: f => /beat|instrumental|track|prod.?by/i.test(f.filename), sub: "music_production" },
    { test: f => /music|Music/i.test(f.path) && !f.brand, sub: "personal_music" },
    { test: () => true, sub: "audio_unreviewed" },
  ],

  archive: [
    { test: f => /backup|bak_|_bak\b/i.test(f.filename + f.path), sub: "project_backup" },
    { test: f => /deliver|export|final|output|client/i.test(f.filename) && f.brand, sub: "client_delivery" },
    { test: f => /Downloads/i.test(f.path) && !f.brand, sub: "download" },
    { test: () => true, sub: "archive_unreviewed" },
  ],
};

// Legacy category alias: many indexed assets are labeled as "image".
SUB_CATEGORY_RULES.image = SUB_CATEGORY_RULES.photo;

// ── WORK NEEDED FLAGS ─────────────────────────────────────────────────────
function computeWorkNeeded(file, isDupe) {
  const flags = [];
  if (!file.brand && file.category !== "cache")      flags.push("needs_brand");
  if (!file.sub_category)                            flags.push("needs_sub_category");
  if ((file.category_confidence || 0) < 0.7)        flags.push("low_confidence");
  if (!file.category || file.category === "unknown") flags.push("needs_review");
  if (isDupe)                                        flags.push("likely_duplicate");
  if (file.size_bytes > 500e6 && file.category === "unknown") flags.push("large_unreviewed");
  if (file.category === "ios_app")                  flags.push("ios_needs_update");
  if (file.brand === "ariel" || file.category === "3d_asset") flags.push("ariel_needs_org");
  return flags.length > 0 ? flags.join(",") : null;
}

function shouldAutoApprove(workNeeded) {
  if (!workNeeded) return true;
  const hardBlockers = new Set([
    "needs_sub_category",
    "needs_review",
    "likely_duplicate",
    "large_unreviewed",
  ]);
  return !String(workNeeded)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .some((flag) => hardBlockers.has(flag));
}

// ── Ollama fallback ───────────────────────────────────────────────────────
function ollamaClassify(filename, ext, folderContext, category, timeoutMs = 30_000) {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: OLLAMA_MODEL, stream: false,
      messages: [{
        role: "system",
        content: "You classify files into sub-categories. Reply with ONLY the sub-category label, nothing else. Be concise."
      }, {
        role: "user",
        content: `File: ${filename}\nExtension: .${ext}\nFolder context: ${folderContext}\nMain category: ${category}\n\nWhat is the most specific sub-category for this file? Choose the single best label.`
      }]
    });
    const url = new URL(`${OLLAMA_HOST}/api/chat`);
    const req = http.request({
      hostname: url.hostname, port: url.port || 11434,
      path: url.pathname, method: "POST",
      headers: { "Content-Type": "application/json" }
    }, (res) => {
      let data = "";
      res.on("data", d => data += d);
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          const sub = (parsed.message?.content || "").trim().slice(0, 50).replace(/[^a-z0-9_]/gi, "_").toLowerCase();
          resolve(sub || "ollama_unknown");
        } catch { resolve("ollama_error"); }
      });
    });
    req.on("error", () => resolve("ollama_error"));
    setTimeout(() => { req.destroy(); resolve("ollama_timeout"); }, timeoutMs);
    req.write(body);
    req.end();
  });
}

// ── Sub-categorize one file ───────────────────────────────────────────────
async function getSubCategory(file) {
  const rules = SUB_CATEGORY_RULES[file.category];
  if (!rules) return null;
  for (const rule of rules) {
    if (rule.test(file)) return rule.sub;
  }
  // Ollama fallback for unknown/low-confidence
  if (USE_OLLAMA && (!file.category || file.category === "unknown")) {
    const folderCtx = file.path.split("/").slice(-3, -1).join("/");
    return await ollamaClassify(file.filename, file.ext || "", folderCtx, file.category, 30_000);
  }
  return null;
}

// ── Process a batch ───────────────────────────────────────────────────────
async function processBatch(files, dupeSet) {
  if (DRY_RUN || files.length === 0) return;
  const updates = [];
  for (const f of files) {
    const sub     = FLAGS_ONLY ? f.sub_category : await getSubCategory(f);
    const isDupe  = dupeSet.has(f.id);
    const flags   = computeWorkNeeded({ ...f, sub_category: sub }, isDupe);
    const approve = shouldAutoApprove(flags);
    updates.push({ id: f.id, sub, flags, approve });
  }
  // Bulk update
  for (const u of updates) {
    await pool.query(
      `UPDATE ${TABLE_NAME} SET
        sub_category  = COALESCE($2, sub_category),
        work_needed   = $3,
        review_status = CASE
          WHEN $4::boolean THEN 'approved'
          WHEN review_status IS NULL THEN 'pending'
          ELSE review_status
        END
       WHERE id = $1`,
      [u.id, u.sub, u.flags, u.approve]
    );
  }
}

// ── Print report ──────────────────────────────────────────────────────────
async function printReport() {
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log(" NEEDS-WORK REPORT");
  console.log("══════════════════════════════════════════════════════════════\n");

  // Overall
  const { rows: [ov] } = await pool.query(`
    SELECT
      COUNT(*) total,
      COUNT(*) FILTER (WHERE work_needed IS NOT NULL) needs_work,
      COUNT(*) FILTER (WHERE work_needed IS NULL OR review_status='approved') clean
    FROM ${TABLE_NAME} WHERE COALESCE(review_status, 'pending') != 'ignored'
  `);
  console.log(`  Total (non-ignored): ${Number(ov.total).toLocaleString()}`);
  console.log(`  Needs work         : ${Number(ov.needs_work).toLocaleString()}`);
  console.log(`  Clean              : ${Number(ov.clean).toLocaleString()}\n`);

  // Flag breakdown
  const { rows: flags } = await pool.query(`
    SELECT
      flag,
      COUNT(*) cnt,
      array_agg(DISTINCT brand ORDER BY brand NULLS LAST) FILTER (WHERE brand IS NOT NULL) brands
    FROM (
      SELECT id, brand, unnest(string_to_array(work_needed, ',')) AS flag
      FROM ${TABLE_NAME} WHERE work_needed IS NOT NULL
    ) x
    GROUP BY flag ORDER BY cnt DESC
  `);
  console.log("  Work flags:");
  flags.forEach(r => {
    const brandSample = r.brands ? r.brands.slice(0,5).join(", ") : "";
    console.log(`    ${r.flag.padEnd(25)} ${r.cnt.toString().padStart(8)} files  ${brandSample ? `[${brandSample}]` : ""}`);
  });

  // Category breakdown of work needed
  const { rows: cats } = await pool.query(`
    SELECT
      COALESCE(category,'uncategorized') cat,
      COUNT(*) FILTER (WHERE work_needed IS NOT NULL) needs_work,
      COUNT(*) total,
      COUNT(DISTINCT sub_category) subs
    FROM ${TABLE_NAME} WHERE COALESCE(review_status, 'pending') != 'ignored'
    GROUP BY category ORDER BY needs_work DESC LIMIT 20
  `);
  console.log("\n  By category:");
  cats.forEach(r =>
    console.log(`    ${r.cat.padEnd(20)} ${r.needs_work.toString().padStart(8)} need work / ${r.total.toString().padStart(9)} total | ${r.subs} sub-cats`)
  );

  // iOS apps specifically
  const { rows: ios } = await pool.query(`
    SELECT source_machine, COUNT(*) cnt, COUNT(DISTINCT brand) brands
    FROM ${TABLE_NAME} WHERE category = 'ios_app'
    GROUP BY source_machine ORDER BY cnt DESC
  `);
  if (ios.length > 0) {
    console.log("\n  iOS apps by machine:");
    ios.forEach(r => console.log(`    ${r.source_machine.padEnd(20)} ${r.cnt} files | ${r.brands} brands`));
  }

  // Ariel's 3D work
  const { rows: ariel } = await pool.query(`
    SELECT sub_category, COUNT(*) cnt, ROUND(SUM(size_bytes)/1e9::numeric,2) gb
    FROM ${TABLE_NAME} WHERE brand = 'ariel' OR category = '3d_asset'
    GROUP BY sub_category ORDER BY cnt DESC
  `);
  if (ariel.length > 0) {
    console.log("\n  Ariel's 3D work:");
    ariel.forEach(r => console.log(`    ${(r.sub_category||'unclassified').padEnd(20)} ${r.cnt} files | ${r.gb} GB`));
  }

  console.log("\n══════════════════════════════════════════════════════════════\n");
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🔍 Deep Categorizer${DRY_RUN ? " [DRY RUN]" : ""}${FLAGS_ONLY ? " [FLAGS ONLY]" : ""}${USE_OLLAMA ? " [OLLAMA ON]" : ""}`);

  if (REPORT_ONLY) {
    await printReport();
    await pool.end();
    return;
  }

  // Load all duplicate file IDs for flag computation
  const { rows: dupeRows } = await pool.query(
    `SELECT id
       FROM ${TABLE_NAME}
      WHERE sha256 IS NOT NULL
        AND sha256 IN (
          SELECT sha256
            FROM ${TABLE_NAME}
           WHERE sha256 IS NOT NULL
           GROUP BY sha256
          HAVING COUNT(*) > 1
        )`
  );
  const dupeSet = new Set(dupeRows.map(r => r.id));
  console.log(`  Loaded ${dupeSet.size.toLocaleString()} known duplicate file IDs`);

  // Process by category
  const CATEGORIES = CATEGORY
    ? [CATEGORY]
    : ["image","video","photo","design","3d_asset","document","code","ios_app","audio","archive","unknown",null];

  let grandTotal = 0;

  for (const cat of CATEGORIES) {
    const catClause = cat ? `category = '${cat}'` : `category IS NULL`;
    const { rows: [{ cnt }] } = await pool.query(
      `SELECT COUNT(*) cnt
         FROM ${TABLE_NAME}
        WHERE ${catClause}
          AND COALESCE(review_status, 'pending') != 'ignored'`
    );
    if (Number(cnt) === 0) continue;

    console.log(`\n▶ ${cat || "uncategorized"} — ${Number(cnt).toLocaleString()} files`);

    const BATCH = 500;
    let offset = 0;
    while (true) {
      const { rows: files } = await pool.query(
        `SELECT id, path, COALESCE(name, '') AS filename, ext, size_bytes, brand, category,
                sub_category, category_confidence, source_machine, review_status
         FROM ${TABLE_NAME}
         WHERE ${catClause}
           AND COALESCE(review_status, 'pending') != 'ignored'
         ORDER BY id LIMIT $1 OFFSET $2`,
        [BATCH, offset]
      );
      if (files.length === 0) break;
      await processBatch(files, dupeSet);
      offset += files.length;
      grandTotal += files.length;
      process.stdout.write(`\r  processed ${offset.toLocaleString()} / ${Number(cnt).toLocaleString()}...`);
    }
    console.log(`\r  ✅ ${Number(cnt).toLocaleString()} done`);
  }

  console.log(`\n✅ Total processed: ${grandTotal.toLocaleString()} files`);

  await printReport();
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
