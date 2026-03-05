#!/usr/bin/env node

/**
 * Simple generator for memory/ and skills/ TypeScript symbols.
 *
 * Usage:
 *   node scripts/generate-memory-skill.js path/to/spec.json
 *
 * Spec shape:
 *   {
 *     "kind": "memory",
 *     "domain": "stripe",
 *     "type": "pattern",
 *     "name": "webhook_idempotency",
 *     "summary": "...",
 *     "invariants": [...],
 *     "failure_modes": [...],
 *     "tags": [...]
 *   }
 *
 *   or
 *
 *   {
 *     "kind": "skill",
 *     "name": "landmine_sweep",
 *     "category": "landmine_sweep",
 *     "objective": "...",
 *     "search_patterns": [
 *       { "label": "...", "query": "execSync(", "file_pattern": "scripts/*.js" }
 *     ],
 *     "action": { "kind": "create_refactor_task", "payload_schema": { ... } },
 *     "tags": [...]
 *   }
 */

const fs = require("fs");
const path = require("path");

function usage() {
  console.error("Usage: node scripts/generate-memory-skill.js path/to/spec.json");
  process.exit(1);
}

function slugify(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function nowIso() {
  return new Date().toISOString();
}

function generateMemory(spec, repoRoot) {
  const required = ["domain", "type", "name", "summary", "invariants"];
  for (const key of required) {
    if (!spec[key]) {
      throw new Error(`Missing required memory field: ${key}`);
    }
  }

  const slug = slugify(spec.name);
  const targetDir = path.join(repoRoot, "memory", "patterns");
  ensureDir(targetDir);
  const targetFile = path.join(targetDir, `${slug}.ts`);

  const invariants = JSON.stringify(spec.invariants, null, 2);
  const failureModes = spec.failure_modes
    ? `\n  failure_modes: ${JSON.stringify(spec.failure_modes, null, 2)},`
    : "";
  const tags = spec.tags ? `\n  tags: ${JSON.stringify(spec.tags, null, 2)},` : "";

  const content = `import { defineMemory } from "../_schema";

export const memory = defineMemory({
  domain: ${JSON.stringify(spec.domain)},
  type: ${JSON.stringify(spec.type)},
  name: ${JSON.stringify(spec.name)},
  summary: ${JSON.stringify(spec.summary)},
  invariants: ${invariants},${failureModes}
  version: "1.0.0",
  last_verified: ${JSON.stringify(nowIso())},${tags}
});
`;

  fs.writeFileSync(targetFile, content, "utf8");
  console.log(`Wrote memory symbol: ${path.relative(repoRoot, targetFile)}`);
}

function generateSkill(spec, repoRoot) {
  const required = ["name", "category", "objective", "search_patterns", "action"];
  for (const key of required) {
    if (!spec[key]) {
      throw new Error(`Missing required skill field: ${key}`);
    }
  }

  const slug = slugify(spec.name);
  const targetDir = path.join(repoRoot, "skills");
  ensureDir(targetDir);
  const targetFile = path.join(targetDir, `${slug}.ts`);

  const searchPatterns = JSON.stringify(spec.search_patterns, null, 2);
  const action = JSON.stringify(spec.action, null, 2);
  const tags = spec.tags ? `\n  tags: ${JSON.stringify(spec.tags, null, 2)},` : "";

  const content = `import { defineSkill } from "./_schema";

export const skill = defineSkill({
  name: ${JSON.stringify(spec.name)},
  category: ${JSON.stringify(spec.category)},
  objective: ${JSON.stringify(spec.objective)},
  search_patterns: ${searchPatterns},
  action: ${action},
  version: "1.0.0",
  last_verified: ${JSON.stringify(nowIso())},${tags}
});
`;

  fs.writeFileSync(targetFile, content, "utf8");
  console.log(`Wrote skill symbol: ${path.relative(repoRoot, targetFile)}`);
}

function main() {
  const [specPath] = process.argv.slice(2);
  if (!specPath) usage();

  const repoRoot = path.resolve(__dirname, "..");
  const spec = readJson(path.resolve(specPath));

  if (spec.kind === "memory") {
    generateMemory(spec, repoRoot);
  } else if (spec.kind === "skill") {
    generateSkill(spec, repoRoot);
  } else {
    throw new Error(`Unknown kind: ${spec.kind} (expected "memory" or "skill")`);
  }
}

if (require.main === module) {
  main();
}

