#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const DIR = path.join(ROOT, "artifacts", "self-awareness");
const QUEUE = path.join(DIR, "self-mod-queue.json");
const HISTORY = path.join(DIR, "self-mod-history.json");

function arg(flag, fallback = null) {
  const args = process.argv.slice(2);
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
}

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}

function writeJson(p, v) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2));
}

function normalize(s) {
  return String(s || "").trim();
}

const title = normalize(arg("--title", ""));
const request = normalize(arg("--request", ""));
const priority = normalize(arg("--priority", "high")) || "high";

if (!title || !request) {
  console.error("usage: npm run self:mod:request -- --title \"...\" --request \"...\" [--priority high|medium|low]");
  process.exit(1);
}

const queue = readJson(QUEUE, []);
const id = `smr_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
const item = {
  id,
  title,
  request,
  priority,
  status: "queued",
  created_at: new Date().toISOString(),
  created_by: process.env.USER || process.env.USERNAME || "unknown",
  branch: null,
  pr_url: null,
  notes: [],
};
queue.push(item);
writeJson(QUEUE, queue);

const hist = readJson(HISTORY, []);
hist.push({ at: new Date().toISOString(), event: "queued", id, title, priority });
writeJson(HISTORY, hist);

console.log("=== Self Mod Request Queued ===");
console.log(`id: ${id}`);
console.log(`title: ${title}`);
console.log(`priority: ${priority}`);
console.log(`queue_file: ${QUEUE}`);
