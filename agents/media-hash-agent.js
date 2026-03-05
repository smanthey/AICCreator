// agents/media-hash-agent.js
// Deterministic media perceptual hashing (dHash + aHash) using ffmpeg grayscale frames.
// Design follows deterministic DAM patterns used by projects like PhotoPrism/Immich:
// metadata + hashes first, AI later only for ambiguous cases.

"use strict";

const fs = require("fs");
const { execFile } = require("child_process");
const { register } = require("./registry");
const pg = require("../infra/postgres");

function execFileBuffer(bin, args, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, encoding: "buffer", maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const msg = stderr?.toString()?.trim() || err.message;
        return reject(new Error(`${bin} failed: ${msg}`));
      }
      resolve(Buffer.from(stdout));
    });
  });
}

function execFileText(bin, args, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const msg = stderr?.toString()?.trim() || err.message;
        return reject(new Error(`${bin} failed: ${msg}`));
      }
      resolve(String(stdout || "").trim());
    });
  });
}

async function hasBinary(name) {
  try {
    await execFileText("which", [name]);
    return true;
  } catch {
    return false;
  }
}

function bitsToHex(bits) {
  let out = "";
  for (let i = 0; i < bits.length; i += 4) {
    const nibble = (bits[i] << 3) | (bits[i + 1] << 2) | (bits[i + 2] << 1) | bits[i + 3];
    out += nibble.toString(16);
  }
  return out;
}

function computeDHash(gray9x8) {
  if (!Buffer.isBuffer(gray9x8) || gray9x8.length < 72) {
    throw new Error(`dHash expects 72 bytes, got ${gray9x8?.length || 0}`);
  }
  const bits = new Array(64).fill(0);
  let k = 0;
  for (let y = 0; y < 8; y++) {
    const row = y * 9;
    for (let x = 0; x < 8; x++) {
      bits[k++] = gray9x8[row + x] < gray9x8[row + x + 1] ? 1 : 0;
    }
  }
  return bitsToHex(bits);
}

function computeAHash(gray8x8) {
  if (!Buffer.isBuffer(gray8x8) || gray8x8.length < 64) {
    throw new Error(`aHash expects 64 bytes, got ${gray8x8?.length || 0}`);
  }
  let sum = 0;
  for (let i = 0; i < 64; i++) sum += gray8x8[i];
  const avg = sum / 64;
  const bits = new Array(64).fill(0);
  for (let i = 0; i < 64; i++) bits[i] = gray8x8[i] >= avg ? 1 : 0;
  return bitsToHex(bits);
}

async function frameGrayBytes(filePath, width, height, frameSec = null) {
  const vf = `scale=${width}:${height},format=gray`;
  const args = ["-v", "error"];
  if (frameSec != null) args.push("-ss", String(frameSec));
  args.push("-i", filePath, "-frames:v", "1", "-vf", vf, "-f", "rawvideo", "pipe:1");
  return execFileBuffer("ffmpeg", args, 45000);
}

async function hashMedia(filePath, mime, frameSec) {
  const isVideo = String(mime || "").toLowerCase().startsWith("video/");

  const sec = isVideo ? frameSec : null;
  let d9x8;
  let a8x8;

  try {
    d9x8 = await frameGrayBytes(filePath, 9, 8, sec);
    a8x8 = await frameGrayBytes(filePath, 8, 8, sec);
  } catch (e) {
    if (isVideo && sec !== 0) {
      d9x8 = await frameGrayBytes(filePath, 9, 8, 0);
      a8x8 = await frameGrayBytes(filePath, 8, 8, 0);
    } else {
      throw e;
    }
  }

  return {
    dhash: computeDHash(d9x8),
    ahash: computeAHash(a8x8),
  };
}

register("media_hash", async (payload = {}) => {
  const {
    limit = 200,
    hostname,
    force = false,
    dry_run = false,
    frame_second = 1,
  } = payload;

  const ffmpegOk = await hasBinary("ffmpeg");
  if (!ffmpegOk) throw new Error("media_hash requires ffmpeg in PATH");

  const where = ["(fi.mime LIKE 'image/%' OR fi.mime LIKE 'video/%')"];
  const params = [];

  if (hostname) {
    params.push(hostname);
    where.push(`fi.hostname = $${params.length}`);
  }

  if (!force) {
    where.push("NOT EXISTS (SELECT 1 FROM media_hashes mh WHERE mh.file_index_id = fi.id)");
  }

  params.push(Math.min(Math.max(Number(limit) || 200, 1), 5000));

  const { rows } = await pg.query(
    `SELECT fi.id, fi.path, fi.mime, fi.hostname
       FROM file_index fi
      WHERE ${where.join(" AND ")}
      ORDER BY fi.indexed_at DESC
      LIMIT $${params.length}`,
    params
  );

  let processed = 0;
  let stored = 0;
  let skipped = 0;
  let failed = 0;
  const errors = [];

  for (const file of rows) {
    if (!fs.existsSync(file.path)) { skipped++; continue; }

    processed++;
    try {
      const hashes = await hashMedia(file.path, file.mime, Number(frame_second) || 1);
      if (!dry_run) {
        await pg.query(
          `INSERT INTO media_hashes (file_index_id, method, dhash_hex, ahash_hex, frame_second)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (file_index_id) DO UPDATE SET
             method = EXCLUDED.method,
             dhash_hex = EXCLUDED.dhash_hex,
             ahash_hex = EXCLUDED.ahash_hex,
             frame_second = EXCLUDED.frame_second,
             extracted_at = NOW()`,
          [file.id, "ffmpeg-gray-9x8-8x8", hashes.dhash, hashes.ahash, Number(frame_second) || 1]
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
    tools: { ffmpeg: ffmpegOk },
    method: "ffmpeg-gray-9x8-8x8",
    errors,
    cost_usd: 0,
    model_used: "deterministic-media-hash",
  };
});
