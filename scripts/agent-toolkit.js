"use strict";

/**
 * agent-toolkit.js
 *
 * Shared utilities for all OpenClaw agents. Embodies AGENT_PRINCIPLES.md:
 *   1. Resourcefulness over refusal — identify and parse any file type
 *   2. Browser automation as universal fallback — every website is a slow API
 *
 * Usage:
 *   const { identifyFile, parseFile, fetchWithFallback, fetchWithBrowser } = require('./agent-toolkit');
 */

const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const { spawnSync, execSync } = require("child_process");

// ─── File identification ───────────────────────────────────────────────────────

/** Magic byte signatures → file type */
const MAGIC = [
  { sig: [0x25, 0x50, 0x44, 0x46],             type: "pdf",      ext: ".pdf",  desc: "PDF document" },
  { sig: [0x50, 0x4B, 0x03, 0x04],             type: "zip",      ext: ".zip",  desc: "ZIP / Office Open XML" },
  { sig: [0x89, 0x50, 0x4E, 0x47],             type: "png",      ext: ".png",  desc: "PNG image" },
  { sig: [0xFF, 0xD8, 0xFF],                   type: "jpeg",     ext: ".jpg",  desc: "JPEG image" },
  { sig: [0x47, 0x49, 0x46, 0x38],             type: "gif",      ext: ".gif",  desc: "GIF image" },
  { sig: [0x49, 0x44, 0x33],                   type: "mp3",      ext: ".mp3",  desc: "MP3 audio (ID3)" },
  { sig: [0xFF, 0xFB],                         type: "mp3",      ext: ".mp3",  desc: "MP3 audio" },
  { sig: [0x1F, 0x8B],                         type: "gzip",     ext: ".gz",   desc: "gzip compressed" },
  { sig: [0x42, 0x5A, 0x68],                   type: "bzip2",    ext: ".bz2",  desc: "bzip2 compressed" },
  { sig: [0xFD, 0x37, 0x7A, 0x58, 0x5A, 0x00],type: "xz",       ext: ".xz",   desc: "XZ compressed" },
  { sig: [0x75, 0x73, 0x74, 0x61, 0x72],       type: "tar",      ext: ".tar",  desc: "TAR archive" },
  { sig: [0x52, 0x49, 0x46, 0x46],             type: "riff",     ext: ".wav",  desc: "RIFF (WAV/AVI)" },
  { sig: [0x42, 0x4D],                         type: "bmp",      ext: ".bmp",  desc: "BMP image" },
  { sig: [0x53, 0x51, 0x4C, 0x69, 0x74, 0x65],type: "sqlite",   ext: ".db",   desc: "SQLite database" },
  { sig: [0x4F, 0x67, 0x67, 0x53],             type: "ogg",      ext: ".ogg",  desc: "OGG container" },
  { sig: [0x66, 0x74, 0x79, 0x70],             type: "mp4",      ext: ".mp4",  desc: "MP4/ISO Base Media", offset: 4 },
  { sig: [0x00, 0x01, 0x00, 0x00, 0x00],       type: "ttf",      ext: ".ttf",  desc: "TrueType font" },
  { sig: [0x4F, 0x54, 0x54, 0x4F],             type: "otf",      ext: ".otf",  desc: "OpenType font" },
  { sig: [0xEF, 0xBB, 0xBF],                   type: "utf8bom",  ext: ".txt",  desc: "UTF-8 with BOM" },
  { sig: [0xFF, 0xFE],                         type: "utf16le",  ext: ".txt",  desc: "UTF-16 LE" },
  { sig: [0xFE, 0xFF],                         type: "utf16be",  ext: ".txt",  desc: "UTF-16 BE" },
  { sig: [0x7F, 0x45, 0x4C, 0x46],             type: "elf",      ext: "",      desc: "ELF binary" },
  { sig: [0xCE, 0xFA, 0xED, 0xFE],             type: "macho",    ext: "",      desc: "Mach-O binary (32-bit)" },
  { sig: [0xCF, 0xFA, 0xED, 0xFE],             type: "macho",    ext: "",      desc: "Mach-O binary (64-bit)" },
  { sig: [0xCA, 0xFE, 0xBA, 0xBE],             type: "java",     ext: ".class",desc: "Java class file" },
];

/**
 * Identify a file from its content.
 * Returns { type, ext, desc, method, mimeType }
 */
