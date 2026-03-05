#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const getArg = (flag, fallback = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};

const INPUT = getArg("--input", null);
const OUTPUT = getArg("--out", null);

function splitMbox(content) {
  const lines = content.split(/\r?\n/);
  const messages = [];
  let cur = [];

  for (const line of lines) {
    if (line.startsWith("From ") && cur.length) {
      messages.push(cur.join("\n"));
      cur = [];
      continue;
    }
    cur.push(line);
  }
  if (cur.length) messages.push(cur.join("\n"));
  return messages.filter((m) => /\nSubject:/i.test(m));
}

function main() {
  if (!INPUT || !OUTPUT) {
    throw new Error("Usage: node scripts/ip-extract-mbox.js --input /path/file.mbox --out /path/outdir");
  }

  const raw = fs.readFileSync(INPUT, "utf8");
  const messages = splitMbox(raw);
  fs.mkdirSync(OUTPUT, { recursive: true });

  let n = 0;
  for (const msg of messages) {
    n += 1;
    const file = path.join(OUTPUT, `${String(n).padStart(6, "0")}.eml`);
    fs.writeFileSync(file, msg, "utf8");
  }

  console.log(`[ip-extract-mbox] extracted=${n} -> ${OUTPUT}`);
}

try {
  main();
} catch (err) {
  console.error("Fatal:", err.message);
  process.exit(1);
}
