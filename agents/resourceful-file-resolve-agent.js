// agents/resourceful-file-resolve-agent.js
// Resourceful fallback resolver for unknown/unsupported file types.
//
// Strategy:
// 1) Inspect header bytes (magic numbers)
// 2) Use extension fallback
// 3) Probe `file --mime-type` when available
// 4) Derive category + follow-up tool plan
//
// Writes resolved mime/category back to file_index so downstream agents can continue.

"use strict";

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { register } = require("./registry");
const pg = require("../infra/postgres");

const EXT_MIME = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
  webp: "image/webp", heic: "image/heic", heif: "image/heif", tif: "image/tiff", tiff: "image/tiff",
  bmp: "image/bmp", svg: "image/svg+xml", psd: "image/vnd.adobe.photoshop",
  mp4: "video/mp4", mov: "video/quicktime", m4v: "video/x-m4v", mkv: "video/x-matroska", avi: "video/x-msvideo", webm: "video/webm",
  mp3: "audio/mpeg", wav: "audio/wav", flac: "audio/flac", aac: "audio/aac", m4a: "audio/mp4", ogg: "audio/ogg",
  pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip", gz: "application/gzip", rar: "application/vnd.rar", "7z": "application/x-7z-compressed",
  txt: "text/plain", md: "text/markdown", csv: "text/csv", json: "application/json", xml: "application/xml", yaml: "application/yaml", yml: "application/yaml",
  js: "application/javascript", mjs: "application/javascript", cjs: "application/javascript", ts: "application/typescript", jsx: "text/jsx", tsx: "application/typescript",
  py: "text/x-python", rb: "text/x-ruby", go: "text/x-go", rs: "text/x-rust", java: "text/x-java-source", swift: "text/x-swift",
  sql: "application/sql",
};

function execFileText(bin, args, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message || "").toString().trim()));
      resolve(String(stdout || "").trim());
    });
  });
}

async function hasBinary(name) {
  try {
    const out = await execFileText("/usr/bin/env", ["bash", "-lc", `command -v ${name}`], 5000);
    return Boolean(out);
  } catch {
    return false;
  }
}

function startsWith(buf, sig) {
  if (!buf || buf.length < sig.length) return false;
  for (let i = 0; i < sig.length; i += 1) if (buf[i] !== sig[i]) return false;
  return true;
}

function ascii(buf) {
  return Buffer.isBuffer(buf) ? buf.toString("ascii") : "";
}

function sniffMagic(buffer) {
  if (!buffer || buffer.length < 12) return null;

  // Images
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (ascii(buffer.slice(0, 6)) === "GIF87a" || ascii(buffer.slice(0, 6)) === "GIF89a") return "image/gif";
  if (ascii(buffer.slice(0, 4)) === "RIFF" && ascii(buffer.slice(8, 12)) === "WEBP") return "image/webp";
  if (ascii(buffer.slice(0, 4)) === "II*\u0000" || ascii(buffer.slice(0, 4)) === "MM\u0000*") return "image/tiff";
  if (ascii(buffer.slice(0, 2)) === "BM") return "image/bmp";

  // PDF + archives
  if (ascii(buffer.slice(0, 5)) === "%PDF-") return "application/pdf";
  if (startsWith(buffer, [0x50, 0x4b, 0x03, 0x04])) return "application/zip";
  if (startsWith(buffer, [0x1f, 0x8b])) return "application/gzip";
  if (startsWith(buffer, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return "application/x-7z-compressed";
  if (startsWith(buffer, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07])) return "application/vnd.rar";

  // Audio/video
  if (ascii(buffer.slice(4, 8)) === "ftyp") {
    const brand = ascii(buffer.slice(8, 12)).toLowerCase();
    if (brand.includes("heic") || brand.includes("heif")) return "image/heic";
    if (brand.includes("m4a")) return "audio/mp4";
    if (brand.includes("qt")) return "video/quicktime";
    return "video/mp4";
  }
  if (ascii(buffer.slice(0, 4)) === "RIFF" && ascii(buffer.slice(8, 12)) === "WAVE") return "audio/wav";
  if (ascii(buffer.slice(0, 4)) === "fLaC") return "audio/flac";
  if (ascii(buffer.slice(0, 4)) === "OggS") return "audio/ogg";
  if (ascii(buffer.slice(0, 3)) === "ID3" || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)) return "audio/mpeg";

  // Text-ish heuristic
  const n = Math.min(buffer.length, 512);
  let printable = 0;
  let zeroes = 0;
  for (let i = 0; i < n; i += 1) {
    const c = buffer[i];
    if (c === 0) zeroes += 1;
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)) printable += 1;
  }
  if (zeroes === 0 && printable / Math.max(1, n) > 0.9) return "text/plain";
  return null;
}

function inferCategory(mime) {
  const m = String(mime || "").toLowerCase();
  if (!m || m === "application/octet-stream") return "unknown";
  if (m.startsWith("image/")) return "photo";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("text/")) return "document";
  if (m.includes("javascript") || m.includes("typescript") || m.includes("x-python") || m.includes("sql")) return "code";
  if (
    m.includes("zip") || m.includes("gzip") || m.includes("rar") || m.includes("7z") ||
    m.includes("x-tar") || m.includes("x-apple-diskimage")
  ) return "archive";
  if (
    m.includes("pdf") || m.includes("msword") || m.includes("officedocument") ||
    m.includes("spreadsheetml") || m.includes("presentationml")
  ) return "document";
  if (m === "application/json" || m === "application/xml" || m === "application/yaml") return "config";
  return "unknown";
}