async function identifyFile(filePath) {
  const result = {
    type: "unknown",
    ext: path.extname(filePath).toLowerCase(),
    desc: "unknown",
    method: "extension",
    mimeType: "application/octet-stream",
  };

  // 1. Magic bytes
  try {
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);

    for (const m of MAGIC) {
      const offset = m.offset || 0;
      const match = m.sig.every((b, i) => buf[offset + i] === b);
      if (match) {
        result.type = m.type;
        result.desc = m.desc;
        result.method = "magic";
        result.mimeType = mimeForType(m.type);

        // ZIP derivatives: inspect internal structure
        if (m.type === "zip") {
          const inner = detectZipDerivative(filePath);
          if (inner) {
            result.type = inner.type;
            result.desc = inner.desc;
            result.ext = inner.ext;
            result.mimeType = mimeForType(inner.type);
          }
        }
        return result;
      }
    }
  } catch {}

  // 2. `file` command
  try {
    const out = execSync(`file -b "${filePath}" 2>/dev/null`, { encoding: "utf8", timeout: 5000 }).trim();
    if (out && out !== "data") {
      result.desc = out;
      result.method = "file-cmd";
      result.type = inferTypeFromFileOutput(out);
      result.mimeType = mimeForType(result.type);
      return result;
    }
  } catch {}

  // 3. Sniff content as text
  try {
    const buf = await fsp.readFile(filePath);
    const sample = buf.slice(0, 512).toString("utf8", 0, 512);
    const textType = sniffText(sample);
    if (textType) {
      result.type = textType.type;
      result.desc = textType.desc;
      result.method = "text-sniff";
      result.mimeType = mimeForType(textType.type);
      return result;
    }
  } catch {}

  return result;
}

function detectZipDerivative(filePath) {
  try {
    const out = execSync(`unzip -l "${filePath}" 2>/dev/null | head -20`, { encoding: "utf8", timeout: 5000 });
    if (out.includes("word/document.xml"))   return { type: "docx",  desc: "Microsoft Word document", ext: ".docx" };
    if (out.includes("ppt/slides/"))         return { type: "pptx",  desc: "Microsoft PowerPoint",    ext: ".pptx" };
    if (out.includes("xl/workbook.xml"))     return { type: "xlsx",  desc: "Microsoft Excel workbook", ext: ".xlsx" };
    if (out.includes("META-INF/MANIFEST.MF"))return { type: "jar",   desc: "Java JAR file",            ext: ".jar"  };
    if (out.includes("AndroidManifest.xml")) return { type: "apk",   desc: "Android APK",              ext: ".apk"  };
    if (out.includes("_rels/"))              return { type: "ooxml", desc: "Office Open XML",           ext: ".zip"  };
  } catch {}
  return null;
}

function inferTypeFromFileOutput(out) {
  const o = out.toLowerCase();
  if (o.includes("pdf"))        return "pdf";
  if (o.includes("sqlite"))     return "sqlite";
  if (o.includes("jpeg"))       return "jpeg";
  if (o.includes("png"))        return "png";
  if (o.includes("gif"))        return "gif";
  if (o.includes("mp3") || o.includes("mpeg audio")) return "mp3";
  if (o.includes("wav"))        return "wav";
  if (o.includes("mp4"))        return "mp4";
  if (o.includes("json"))       return "json";
  if (o.includes("xml"))        return "xml";
  if (o.includes("html"))       return "html";
  if (o.includes("csv"))        return "csv";
  if (o.includes("ascii") || o.includes("utf-8 text") || o.includes("text")) return "text";
  if (o.includes("gzip"))       return "gzip";
  if (o.includes("zip"))        return "zip";
  if (o.includes("tar"))        return "tar";
  if (o.includes("mach-o"))     return "macho";
  if (o.includes("elf"))        return "elf";
  return "unknown";
}

