// agents/media-enrich-agent.js
// Deterministic media enrichment using exiftool and ffprobe.
// No LLM usage.

"use strict";

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { register } = require("./registry");
const pg = require("../infra/postgres");

function execFileJson(bin, args, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const msg = stderr?.toString()?.trim() || err.message;
        return reject(new Error(`${bin} failed: ${msg}`));
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        reject(new Error(`${bin} JSON parse failed: ${e.message}`));
      }
    });
  });
}

function execFileText(bin, args, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const msg = stderr?.toString()?.trim() || err.message;
        return reject(new Error(`${bin} failed: ${msg}`));
      }
      resolve(String(stdout || "").trim());
    });
  });
}

const BIN_DIR_CANDIDATES = [
  "/opt/homebrew/bin",
  "/opt/homebrew/sbin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
];

async function resolveBinary(name) {
  try {
    const resolved = await execFileText("/usr/bin/env", ["bash", "-lc", `command -v ${name}`], 5000);
    if (resolved) return resolved;
  } catch {}

  for (const dir of BIN_DIR_CANDIDATES) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function toNumber(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickExifPrimary(raw) {
  return {
    width: toNumber(raw.ImageWidth || raw.ExifImageWidth),
    height: toNumber(raw.ImageHeight || raw.ExifImageHeight),
    camera_make: raw.Make || null,
    camera_model: raw.Model || null,
    lens_model: raw.LensModel || raw.LensID || null,
    exif_datetime: raw.DateTimeOriginal || raw.CreateDate || null,
    gps_lat: toNumber(raw.GPSLatitude),
    gps_lon: toNumber(raw.GPSLongitude),
  };
}

function pickFfprobePrimary(raw) {
  const streams = Array.isArray(raw.streams) ? raw.streams : [];
  const format = raw.format || {};
  const v = streams.find(s => s.codec_type === "video") || {};

  let fps = null;
  if (v.r_frame_rate && typeof v.r_frame_rate === "string" && v.r_frame_rate.includes("/")) {
    const [a, b] = v.r_frame_rate.split("/").map(Number);
    if (Number.isFinite(a) && Number.isFinite(b) && b !== 0) fps = a / b;
  }

  return {
    width: toNumber(v.width),
    height: toNumber(v.height),
    duration_seconds: toNumber(format.duration || v.duration),
    codec: v.codec_name || null,
    fps: fps != null ? Number(fps.toFixed(3)) : null,
  };
}

async function enrichOne(file, bins) {
  const mime = String(file.mime || "").toLowerCase();
  const isImage = mime.startsWith("image/");
  const isVideo = mime.startsWith("video/");
  const isAudio = mime.startsWith("audio/");

  if (!fs.existsSync(file.path)) {
    return { ok: false, reason: "file_missing" };
  }

  if (isImage) {
    const raw = await execFileJson(bins.exiftool, ["-j", "-n", file.path]);
    const first = Array.isArray(raw) ? (raw[0] || {}) : {};
    const primary = pickExifPrimary(first);
    return {
      ok: true,
      media_kind: "image",
      tool: "exiftool",
      metadata: first,
      ...primary,
      duration_seconds: null,
      codec: null,
      fps: null,
    };
  }

  if (isVideo || isAudio) {
    const raw = await execFileJson(bins.ffprobe, [
      "-v", "error",
      "-show_entries", "format:stream",
      "-print_format", "json",
      file.path,
    ]);
    const primary = pickFfprobePrimary(raw);
    return {
      ok: true,
      media_kind: isVideo ? "video" : "audio",
      tool: "ffprobe",
      metadata: raw,
      camera_make: null,
      camera_model: null,
      lens_model: null,
      exif_datetime: null,
      gps_lat: null,
      gps_lon: null,
      ...primary,
    };
  }

  return { ok: false, reason: "unsupported_mime" };
}

register("media_enrich", async (payload = {}) => {
  const {
    limit = 100,
    hostname,
    force = false,
    dry_run = false,
  } = payload;

  const exiftoolBin = await resolveBinary("exiftool");
  const ffprobeBin = await resolveBinary("ffprobe");
  const exiftoolOk = !!exiftoolBin;
  const ffprobeOk = !!ffprobeBin;

  if (!exiftoolOk && !ffprobeOk) {
    throw new Error("media_enrich requires exiftool and/or ffprobe in PATH");
  }

  const where = ["(fi.mime LIKE 'image/%' OR fi.mime LIKE 'video/%' OR fi.mime LIKE 'audio/%')"];
  const params = [];

  if (hostname) {
    params.push(hostname);
    where.push(`fi.hostname = $${params.length}`);
  }

  if (!force) {
    where.push("NOT EXISTS (SELECT 1 FROM media_metadata mm WHERE mm.file_index_id = fi.id)");
  }

  params.push(Math.min(Math.max(Number(limit) || 100, 1), 2000));

  const sql = `
    SELECT fi.id, fi.path, fi.mime, fi.ext, fi.hostname
    FROM file_index fi
    WHERE ${where.join(" AND ")}
    ORDER BY fi.indexed_at DESC
    LIMIT $${params.length}
  `;

  const { rows } = await pg.query(sql, params);

  let processed = 0;
  let stored = 0;
  let skipped = 0;
  let failed = 0;
  const errors = [];

  for (const file of rows) {
    const mime = String(file.mime || "").toLowerCase();
    if (mime.startsWith("image/") && !exiftoolOk) { skipped++; continue; }
    if ((mime.startsWith("video/") || mime.startsWith("audio/")) && !ffprobeOk) { skipped++; continue; }

    processed++;

    try {
      const out = await enrichOne(file, {
        exiftool: exiftoolBin,
        ffprobe: ffprobeBin,
      });
      if (!out.ok) { skipped++; continue; }

      if (!dry_run) {
        await pg.query(
          `INSERT INTO media_metadata (
             file_index_id, media_kind, tool, metadata_json,
             width, height, duration_seconds, codec, fps,
             camera_make, camera_model, lens_model,
             exif_datetime, gps_lat, gps_lon
           )
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
           ON CONFLICT (file_index_id) DO UPDATE SET
             media_kind = EXCLUDED.media_kind,
             tool = EXCLUDED.tool,
             metadata_json = EXCLUDED.metadata_json,
             width = EXCLUDED.width,
             height = EXCLUDED.height,
             duration_seconds = EXCLUDED.duration_seconds,
             codec = EXCLUDED.codec,
             fps = EXCLUDED.fps,
             camera_make = EXCLUDED.camera_make,
             camera_model = EXCLUDED.camera_model,
             lens_model = EXCLUDED.lens_model,
             exif_datetime = EXCLUDED.exif_datetime,
             gps_lat = EXCLUDED.gps_lat,
             gps_lon = EXCLUDED.gps_lon,
             extracted_at = NOW()`,
          [
            file.id,
            out.media_kind,
            out.tool,
            JSON.stringify(out.metadata || {}),
            out.width,
            out.height,
            out.duration_seconds,
            out.codec,
            out.fps,
            out.camera_make,
            out.camera_model,
            out.lens_model,
            out.exif_datetime,
            out.gps_lat,
            out.gps_lon,
          ]
        );
      }
      stored++;
    } catch (e) {
      failed++;
      if (errors.length < 20) {
        errors.push({ id: file.id, path: file.path, error: e.message });
      }
    }
  }

  return {
    scanned: rows.length,
    processed,
    stored,
    skipped,
    failed,
    dry_run: !!dry_run,
    tools: { exiftool: exiftoolOk, ffprobe: ffprobeOk },
    binaries: { exiftool: exiftoolBin, ffprobe: ffprobeBin },
    errors,
    cost_usd: 0,
    model_used: "deterministic-media-enrich",
  };
});
