#!/usr/bin/env node
"use strict";

/**
 * Requirement expansion pipeline pass: expansion (stub/LLM) -> DoD validation -> gap finder -> multi-pass review.
 * Strict gate: reads SQLite memory first; refuses blueprint output unless all required build sections are filled.
 * Usage:
 *   node scripts/requirement-expansion-pass.js
 *   node scripts/requirement-expansion-pass.js --artifact path/to/artifact.json
 *   node scripts/requirement-expansion-pass.js --goal "Add user avatars" --app-type saas
 *   node scripts/requirement-expansion-pass.js --project-id default --strict-gate  (refuse output if memory incomplete)
 */

const path = require("path");
const fs = require("fs");
const {
  runProofPass,
  validateDefinitionOfDone,
  checkContextExpansionComplete,
} = require("../config/requirement-expansion-schema");
let memory;
try {
  memory = require("../control/requirement-expansion-memory");
} catch (e) {
  memory = null;
}

const ROOT = path.join(__dirname, "..");
const REPORTS_DIR = path.join(ROOT, "reports");

function getArg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  if (i < 0 || i + 1 >= process.argv.length) return fallback;
  return process.argv[i + 1];
}

function hasArg(flag) {
  return process.argv.includes(flag);
}

/**
 * Stub expansion: turn short goal into minimal artifact with required DoD sections (placeholder if missing).
 * In InayanBuilderBot this can be replaced by an LLM or full expansion stage.
 */
function expandGoalToArtifact(goal, appType = "default") {
  const empty = (v) => v === undefined || v === null || (Array.isArray(v) && v.length === 0) || (typeof v === "string" && !v.trim());
  return {
    goal: goal || "Unspecified goal",
    appType: appType || "default",
    apiContracts: [],
    dbMigrations: [],
    backgroundJobs: [],
    featureFlows: [],
    failureModes: [],
    testPlan: [],
    rolloutPlan: "",
    rollbackPlan: "",
    inferredScope: [],
  };
}

function main() {
  const artifactPath = getArg("--artifact");
  const goal = getArg("--goal");
  const appType = getArg("--app-type", "default");
  const projectId = getArg("--project-id", "default");
  const strictGate = hasArg("--strict-gate");
  const outPath = getArg("--out") || path.join(REPORTS_DIR, "requirement-expansion-proof-latest.json");

  let artifact;
  if (artifactPath) {
    try {
      const raw = fs.readFileSync(path.resolve(artifactPath), "utf8");
      artifact = JSON.parse(raw);
    } catch (e) {
      console.error("[requirement-expansion-pass] Failed to read artifact:", e.message);
      process.exit(2);
    }
  } else {
    artifact = expandGoalToArtifact(goal, appType);
  }

  // Persist to SQLite memory so the gate can read it (skip if better-sqlite3 not installed)
  if (memory) {
    try {
      memory.set(projectId, artifact);
    } catch (e) {
      console.warn("[requirement-expansion-pass] SQLite memory write skipped:", e.message);
    }
  }

  // Strict context expansion completeness gate: when --strict-gate, read SQLite memory first and refuse if incomplete
  if (strictGate && memory) {
    const gate = checkContextExpansionComplete(projectId, { memory });
    if (!gate.allowed) {
      console.error("[requirement-expansion-pass] BLOCKED: context expansion completeness gate failed (read SQLite memory first). All required build sections must be filled before blueprint output.");
      console.error("[requirement-expansion-pass] missingCritical:", gate.missingCritical);
      console.error("[requirement-expansion-pass] repairsSuggested:", gate.repairsSuggested);
      process.exit(3);
    }
  }

  const proof = runProofPass(artifact, {
    appType: artifact.appType || appType,
    prompt: goal || artifact.goal,
    expansion: artifact,
  });

  const output = {
    generated_at: new Date().toISOString(),
    goal: goal || artifact.goal,
    appType: artifact.appType || appType,
    proof: {
      ok: proof.ok,
      missingCritical: proof.missingCritical,
      missingImportant: proof.missingImportant,
      assumptionRiskScore: proof.assumptionRiskScore,
      qualityScore: proof.qualityScore,
      completenessScore: proof.completenessScore,
      repairsSuggested: proof.repairsSuggested,
      followUpQuestions: proof.followUpQuestions,
      accepted: proof.accepted,
      sectionScores: proof.sectionScores,
      passResults: proof.passResults,
    },
    artifact_keys: Object.keys(artifact),
  };

  // Refuse to write blueprint/proof file unless gate would pass (all required sections filled)
  const dod = validateDefinitionOfDone(artifact);
  if (!dod.ok) {
    console.error("[requirement-expansion-pass] BLOCKED: refusing blueprint output — required build sections missing:", dod.missingCritical);
    console.log(JSON.stringify(output, null, 2));
    process.exit(3);
  }

  if (outPath) {
    try {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify(output, null, 2), "utf8");
      console.log("[requirement-expansion-pass] Wrote", outPath);
    } catch (e) {
      console.error("[requirement-expansion-pass] Write failed:", e.message);
    }
  }

  console.log(JSON.stringify(output, null, 2));
  process.exit(proof.ok ? 0 : 1);
}

main();