function sniffText(sample) {
  const s = sample.trimStart();
  if (s.startsWith("{") || s.startsWith("["))        return { type: "json",    desc: "JSON data" };
  if (s.startsWith("<?xml") || s.startsWith("<"))    return { type: "xml",     desc: "XML/HTML document" };
  if (s.startsWith("<!DOCTYPE") || s.toLowerCase().startsWith("<!doctype")) return { type: "html", desc: "HTML document" };
  if (s.startsWith("PK"))                            return { type: "zip",     desc: "ZIP archive" };
  if (/^[-\w]+[:,]/.test(s))                         return { type: "csv",     desc: "CSV/TSV data" };
  if (s.startsWith("---") || /^[a-z_]+:\s/m.test(s))return { type: "yaml",    desc: "YAML data" };
  if (s.startsWith("[") && /^\[.*\]/.test(s))        return { type: "toml",    desc: "TOML config" };
  if (/^#!/.test(s))                                 return { type: "script",  desc: "Shell/script" };
  if (/^(import|export|const|let|var|function|class)\b/.test(s)) return { type: "js", desc: "JavaScript" };
  if (/^(def |class |import |from |if __name__)/.test(s))        return { type: "py", desc: "Python" };
  return null;
}

function mimeForType(type) {
  const map = {
    pdf: "application/pdf", json: "application/json", xml: "application/xml",
    html: "text/html", csv: "text/csv", text: "text/plain", js: "text/javascript",
    py: "text/x-python", yaml: "text/yaml", png: "image/png", jpeg: "image/jpeg",
    gif: "image/gif", bmp: "image/bmp", mp3: "audio/mpeg", wav: "audio/wav",
    mp4: "video/mp4", ogg: "audio/ogg", zip: "application/zip",
    gzip: "application/gzip", tar: "application/x-tar",
    sqlite: "application/x-sqlite3", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  };
  return map[type] || "application/octet-stream";
}

// ─── Source capture / fallback evidence ───────────────────────────────────────

function safeSlug(v) {
  return String(v || "unknown")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "unknown";
}

function isoNow() {
  return new Date().toISOString();
}

function isoDate() {
  return new Date().toISOString().slice(0, 10);
}

function shortDataSummary(data) {
  if (data == null) return { kind: "empty", preview: "" };
  if (typeof data === "string") {
    return {
      kind: "text",
      length: data.length,
      preview: data.slice(0, 8000),
    };
  }
  try {
    const raw = JSON.stringify(data);
    return {
      kind: "json",
      length: raw.length,
      preview: raw.slice(0, 8000),
    };
  } catch {
    return { kind: "unknown", preview: String(data).slice(0, 8000) };
  }
}

function writeSourceArtifact({
  service = "generic",
  url = "",
  finalUrl = "",
  method = "unknown",
  status = -1,
  contentType = "",
  attempts = [],
  data = null,
  screenshotPath = null,
  notes = "",
  guardrails = null,
}) {
  try {
    const date = isoDate();
    const stamp = isoNow().replace(/[:.]/g, "-");
    const host = safeSlug(url ? new URL(url).hostname : "unknown_host");
    const serviceSlug = safeSlug(service);
    const outDir = path.join(os.homedir(), "notes", "sources", serviceSlug, date);
    fs.mkdirSync(outDir, { recursive: true });

    const base = `${stamp}_${host}_${safeSlug(method)}`;
    const jsonPath = path.join(outDir, `${base}.json`);
    const mdPath = path.join(outDir, `${base}.md`);
    const summary = shortDataSummary(data);

    const payload = {
      service: serviceSlug,
      timestamp: isoNow(),
      requested_url: url,
      final_url: finalUrl || url,
      method,
      status,
      content_type: contentType || "",
      attempts,
      screenshot: screenshotPath || null,
      guardrails: guardrails || {
        mode: "read_extract_only",
        form_submit: "blocked",
        purchase: "blocked",
        delete_action: "blocked",
      },
      data_summary: summary,
      notes: notes || "",
    };
    fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2) + "\n");

    const md = [
      "# Source Access Artifact",
      "",
      `- service: ${payload.service}`,
      `- timestamp: ${payload.timestamp}`,
      `- requested_url: ${payload.requested_url}`,
      `- final_url: ${payload.final_url}`,
      `- method: ${payload.method}`,
      `- status: ${payload.status}`,
      `- content_type: ${payload.content_type || "(unknown)"}`,
      `- screenshot: ${payload.screenshot || "(none)"}`,
      "",
      "## Attempts",
      "",
      "```json",
      JSON.stringify(payload.attempts || [], null, 2),
      "```",
      "",
      "## Data Preview",
      "",
      "```text",
      summary.preview || "",
      "```",
      "",
      "## Guardrails",
      "",
      "- Read/extract only",
      "- No form submissions",
      "- No purchase/checkout actions",
      "- No delete operations",
      "",
      `notes: ${payload.notes || ""}`,
    ].join("\n");

    fs.writeFileSync(mdPath, md + "\n");
    return { jsonPath, mdPath };
  } catch {
    return null;
  }
}

