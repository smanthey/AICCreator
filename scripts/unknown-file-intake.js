#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");

function getArg(flag, fallback = null) {
  const args = process.argv.slice(2);
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : fallback;
}

function usageAndExit() {
  console.error("Usage: node scripts/unknown-file-intake.js --file /absolute/or/relative/path");
  process.exit(1);
}

function safeSlug(name) {
  return String(name || "unknown")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "unknown";
}

function execFileText(bin, args, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const msg = String(stderr || err.message || "").trim();
        return reject(new Error(msg || err.message));
      }
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
  if (!buffer || buffer.length < 16) return null;
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (ascii(buffer.slice(0, 6)) === "GIF87a" || ascii(buffer.slice(0, 6)) === "GIF89a") return "image/gif";
  if (ascii(buffer.slice(0, 5)) === "%PDF-") return "application/pdf";
  if (startsWith(buffer, [0x50, 0x4b, 0x03, 0x04])) return "application/zip";
  if (startsWith(buffer, [0x1f, 0x8b])) return "application/gzip";
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

function chooseMime({ mimeFile, mimeMagic, ext }) {
  if (mimeMagic) return { mime: mimeMagic, via: "magic" };
  if (mimeFile) return { mime: mimeFile, via: "file_cmd" };

  const extMap = {
    md: "text/markdown",
    txt: "text/plain",
    json: "application/json",
    csv: "text/csv",
    xml: "application/xml",
    yaml: "application/yaml",
    yml: "application/yaml",
    js: "application/javascript",
    ts: "application/typescript",
    py: "text/x-python",
    pdf: "application/pdf",
    zip: "application/zip",
  };
  if (ext && extMap[ext]) return { mime: extMap[ext], via: "extension" };

  return { mime: "application/octet-stream", via: "fallback" };
}

function parseableByText(mime) {
  const m = String(mime || "").toLowerCase();
  return (
    m.startsWith("text/") ||
    m === "application/json" ||
    m === "application/xml" ||
    m === "application/yaml" ||
    m === "application/javascript" ||
    m === "application/typescript" ||
    m === "application/sql"
  );
}

function hexSample(buffer, bytes = 96) {
  return (buffer || Buffer.alloc(0)).slice(0, bytes).toString("hex").replace(/(.{2})/g, "$1 ").trim();
}

