import fs from "fs";
import path from "path";

import { memory as missingAwaitCoordinator } from "../memory/bug-classes/missing-await-coordinator";
import { memory as unguardedToFixed } from "../memory/bug-classes/unguarded-tofixed";
import { memory as execSyncBlocking } from "../memory/bug-classes/execsync-blocking";
import { memory as cronRestartMisclassification } from "../memory/bug-classes/cron-restart-misclassification";
import { memory as uuidGenerationRule } from "../memory/operational-rules/uuid-generation";
import type { MemoryObject } from "../memory/_schema";

interface BugClass extends MemoryObject {
  detection_patterns?: string[];
  detection_query?: {
    type: string;
    pattern: string;
    file_pattern?: string;
  };
}

interface Violation {
  bugName: string;
  file: string;
  line: number;
  pattern: string;
}

const BUG_CLASSES: BugClass[] = [
  missingAwaitCoordinator,
  unguardedToFixed,
  execSyncBlocking,
  cronRestartMisclassification,
  uuidGenerationRule,
];

const REPO_ROOT = path.resolve(__dirname, "..");

const DEFAULT_IGNORE_DIRS = new Set([".git", "node_modules", ".cursor", ".vscode", "dist", "build"]);

function matchesFilePattern(relPath: string, filePattern?: string): boolean {
  if (!filePattern) return true;
  // Very small glob: support "dir/*.js" style only
  if (filePattern.endsWith("*.js")) {
    const dir = filePattern.slice(0, -"*".length - ".js".length);
    return relPath.startsWith(dir) && relPath.endsWith(".js");
  }
  if (filePattern.endsWith("*.ts")) {
    const dir = filePattern.slice(0, -"*".length - ".ts".length);
    return relPath.startsWith(dir) && relPath.endsWith(".ts");
  }
  // Fallback: substring match on path
  return relPath.includes(filePattern.replace("*", ""));
}

function listCodeFiles(root: string): string[] {
  const results: string[] = [];
  function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (DEFAULT_IGNORE_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (
        entry.isFile() &&
        (entry.name.endsWith(".js") ||
          entry.name.endsWith(".ts") ||
          entry.name.endsWith(".jsx") ||
          entry.name.endsWith(".tsx"))
      ) {
        results.push(full);
      }
    }
  }
  walk(root);
  return results;
}

function scanFileForPatterns(
  absPath: string,
  relPath: string,
  patterns: string[],
  filePattern?: string
): Violation[] {
  if (!matchesFilePattern(relPath, filePattern)) return [];
  const text = fs.readFileSync(absPath, "utf8");
  const lines = text.split(/\r?\n/);
  const violations: Violation[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pattern of patterns) {
      if (line.includes(pattern)) {
        violations.push({
          bugName: "",
          file: relPath,
          line: i + 1,
          pattern,
        });
      }
    }
  }
  return violations;
}

function main() {
  const allFiles = listCodeFiles(REPO_ROOT);

  const report: Record<
    string,
    {
      domain: string;
      type: string;
      severity?: string;
      invariants: string[];
      violations: Violation[];
    }
  > = {};

  for (const bug of BUG_CLASSES) {
    const patterns =
      bug.detection_patterns && bug.detection_patterns.length > 0
        ? bug.detection_patterns
        : bug.unsafe_pattern
        ? [bug.unsafe_pattern]
        : [];

    const filePattern = bug.detection_query?.file_pattern;

    const bugKey = bug.name;
    report[bugKey] = {
      domain: bug.domain,
      type: bug.type,
      severity: bug.severity,
      invariants: bug.invariants,
      violations: [],
    };

    if (patterns.length === 0) continue;

    for (const absPath of allFiles) {
      const relPath = path.relative(REPO_ROOT, absPath);
      const matches = scanFileForPatterns(absPath, relPath, patterns, filePattern);
      for (const v of matches) {
        v.bugName = bug.name;
        report[bugKey].violations.push(v);
      }
    }
  }

  // Print a concise human-readable summary plus JSON for machines.
  for (const [name, data] of Object.entries(report)) {
    const count = data.violations.length;
    // Only print bug classes that have at least one violation.
    if (!count) continue;
    // eslint-disable-next-line no-console
    console.log(`\n=== ${name} (${data.domain}/${data.type}) — ${count} potential violation(s) ===`);
    for (const v of data.violations) {
      // eslint-disable-next-line no-console
      console.log(`- ${v.file}:${v.line} contains "${v.pattern}"`);
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    "\nJSON_REPORT_START\n" + JSON.stringify(report, null, 2) + "\nJSON_REPORT_END\n"
  );
}

if (require.main === module) {
  main();
}