// ─── File parsing ──────────────────────────────────────────────────────────────

/**
 * Parse a file using the best available tool for its type.
 * Returns { type, content, meta, method, warnings }
 */
async function parseFile(filePath, options = {}) {
  const info = await identifyFile(filePath);
  const result = { type: info.type, desc: info.desc, content: null, meta: {}, method: null, warnings: [] };

  async function tryTool(toolFn, name) {
    try {
      const out = await toolFn();
      result.method = name;
      return out;
    } catch (err) {
      result.warnings.push(`${name} failed: ${err.message}`);
      return null;
    }
  }

  switch (info.type) {
    case "pdf": {
      // Try pdf-parse first, then pdftotext CLI
      let content = await tryTool(async () => {
        const pdfParse = require("pdf-parse");
        const buf = await fsp.readFile(filePath);
        const data = await pdfParse(buf);
        result.meta = { pages: data.numpages, info: data.info };
        return data.text;
      }, "pdf-parse");
      if (!content) {
        content = await tryTool(async () => {
          return execSync(`pdftotext "${filePath}" - 2>/dev/null`, { encoding: "utf8", timeout: 30000 });
        }, "pdftotext-cli");
      }
      if (!content && options.allowBrowserFallback) {
        content = await tryTool(async () => {
          const res = await fetchWithBrowser(`file://${path.resolve(filePath)}`);
          return res?.data || null;
        }, "playwright-pdf");
      }
      result.content = content;
      break;
    }

    case "xlsx": {
      let content = await tryTool(async () => {
        const XLSX = require("xlsx");
        const wb = XLSX.readFile(filePath);
        const sheets = {};
        for (const name of wb.SheetNames) {
          sheets[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: "" });
        }
        result.meta = { sheets: wb.SheetNames };
        return JSON.stringify(sheets, null, 2);
      }, "xlsx-package");
      result.content = content;
      break;
    }

    case "docx": {
      let content = await tryTool(async () => {
        const AdmZip = require("adm-zip");
        const zip = new AdmZip(filePath);
        const xmlEntry = zip.getEntry("word/document.xml");
        if (!xmlEntry) throw new Error("no word/document.xml");
        const xml = xmlEntry.getData().toString("utf8");
        // Strip XML tags to get plain text
        return xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      }, "adm-zip-docx");
      if (!content) {
        content = await tryTool(async () => {
          return execSync(`antiword "${filePath}" 2>/dev/null || docx2txt "${filePath}" - 2>/dev/null`, { encoding: "utf8", timeout: 15000 });
        }, "antiword-cli");
      }
      result.content = content;
      break;
    }

    case "sqlite": {
      let content = await tryTool(async () => {
        const tables = execSync(`sqlite3 "${filePath}" ".tables" 2>/dev/null`, { encoding: "utf8", timeout: 10000 }).trim();
        const schema = execSync(`sqlite3 "${filePath}" ".schema" 2>/dev/null`, { encoding: "utf8", timeout: 10000 }).trim();
        result.meta = { tables: tables.split(/\s+/).filter(Boolean) };
        return `TABLES: ${tables}\n\nSCHEMA:\n${schema}`;
      }, "sqlite3-cli");
      result.content = content;
      break;
    }

    case "json": {
      const raw = await fsp.readFile(filePath, "utf8");
      try {
        const parsed = JSON.parse(raw);
        result.meta = { keys: typeof parsed === "object" ? Object.keys(parsed) : null };
        result.content = raw;
        result.method = "json-parse";
      } catch {
        result.content = raw;
        result.warnings.push("JSON parse failed — returning raw");
        result.method = "raw";
      }
      break;
    }

    case "csv": {
      const raw = await fsp.readFile(filePath, "utf8");
      const lines = raw.split("\n");
      result.meta = { rows: lines.length, headers: lines[0]?.split(",").map((h) => h.trim()) };
      result.content = raw;
      result.method = "csv-raw";
      break;
    }

    case "gzip": {
      let content = await tryTool(async () => {
        return execSync(`gunzip -c "${filePath}" 2>/dev/null | head -c 65536`, { encoding: "utf8", timeout: 15000 });
      }, "gunzip-cli");
      result.content = content;
      break;
    }

    case "png":
    case "jpeg":
    case "gif":
    case "bmp": {
      // Return as base64 for vision models, plus metadata
      let content = await tryTool(async () => {
        const buf = await fsp.readFile(filePath);
        const b64 = buf.toString("base64");
        result.meta = { size_bytes: buf.length, base64_length: b64.length, mime: info.mimeType };
        return b64;
      }, "base64-image");
      result.content = content;
      break;
    }

    case "elf":
    case "macho": {
      let content = await tryTool(async () => {
        const strings = execSync(`strings "${filePath}" 2>/dev/null | head -100`, { encoding: "utf8", timeout: 10000 });
        const symbols = execSync(`nm "${filePath}" 2>/dev/null | head -30 || objdump -t "${filePath}" 2>/dev/null | head -30`, { encoding: "utf8", timeout: 10000 });
        return `STRINGS (first 100):\n${strings}\n\nSYMBOLS:\n${symbols}`;
      }, "strings+nm");
      result.content = content;
      break;
    }

    default: {
      // Last resort: try to read as text, fall back to hex dump
      let content = await tryTool(async () => {
        const raw = await fsp.readFile(filePath, "utf8");
        // Check if it's actually text
        if (/[\x00-\x08\x0E-\x1F\x7F-\x9F]/.test(raw.slice(0, 512))) {
          throw new Error("binary content");
        }
        return raw;
      }, "utf8-text");

      if (!content) {
        content = await tryTool(async () => {
          const hex = execSync(`xxd "${filePath}" 2>/dev/null | head -32`, { encoding: "utf8", timeout: 5000 });
          const strings = execSync(`strings "${filePath}" 2>/dev/null | head -50`, { encoding: "utf8", timeout: 5000 });
          return `HEX HEADER:\n${hex}\n\nEMBEDDED STRINGS:\n${strings}`;
        }, "xxd-fallback");
      }

      result.content = content;
    }
  }

  return result;
}

