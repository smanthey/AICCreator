#!/usr/bin/env node

/**
 * Generate a symbol-indexable TypeScript index of all Markdown docs.
 *
 * This does NOT inline markdown content. It creates lightweight DocSymbol entries:
 *   - path (relative to repo root)
 *   - title (first markdown heading or filename)
 *   - tags (derived from directory segments)
 *
 * jCodeMunch can then treat these DocSymbols as code symbols for cheap lookup.
 *
 * Usage:
 *   node scripts/generate-doc-symbol-index.js
 */

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");

function listMarkdownFiles(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".cursor") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listMarkdownFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(full);
    }
  }
  return results;
}

function extractTitle(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) {
      return trimmed.replace(/^#+\s*/, "").trim();
    }
    // Fallback: first non-empty line
    return trimmed;
  }
  return path.basename(filePath);
}

function deriveTags(relPath) {
  const segments = relPath.split(path.sep);
  const tags = [];
  if (segments[0]) {
    tags.push(segments[0]); // top-level directory (docs, reports, agent-state, etc.)
  }
  if (segments[1]) {
    tags.push(segments[1]);
  }
  return tags;
}

function main() {
  const mdFiles = listMarkdownFiles(repoRoot);
  const docs = mdFiles.map((absPath) => {
    const rel = path.relative(repoRoot, absPath);
    return {
      path: rel,
      title: extractTitle(absPath),
      tags: deriveTags(rel),
    };
  });

  const targetDir = path.join(repoRoot, "memory");
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  const targetFile = path.join(targetDir, "docs-index.ts");

  const header = `export interface DocSymbol {
  path: string;
  title: string;
  tags: string[];
}

export const docs: DocSymbol[] = [
`;

  const body = docs
    .map(
      (d) =>
        `  {\n    path: ${JSON.stringify(d.path)},\n    title: ${JSON.stringify(
          d.title
        )},\n    tags: ${JSON.stringify(d.tags)},\n  }`
    )
    .join(",\n");

  const footer = "\n];\n";

  fs.writeFileSync(targetFile, header + body + footer, "utf8");
  console.log(`Wrote docs index with ${docs.length} entries to ${path.relative(repoRoot, targetFile)}`);
}

if (require.main === module) {
  main();
}