function buildToolPlan(mime) {
  const m = String(mime || "").toLowerCase();
  const out = [];
  if (m.startsWith("image/") || m.startsWith("video/") || m.startsWith("audio/")) out.push("media_enrich");
  if (m.startsWith("image/") || m.startsWith("video/")) out.push("media_hash");
  if (m.startsWith("image/")) out.push("media_visual_catalog");
  return out;
}

async function detectMimeForRow(row, bins) {
  const ext = String(row.ext || "").toLowerCase();
  const existingMime = String(row.mime || "").toLowerCase();
  const filePath = String(row.path || "");
  if (!filePath || !fs.existsSync(filePath)) {
    return { mime: existingMime || null, via: "missing_file", confidence: 0, reason: "file_missing" };
  }

  let header = null;
  try {
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(8192);
    const bytes = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    header = buf.slice(0, Math.max(0, bytes));
  } catch {}

  const magicMime = sniffMagic(header);
  if (magicMime) {
    return { mime: magicMime, via: "magic", confidence: 0.97, reason: "magic_header" };
  }

  if (ext && EXT_MIME[ext]) {
    return { mime: EXT_MIME[ext], via: "extension", confidence: 0.72, reason: `ext:${ext}` };
  }

  if (bins.file) {
    try {
      const out = (await execFileText("file", ["--mime-type", "-b", filePath], 8000)).toLowerCase();
      if (out) return { mime: out, via: "file_cmd", confidence: out === "application/octet-stream" ? 0.4 : 0.83, reason: "file_mime_probe" };
    } catch {}
  }

  return {
    mime: existingMime || "application/octet-stream",
    via: "fallback",
    confidence: 0.25,
    reason: "unresolved_fallback",
  };
}

register("resourceful_file_resolve", async (payload = {}) => {
  const {
    limit = 500,
    hostname,
    path_prefix,
    force = false,
    dry_run = false,
  } = payload;

  const bins = {
    file: await hasBinary("file"),
    exiftool: await hasBinary("exiftool"),
    ffprobe: await hasBinary("ffprobe"),
  };

  const where = [];
  const params = [];

  if (hostname) {
    params.push(hostname);
    where.push(`fi.hostname = $${params.length}`);
  }
  if (path_prefix) {
    params.push(`${path_prefix}%`);
    where.push(`fi.path LIKE $${params.length}`);
  }
  if (!force) {
    where.push(`(
      fi.mime IS NULL OR fi.mime = '' OR fi.mime = 'application/octet-stream'
      OR fi.category IS NULL OR fi.category = 'unknown'
    )`);
  }
  const limitSafe = Math.min(Math.max(Number(limit) || 500, 1), 5000);
  params.push(limitSafe);

  const sql = `
    SELECT fi.id, fi.path, fi.name, fi.ext, fi.mime, fi.category, fi.hostname
    FROM file_index fi
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY fi.indexed_at DESC
    LIMIT $${params.length}
  `;

  const { rows } = await pg.query(sql, params);
  let processed = 0;
  let resolved = 0;
  let unresolved = 0;
  const sampleUnresolved = [];
  const toolPlans = {};

  for (const row of rows) {
    processed += 1;
    const found = await detectMimeForRow(row, bins);
    const category = inferCategory(found.mime);
    const plan = buildToolPlan(found.mime);
    for (const p of plan) toolPlans[p] = (toolPlans[p] || 0) + 1;

    const isResolved = found.mime && found.mime !== "application/octet-stream";
    if (!isResolved) {
      unresolved += 1;
      if (sampleUnresolved.length < 30) {
        sampleUnresolved.push({
          id: row.id,
          path: row.path,
          ext: row.ext,
          existing_mime: row.mime,
          reason: found.reason,
        });
      }
    } else {
      resolved += 1;
    }

    if (dry_run) continue;

    await pg.query(
      `UPDATE file_index
          SET mime = CASE
                        WHEN mime IS NULL OR mime = '' OR mime = 'application/octet-stream'
                        THEN $2 ELSE mime END,
              category = CASE
                           WHEN category IS NULL OR category = 'unknown'
                           THEN $3 ELSE category END,
              category_confidence = CASE
                                      WHEN category IS NULL OR category = 'unknown'
                                      THEN $4 ELSE category_confidence END,
              category_reason = CASE
                                  WHEN category IS NULL OR category = 'unknown' OR category_reason IS NULL
                                  THEN $5 ELSE category_reason END,
              classify_model = COALESCE(classify_model, 'deterministic-resourceful-resolver'),
              classified_at = NOW()
        WHERE id = $1`,
      [row.id, found.mime, category, found.confidence, `resourceful:${found.via}:${found.reason}`]
    );
  }

  return {
    scanned: rows.length,
    processed,
    resolved,
    unresolved,
    dry_run,
    tools: bins,
    follow_up_plan: Object.keys(toolPlans).sort().map((k) => ({ task_type: k, suggested: toolPlans[k] })),
    unresolved_sample: sampleUnresolved,
    cost_usd: 0,
    model_used: "deterministic-resourceful-v1",
  };
});

