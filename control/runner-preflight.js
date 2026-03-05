"use strict";

const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");

function runSyntaxChecks(targets = []) {
  const out = [];
  for (const rel of targets) {
    const res = spawnSync("node", ["--check", rel], {
      cwd: ROOT,
      env: { ...process.env, CI: "1" },
      encoding: "utf8",
      timeout: 30_000,
    });
    out.push({
      file: rel,
      ok: Number(res.status || 0) === 0,
      code: Number(res.status || 0),
      stderr_tail: String(res.stderr || "").slice(-400),
    });
  }
  return out;
}

function findMergeConflictMarkers() {
  const conflict = spawnSync(
    "bash",
    [
      "-lc",
      "rg -n \"^(<<<<<<<\\s+.+|=======\\s*$|>>>>>>>\\s+.+)$\" --glob '!scripts/reports/**' --glob '!reports/**' --glob '!.git/**' .",
    ],
    {
      cwd: ROOT,
      env: { ...process.env, CI: "1" },
      encoding: "utf8",
      timeout: 30_000,
    }
  );
  return String(conflict.stdout || "")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function runRunnerPreflight(options = {}) {
  const syntaxTargets = Array.isArray(options.syntaxTargets) ? options.syntaxTargets : [];
  const syntax = runSyntaxChecks(syntaxTargets);
  const markers = findMergeConflictMarkers();
  const ok = syntax.every((x) => x.ok) && markers.length === 0;
  return {
    ok,
    syntax,
    merge_conflict_markers: {
      ok: markers.length === 0,
      count: markers.length,
      examples: markers.slice(0, 20),
    },
  };
}

module.exports = {
  runRunnerPreflight,
};
