#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const Ajv = require("ajv");

const ROOT = process.cwd();
const SCHEMA_PATH = path.join(ROOT, "schemas", "module-manifest.schema.json");
const ENV_PATH = path.join(ROOT, ".env");

const SCAN_DIRS = ["packages", "apps"];
const MANIFEST_NAMES = [
  "manifest.json",
  "manifest.yaml",
  "manifest.yml",
  "blueprint.manifest.json",
  "blueprint.manifest.yaml",
  "blueprint.manifest.yml",
];

function exists(p) {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function parseEnvKeys(envPath) {
  if (!exists(envPath)) return new Set();
  const txt = fs.readFileSync(envPath, "utf8");
  const keys = new Set();
  for (const line of txt.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    keys.add(trimmed.slice(0, idx).trim());
  }
  return keys;
}

function parseManifest(filePath) {
  const txt = fs.readFileSync(filePath, "utf8");
  if (filePath.endsWith(".json")) return JSON.parse(txt);
  return yaml.load(txt);
}

function walk(dir, onFile) {
  if (!exists(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      walk(full, onFile);
      continue;
    }
    onFile(full);
  }
}

function findManifestFiles() {
  const found = [];
  for (const rel of SCAN_DIRS) {
    const base = path.join(ROOT, rel);
    walk(base, (full) => {
      if (MANIFEST_NAMES.includes(path.basename(full))) {
        found.push(full);
      }
    });
  }
  return found;
}

function rel(p) {
  return path.relative(ROOT, p) || ".";
}

function main() {
  if (!exists(SCHEMA_PATH)) {
    console.error(`[claw-scan] missing schema: ${SCHEMA_PATH}`);
    process.exit(2);
  }

  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
  const ajv = new Ajv({ allErrors: true, jsonPointers: true });
  const validate = ajv.compile(schema);
  const envKeys = parseEnvKeys(ENV_PATH);
  const manifests = findManifestFiles();

  const report = {
    root: ROOT,
    scanned_at: new Date().toISOString(),
    manifests_found: manifests.length,
    ok: 0,
    warnings: [],
    errors: [],
  };

  if (manifests.length === 0) {
    report.warnings.push("No module manifests found under /packages or /apps.");
  }

  for (const manifestPath of manifests) {
    const moduleDir = path.dirname(manifestPath);
    const display = rel(manifestPath);
    let manifest;

    try {
      manifest = parseManifest(manifestPath);
    } catch (err) {
      report.errors.push(`${display}: parse error: ${err.message}`);
      continue;
    }

    const valid = validate(manifest);
    if (!valid) {
      for (const e of validate.errors || []) {
        report.errors.push(`${display}: schema ${e.instancePath || "/"} ${e.message}`);
      }
      continue;
    }

    const requiredSidecars = ["env.schema.json", "runbook.md", "decision.md"];
    for (const sidecar of requiredSidecars) {
      const sidecarPath = path.join(moduleDir, sidecar);
      if (!exists(sidecarPath)) {
        report.errors.push(`${display}: missing required sidecar ${rel(sidecarPath)}`);
      }
    }

    for (const key of manifest.installs.env || []) {
      if (!envKeys.has(key)) {
        report.warnings.push(`${display}: .env missing key ${key}`);
      }
    }

    const packs = manifest.installs.playwright_packs || [];
    for (const pack of packs) {
      const yamlPath = path.join(ROOT, "tests", "playwright", "packs", `${pack}.yaml`);
      const ymlPath = path.join(ROOT, "tests", "playwright", "packs", `${pack}.yml`);
      if (!exists(yamlPath) && !exists(ymlPath)) {
        report.errors.push(`${display}: missing playwright pack tests/playwright/packs/${pack}.yaml`);
      }
    }

    report.ok += 1;
  }

  const hasErrors = report.errors.length > 0;
  const summary = [
    `[claw-scan] manifests=${report.manifests_found}`,
    `[claw-scan] ok=${report.ok}`,
    `[claw-scan] warnings=${report.warnings.length}`,
    `[claw-scan] errors=${report.errors.length}`,
  ].join(" ");
  console.log(summary);

  if (report.warnings.length) {
    console.log("\nWarnings:");
    for (const w of report.warnings) console.log(` - ${w}`);
  }
  if (report.errors.length) {
    console.log("\nErrors:");
    for (const e of report.errors) console.log(` - ${e}`);
  }

  process.exit(hasErrors ? 1 : 0);
}

main();