// ─── HTTP fetch with fallback ─────────────────────────────────────────────────

/**
 * Fetch a URL using the best available method.
 * Tries: native fetch → curl → Playwright headless browser
 *
 * Returns { ok, status, data, method, contentType }
 */
async function fetchWithFallback(url, options = {}) {
  const timeoutMs = options.timeoutMs || 15_000;
  const attempts = [];
  const service = options.sourceService || "generic";
  const captureAll = options.captureSource === true;

  // 1. Native fetch
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; OpenClaw/1.0)", ...(options.headers || {}) },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    });
    if (res.ok) {
      const contentType = res.headers.get("content-type") || "";
      const data = contentType.includes("json") ? await res.json() : await res.text();
      let artifact = null;
      if (captureAll) {
        artifact = writeSourceArtifact({
          service,
          url,
          finalUrl: res.url || url,
          method: "fetch",
          status: res.status,
          contentType,
          attempts,
          data,
        });
      }
      return { ok: true, status: res.status, data, method: "fetch", contentType, attempts, artifact };
    }
    if (res.status === 404) {
      attempts.push({ method: "fetch", status: 404, reason: "not_found" });
      return { ok: false, status: 404, data: null, method: "fetch", contentType: "", attempts };
    }
    attempts.push({ method: "fetch", status: res.status, reason: "non_ok" });
    // Non-404 failure → try next method
  } catch (err) {
    attempts.push({ method: "fetch", error: err.message });
  }

  // 2. curl (handles some TLS issues fetch doesn't)
  try {
    const headers = Object.entries(options.headers || {}).map(([k, v]) => `-H "${k}: ${v}"`).join(" ");
    const curlOut = execSync(
      `curl -sL --max-time ${Math.ceil(timeoutMs / 1000)} -A "Mozilla/5.0 (compatible; OpenClaw/1.0)" ${headers} "${url}" 2>/dev/null | head -c 524288`,
      { encoding: "utf8", timeout: timeoutMs + 5000 }
    );
    if (curlOut && curlOut.length > 0) {
      let data = curlOut;
      try { data = JSON.parse(curlOut); } catch {}
      const artifact = writeSourceArtifact({
        service,
        url,
        method: "curl",
        status: 200,
        contentType: "unknown",
        attempts,
        data,
        notes: "fetch path failed or was non-ok; curl fallback used",
      });
      return { ok: true, status: 200, data, method: "curl", contentType: "unknown", attempts, artifact };
    }
    attempts.push({ method: "curl", status: -1, reason: "empty_output" });
  } catch (err) {
    attempts.push({ method: "curl", error: err.message });
  }

  // 3. Playwright browser fallback
  if (options.allowBrowser !== false) {
    return fetchWithBrowser(url, {
      ...options,
      sourceService: service,
      attempts,
      captureSource: true,
      notes: options.notes || "http methods failed; browser fallback used",
    });
  }

  writeSourceArtifact({
    service,
    url,
    method: "all-failed",
    status: -1,
    attempts,
    data: null,
    notes: "fetch/curl failed and browser fallback disabled",
  });
  return { ok: false, status: -1, data: null, method: "all-failed", contentType: "", attempts };
}

