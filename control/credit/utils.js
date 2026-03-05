"use strict";

const fs = require("fs");
const crypto = require("crypto");

function toIsoDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function clamp01(v) {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return 0;
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

function parseMoney(v) {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function fileSha256(filePath) {
  const raw = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function textSha256(text) {
  return crypto.createHash("sha256").update(String(text || "")).digest("hex");
}

function normalizeArray(v) {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

module.exports = {
  toIsoDate,
  clamp01,
  parseMoney,
  readJsonFile,
  fileSha256,
  textSha256,
  normalizeArray,
};
