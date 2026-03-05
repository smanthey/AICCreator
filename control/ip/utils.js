"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const TM_SERIAL_RE = /(?:serial(?:\s+number|\s+no\.?|\s*#)?\s*[:#]?\s*)(\d{8})/ig;
const TM_SERIAL_BARE_RE = /\b(\d{8})\b/g;
const TM_REG_RE = /(?:registration(?:\s+number|\s+no\.?|\s*#)?\s*[:#]?\s*)(\d{7,8})/ig;
const PATENT_APP_RE = /\b\d{2}\/\d{3},\d{3}\b/g;
const COPYRIGHT_RE = /\b(?:TX|VA|PA|SR|RE)\s*[- ]?\d{1,10}\b/ig;

function sha256File(filePath) {
  const h = crypto.createHash("sha256");
  const buf = fs.readFileSync(filePath);
  h.update(buf);
  return h.digest("hex");
}

function detectMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if ([".md", ".txt", ".text", ".log"].includes(ext)) return "text/plain";
  if ([".html", ".htm"].includes(ext)) return "text/html";
  if (ext === ".eml") return "message/rfc822";
  if ([".jpg", ".jpeg"].includes(ext)) return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return "application/octet-stream";
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractText(filePath, maxChars = 250000) {
  const ext = path.extname(filePath).toLowerCase();
  try {
    if ([".md", ".txt", ".eml", ".csv", ".json"].includes(ext)) {
      return fs.readFileSync(filePath, "utf8").slice(0, maxChars);
    }
    if ([".html", ".htm"].includes(ext)) {
      return stripHtml(fs.readFileSync(filePath, "utf8")).slice(0, maxChars);
    }
    if (ext === ".pdf") {
      // Prefer pdftotext when available; fallback to strings.
      try {
        const out = execFileSync("pdftotext", ["-layout", "-nopgbrk", filePath, "-"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
        return String(out || "").replace(/\s+/g, " ").trim().slice(0, maxChars);
      } catch {
        const out = execFileSync("strings", ["-n", "6", filePath], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
        return String(out || "").replace(/\s+/g, " ").trim().slice(0, maxChars);
      }
    }
  } catch {
    return "";
  }
  return "";
}

function normalizeMachine(value) {
  if (!value) return "unknown";
  const v = String(value).trim().toUpperCase();
  if (v === "M1" || v === "M3") return v;
  return v;
}

function classifyDocType({ title, text, filePath }) {
  const s = `${title || ""}\n${text || ""}\n${filePath || ""}`.toLowerCase();
  if (s.includes("office action")) return "office_action";
  if (s.includes("filing receipt") || s.includes("successfully submitted") || s.includes("payment confirmation")) return "filing_receipt";
  if (s.includes("notice of allowance") || s.includes("noa")) return "notice_of_allowance";
  if (s.includes("registration certificate") || s.includes("certificate of registration")) return "registration_certificate";
  if (s.includes("specimen")) return "specimen";
  if (s.includes("teas") || s.includes("teasi")) return "teas_filing";
  if (String(filePath || "").toLowerCase().endsWith(".eml")) return "email";
  if (s.includes("invoice") || s.includes("receipt")) return "receipt";
  if (s.includes("note")) return "note";
  return "other";
}

function extractIpIdentifiers(text) {
  const out = {
    tm_serials: new Set(),
    tm_regs: new Set(),
    patent_apps: new Set(),
    copyrights: new Set(),
  };

  const body = String(text || "");

  for (const m of body.matchAll(TM_SERIAL_RE)) out.tm_serials.add(m[1]);
  for (const m of body.matchAll(TM_REG_RE)) out.tm_regs.add(m[1]);
  for (const m of body.matchAll(PATENT_APP_RE)) out.patent_apps.add(m[0]);
  for (const m of body.matchAll(COPYRIGHT_RE)) out.copyrights.add(m[0].replace(/\s+/g, ""));

  // Add bare 8-digit candidates if context hints TM/USPTO.
  if (/uspto|trademark|teas|tsdr|office action/i.test(body)) {
    for (const m of body.matchAll(TM_SERIAL_BARE_RE)) out.tm_serials.add(m[1]);
  }

  return {
    tm_serials: [...out.tm_serials],
    tm_regs: [...out.tm_regs],
    patent_apps: [...out.patent_apps],
    copyrights: [...out.copyrights],
  };
}

function extractLikelyMarkText(title, text) {
  const fromTitle = String(title || "").split(/[\-|–|—|:]/)[0].trim();
  if (fromTitle && fromTitle.length >= 2 && fromTitle.length <= 120) return fromTitle;
  const m = String(text || "").match(/mark\s*[:\-]\s*([A-Z0-9 '&_-]{2,120})/i);
  return m ? m[1].trim() : null;
}

function recursiveListFiles(root, allowedExt = null) {
  const files = [];
  function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(p);
      } else if (ent.isFile()) {
        if (!allowedExt) files.push(p);
        else if (allowedExt.has(path.extname(p).toLowerCase())) files.push(p);
      }
    }
  }
  walk(root);
  return files;
}

function toDateOnly(v) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

module.exports = {
  sha256File,
  detectMime,
  extractText,
  classifyDocType,
  extractIpIdentifiers,
  extractLikelyMarkText,
  recursiveListFiles,
  normalizeMachine,
  toDateOnly,
};