/**
 * Fetch using Playwright headless browser.
 * Use when direct HTTP access is blocked by bot detection or requires JS rendering.
 */
async function fetchWithBrowser(url, options = {}) {
  let chromium;
  try {
    ({ chromium } = require("playwright"));
  } catch {
    return { ok: false, status: -1, data: null, method: "playwright-not-installed", contentType: "" };
  }

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    const context = await browser.newContext({
      userAgent: options.userAgent || "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 },
      extraHTTPHeaders: options.headers || {},
    });
    const page = await context.newPage();
    const attempts = Array.isArray(options.attempts) ? options.attempts.slice() : [];
    attempts.push({ method: "playwright", status: "started" });

    // Guardrail: read/extract only. Block mutating request methods by default.
    if (options.readOnly !== false) {
      await page.route("**/*", (route) => {
        const req = route.request();
        const m = String(req.method() || "").toUpperCase();
        if (m !== "GET" && m !== "HEAD") {
          return route.abort();
        }
        return route.continue();
      });
    }

    // Intercept and capture API responses if we're looking for data
    const capturedResponses = [];
    if (options.captureApiPattern) {
      page.on("response", async (res) => {
        if (new RegExp(options.captureApiPattern).test(res.url())) {
          try {
            const json = await res.json();
            capturedResponses.push({ url: res.url(), data: json });
          } catch {}
        }
      });
    }

    const nav = await page.goto(url, { waitUntil: "domcontentloaded", timeout: options.timeoutMs || 30_000 });

    if (options.waitForSelector) {
      await page.waitForSelector(options.waitForSelector, { timeout: 10_000 }).catch(() => {});
    }
    if (options.waitMs) {
      await new Promise((r) => setTimeout(r, options.waitMs));
    }

    // If we captured API responses, prefer those
    if (capturedResponses.length > 0) {
      let screenshotPath = null;
      if (options.captureScreenshot) {
        const date = isoDate();
        const stamp = isoNow().replace(/[:.]/g, "-");
        const outDir = path.join(os.homedir(), "notes", "sources", safeSlug(options.sourceService || "generic"), date);
        fs.mkdirSync(outDir, { recursive: true });
        screenshotPath = path.join(outDir, `${stamp}_${safeSlug(new URL(url).hostname)}_playwright.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
      }
      const artifact = writeSourceArtifact({
        service: options.sourceService || "generic",
        url,
        finalUrl: page.url(),
        method: "playwright-api-intercept",
        status: 200,
        contentType: "application/json",
        attempts,
        data: capturedResponses,
        screenshotPath,
        notes: options.notes || "",
      });
      return { ok: true, status: 200, data: capturedResponses, method: "playwright-api-intercept", contentType: "application/json", attempts, artifact };
    }

    // Extract structured data from page
    const extracted = await page.evaluate((extractSelector) => {
      // JSON-LD structured data
      const jsonLds = [];
      document.querySelectorAll('script[type="application/ld+json"]').forEach((el) => {
        try { jsonLds.push(JSON.parse(el.textContent)); } catch {}
      });
      if (jsonLds.length > 0) return { type: "json-ld", data: jsonLds };

      // OpenGraph metadata
      const og = {};
      document.querySelectorAll('meta[property^="og:"], meta[name^="twitter:"]').forEach((m) => {
        const key = m.getAttribute("property") || m.getAttribute("name");
        og[key] = m.getAttribute("content");
      });

      // If a specific selector was requested, extract just that
      if (extractSelector) {
        const el = document.querySelector(extractSelector);
        if (el) return { type: "selector", data: el.innerText || el.textContent };
      }

      // Main content text
      const main = document.querySelector("main, article, [role='main'], #content, #main") || document.body;
      return {
        type: "page-text",
        title: document.title,
        og: Object.keys(og).length > 0 ? og : undefined,
        text: main.innerText.slice(0, 32_000),
      };
    }, options.extractSelector || null);

    let screenshotPath = null;
    if (options.captureScreenshot) {
      const date = isoDate();
      const stamp = isoNow().replace(/[:.]/g, "-");
      const outDir = path.join(os.homedir(), "notes", "sources", safeSlug(options.sourceService || "generic"), date);
      fs.mkdirSync(outDir, { recursive: true });
      screenshotPath = path.join(outDir, `${stamp}_${safeSlug(new URL(url).hostname)}_playwright.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    }
    const status = Number(nav?.status?.()) || 200;
    const artifact = writeSourceArtifact({
      service: options.sourceService || "generic",
      url,
      finalUrl: page.url(),
      method: "playwright",
      status,
      contentType: "text/html",
      attempts,
      data: extracted,
      screenshotPath,
      notes: options.notes || "",
    });

    return {
      ok: true,
      status,
      data: extracted,
      method: "playwright",
      contentType: "text/html",
      attempts,
      artifact,
    };
  } catch (err) {
    writeSourceArtifact({
      service: options.sourceService || "generic",
      url,
      method: "playwright",
      status: -1,
      attempts: Array.isArray(options.attempts) ? options.attempts : [],
      data: null,
      notes: `playwright failure: ${err.message}`,
    });
    return { ok: false, status: -1, data: null, method: "playwright-failed", contentType: "", attempts: options.attempts || [], error: err.message };
  } finally {
    await browser.close();
  }
}

// ─── API response inspector ───────────────────────────────────────────────────

/**
 * Make an API call and handle common failure modes with fallback strategies.
 * Logs what was tried and why it failed if all methods fail.
 */
async function callApiWithFallback(endpoint, options = {}) {
  const attempts = [];

  // HTTP-first path (fetch + curl)
  const res = await fetchWithFallback(endpoint, {
    ...options,
    allowBrowser: false,
    sourceService: options.sourceService || "api",
  });
  if (res.ok) return res;
  if (Array.isArray(res.attempts)) attempts.push(...res.attempts);
  else attempts.push({ method: res.method || "http", status: res.status });

  // Browser fallback if all HTTP methods failed
  if (options.browserFallbackUrl) {
    try {
      const bres = await fetchWithBrowser(options.browserFallbackUrl, {
        ...options,
        sourceService: options.sourceService || "api",
        attempts,
        captureSource: true,
        notes: "API/CLI path failed; browser fallback path used",
      });
      if (bres.ok) return bres;
      attempts.push({ method: "playwright", status: bres.status });
    } catch (err) {
      attempts.push({ method: "playwright", error: err.message });
    }
  }

  writeSourceArtifact({
    service: options.sourceService || "api",
    url: endpoint,
    finalUrl: options.browserFallbackUrl || endpoint,
    method: "all-failed",
    status: -1,
    attempts,
    data: null,
    notes: "callApiWithFallback exhausted all methods",
  });

  return {
    ok: false,
    status: -1,
    data: null,
    method: "all-failed",
    attempts,
    message: `All access methods failed for ${endpoint}: ${attempts.map((a) => `${a.method}=${a.status || a.error}`).join(", ")}`,
  };
}

// ─── Agent context injector ───────────────────────────────────────────────────

/**
 * Returns the AGENT_PRINCIPLES section to inject into any agent system prompt.
 * Agents should call this and include the result in their system prompt.
 */
function getAgentPrinciplesPrompt() {
  try {
    const principlesPath = path.join(__dirname, "..", "AGENT_PRINCIPLES.md");
    const raw = fs.readFileSync(principlesPath, "utf8");
    // Extract the core operative sections (skip amendment history)
    const sections = raw.split(/^---$/m);
    const core = sections.slice(1).join("---").split("## Amendment History")[0].trim();
    return `\n\n---\n## Core Operating Principles\n\n${core}\n---`;
  } catch {
    return `\n\n---\n## Core Operating Principles\n\nBe resourceful. Never refuse before trying. Check file headers, use CLI tools, and fall back to browser automation when direct APIs are blocked.\n---`;
  }
}

module.exports = {
  identifyFile,
  parseFile,
  fetchWithFallback,
  fetchWithBrowser,
  callApiWithFallback,
  getAgentPrinciplesPrompt,
};