async function main() {
  const fileArg = getArg("--file");
  if (!fileArg) usageAndExit();

  const filePath = path.resolve(fileArg);
  if (!fs.existsSync(filePath)) {
    throw new Error(`file not found: ${filePath}`);
  }

  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    throw new Error(`not a regular file: ${filePath}`);
  }

  const ext = path.extname(filePath).replace(/^\./, "").toLowerCase();
  const base = path.basename(filePath);

  const fd = fs.openSync(filePath, "r");
  const headerBuf = Buffer.alloc(8192);
  const readBytes = fs.readSync(fd, headerBuf, 0, headerBuf.length, 0);
  fs.closeSync(fd);
  const header = headerBuf.slice(0, readBytes);

  const bins = {
    file: await hasBinary("file"),
    pdftotext: await hasBinary("pdftotext"),
    unzip: await hasBinary("unzip"),
    strings: await hasBinary("strings"),
  };

  let mimeFile = null;
  if (bins.file) {
    try {
      mimeFile = (await execFileText("file", ["--mime-type", "-b", filePath], 8000)).toLowerCase();
    } catch {
      mimeFile = null;
    }
  }

  const mimeMagic = sniffMagic(header);
  const chosen = chooseMime({ mimeFile, mimeMagic, ext });

  const today = new Date().toISOString().slice(0, 10);
  const noteDir = path.join(os.homedir(), "notes", "intake", `${today}_${safeSlug(base)}`);
  const extractedDir = path.join(noteDir, "extracted");
  fs.mkdirSync(extractedDir, { recursive: true });

  const actions = [];
  const needs = [];
  const extractedFiles = [];

  if (parseableByText(chosen.mime)) {
    const maxBytes = 2 * 1024 * 1024;
    const full = fs.readFileSync(filePath);
    const slice = full.slice(0, maxBytes);
    const textOut = path.join(extractedDir, "content.txt");
    fs.writeFileSync(textOut, slice.toString("utf8"));
    extractedFiles.push(textOut);
    actions.push(`Extracted text directly (${slice.length} bytes written).`);
    if (full.length > maxBytes) {
      needs.push("File is larger than 2MB text extraction cap; full extraction intentionally truncated for safety.");
    }
  } else if (chosen.mime === "application/pdf") {
    if (bins.pdftotext) {
      const pdfOut = path.join(extractedDir, "content.txt");
      try {
        await execFileText("pdftotext", [filePath, pdfOut], 20000);
        extractedFiles.push(pdfOut);
        actions.push("Extracted PDF text with pdftotext.");
      } catch (e) {
        needs.push(`pdftotext failed: ${e.message}`);
      }
    } else {
      needs.push("pdftotext not installed; install poppler to extract PDF text.");
    }
  } else if (chosen.mime === "application/zip") {
    if (bins.unzip) {
      try {
        const listing = await execFileText("unzip", ["-l", filePath], 12000);
        const out = path.join(extractedDir, "zip_listing.txt");
        fs.writeFileSync(out, listing + "\n");
        extractedFiles.push(out);
        actions.push("Generated ZIP file listing (no extraction)." );
      } catch (e) {
        needs.push(`unzip listing failed: ${e.message}`);
      }
    } else {
      needs.push("unzip not installed; cannot list archive contents.");
    }
  } else {
    if (bins.strings) {
      try {
        const snippet = await execFileText("strings", ["-n", "8", filePath], 8000);
        if (snippet) {
          const out = path.join(extractedDir, "strings_sample.txt");
          const lines = snippet.split(/\r?\n/).slice(0, 200).join("\n");
          fs.writeFileSync(out, lines + "\n");
          extractedFiles.push(out);
          actions.push("Captured strings sample for binary triage.");
        }
      } catch {}
    }
    needs.push("No safe structured extractor selected for this MIME. Provide parser/tool instruction or allow a specific tool install.");
  }

  const analysisPath = path.join(noteDir, "analysis.md");
  const shortHex = hexSample(header, 96);
  const report = [
    `# Unknown File Intake Analysis`,
    "",
    `- file: ${filePath}`,
    `- filename: ${base}`,
    `- size_bytes: ${stat.size}`,
    `- extension: ${ext || "(none)"}`,
    `- mime_magic: ${mimeMagic || "(none)"}`,
    `- mime_file_cmd: ${mimeFile || "(unavailable/failed)"}`,
    `- chosen_mime: ${chosen.mime}`,
    `- chosen_via: ${chosen.via}`,
    "",
    `## Deterministic Evidence`,
    "",
    "```text",
    shortHex || "(no header bytes)",
    "```",
    "",
    `## Handler Selection`,
    "",
    ...actions.map((a) => `- ${a}`),
    ...(actions.length ? [] : ["- No extractor executed."]),
    "",
    `## Extracted Artifacts`,
    "",
    ...extractedFiles.map((f) => `- ${f}`),
    ...(extractedFiles.length ? [] : ["- None"]),
    "",
    `## Triage`,
    "",
    ...needs.map((n) => `- ${n}`),
    ...(needs.length ? [] : ["- Fully classified and routed."]),
    "",
    `## Safety`,
    "",
    "- No destructive operations performed.",
    "- No third-party uploads performed.",
  ].join("\n");

  fs.writeFileSync(analysisPath, report + "\n");

  console.log("✅ Unknown file intake complete");
  console.log(`analysis: ${analysisPath}`);
  console.log(`extracted_dir: ${extractedDir}`);
  console.log(`chosen_mime: ${chosen.mime}`);
  console.log(`chosen_via: ${chosen.via}`);
}

main().catch((err) => {
  console.error(`[unknown-file-intake] fatal: ${err.message}`);
  process.exit(1);
});
