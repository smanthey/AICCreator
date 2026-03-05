"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const REPORT_DIRS = [
  path.join(ROOT, "reports"),
  path.join(ROOT, "scripts", "reports"),
];

const REPORT_DEFINITIONS = Object.freeze([
  {
    id: "global_status",
    name: "Global Red/Green Status",
    lane: "ops",
    artifactPattern: "-global-redgreen-status.json",
    refreshCommand: "npm run -s status:redgreen",
    refreshTaskType: "report_refresh",
    cadenceMinutes: 180,
    staleAfterMinutes: 180,
    staleSeverity: "yellow",
    queueRoute: "claw_tasks_infra",
    requiredTags: ["infra", "deterministic"],
  },
  {
    id: "launch_e2e",
    name: "Launch E2E Matrix",
    lane: "qa",
    artifactPattern: "-launch-e2e-matrix.json",
    refreshCommand: "npm run -s e2e:launch:matrix",
    refreshTaskType: "report_refresh",
    cadenceMinutes: 360,
    staleAfterMinutes: 360,
    staleSeverity: "red",
    queueRoute: "claw_tasks_qa",
    requiredTags: ["qa"],
  },
  {
    id: "repo_scan",
    name: "GitHub Observability Scan",
    lane: "repos",
    artifactPattern: "-github-observability-scan.json",
    refreshCommand: "npm run -s github:scan -- --limit 200 --strict-baseline",
    refreshTaskType: "report_refresh",
    cadenceMinutes: 360,
    staleAfterMinutes: 360,
    staleSeverity: "yellow",
    queueRoute: "claw_tasks_io_heavy",
    requiredTags: ["infra", "deterministic", "io_heavy"],
  },
  {
    id: "qa_human",
    name: "Human-grade QA",
    lane: "qa",
    artifactPattern: "-qa-human-grade.json",
    refreshCommand: "npm run -s qa:human",
    refreshTaskType: "report_refresh",
    cadenceMinutes: 720,
    staleAfterMinutes: 720,
    staleSeverity: "red",
    queueRoute: "claw_tasks_qa",
    requiredTags: ["qa"],
  },
  {
    id: "agent_memory",
    name: "Agent Memory Audit",
    lane: "ops",
    artifactPattern: "-agent-memory-audit.json",
    refreshCommand: "npm run -s audit:drift",
    refreshTaskType: "report_refresh",
    cadenceMinutes: 720,
    staleAfterMinutes: 720,
    staleSeverity: "yellow",
    queueRoute: "claw_tasks_infra",
    requiredTags: ["infra", "deterministic"],
  },
  {
    id: "schema_audit",
    name: "Schema Mismatch Audit",
    lane: "system",
    artifactPattern: "-schema-mismatch-audit.json",
    refreshCommand: "npm run -s schema:audit:json",
    refreshTaskType: "report_refresh",
    cadenceMinutes: 720,
    staleAfterMinutes: 720,
    staleSeverity: "yellow",
    queueRoute: "claw_tasks_infra",
    requiredTags: ["infra", "deterministic"],
  },
  {
    id: "security_sweep",
    name: "Security Sweep",
    lane: "security",
    artifactPattern: "-security-sweep.json",
    refreshCommand: "npm run -s security:sweep",
    refreshTaskType: "report_refresh",
    cadenceMinutes: 360,
    staleAfterMinutes: 360,
    staleSeverity: "red",
    queueRoute: "claw_tasks_infra",
    requiredTags: ["infra", "deterministic"],
  },
  {
    id: "saas_opportunity",
    name: "SaaS Opportunity Research",
    lane: "research",
    artifactPattern: "-saas-opportunity-research.json",
    refreshCommand: "npm run -s saas:opportunity:research",
    refreshTaskType: "report_refresh",
    cadenceMinutes: 1440,
    staleAfterMinutes: 1440,
    staleSeverity: "yellow",
    queueRoute: "claw_tasks_infra",
    requiredTags: ["infra", "deterministic"],
  },
  {
    id: "saas_pain_pipeline",
    name: "SaaS Pain Pipeline",
    lane: "research",
    artifactPattern: "-saas-pain-opportunity-report.json",
    refreshCommand: "npm run -s saas:pain:report",
    refreshTaskType: "report_refresh",
    cadenceMinutes: 1440,
    staleAfterMinutes: 1440,
    staleSeverity: "yellow",
    queueRoute: "claw_tasks_infra",
    requiredTags: ["infra", "deterministic"],
  },
  {
    id: "affiliate_research",
    name: "Affiliate Rollout Research",
    lane: "research",
    artifactPattern: "-affiliate-rollout-research.json",
    refreshCommand: "npm run -s affiliate:research",
    refreshTaskType: "report_refresh",
    cadenceMinutes: 1440,
    staleAfterMinutes: 1440,
    staleSeverity: "yellow",
    queueRoute: "claw_tasks_infra",
    requiredTags: ["infra", "deterministic"],
  },
]);

const BY_ID = new Map(REPORT_DEFINITIONS.map((r) => [r.id, r]));

function listReportDefinitions() {
  return REPORT_DEFINITIONS.slice();
}

function getReportDefinition(reportId) {
  if (!reportId) return null;
  return BY_ID.get(String(reportId)) || null;
}

function freshnessFromAge(ageMin, staleAfterMinutes) {
  // null/undefined age means no artifact/never run - treat as yellow (needs attention)
  if (ageMin === null || ageMin === undefined || ageMin === "") return "yellow";
  if (staleAfterMinutes === null || staleAfterMinutes === undefined || staleAfterMinutes === "") return "yellow";
  const age = Number(ageMin);
  const stale = Number(staleAfterMinutes);
  if (!Number.isFinite(age) || !Number.isFinite(stale)) return "yellow";
  // Age is valid - calculate freshness
  if (age > stale * 2) return "red";  // Very stale
  if (age > stale) return "yellow";   // Stale
  return "green";  // Fresh
}

function listMatchingFiles(reportDef) {
  const suffix = String(reportDef.artifactPattern || "");
  if (!suffix) return [];
  const out = [];
  for (const dir of REPORT_DIRS) {
    if (!fs.existsSync(dir)) continue;
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch (_) {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith(suffix)) continue;
      const abs = path.join(dir, name);
      let stat;
      try {
        stat = fs.statSync(abs);
      } catch (_) {
        continue;
      }
      out.push({ abs, name, dir, mtimeMs: stat.mtimeMs, mtime: stat.mtime.toISOString() });
    }
  }
  return out.sort((a, b) => a.mtimeMs - b.mtimeMs);
}

function latestArtifactForReport(reportDef) {
  const files = listMatchingFiles(reportDef);
  return files.length ? files[files.length - 1] : null;
}

module.exports = {
  REPORT_DEFINITIONS,
  listReportDefinitions,
  getReportDefinition,
  freshnessFromAge,
  latestArtifactForReport,
  REPORT_DIRS,
};
