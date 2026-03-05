"use strict";

/**
 * Requirement expansion pipeline — schema and hard validators.
 * Used by InayanBuilderBot (and claw-architect) for pre-blueprint expansion, DoD contract, gap finder, multi-pass review.
 * @module config/requirement-expansion-schema
 */

const REQUIRED_DOD_SECTIONS = [
  "apiContracts",
  "dbMigrations",
  "backgroundJobs",
  "featureFlows",
  "failureModes",
  "testPlan",
  "rolloutPlan",
  "rollbackPlan",
];

const DOD_SECTION_KEYS = {
  apiContracts: "apiContracts",
  dbMigrations: "dbMigrations",
  backgroundJobs: "backgroundJobs",
  featureFlows: "featureFlows",
  failureModes: "failureModes",
  testPlan: "testPlan",
  rolloutPlan: "rolloutPlan",
  rollbackPlan: "rollbackPlan",
};

/** Weighted checklist per app type: section -> weight (0-1, 1 = critical). */
const CHECKLIST_WEIGHTS = {
  saas: {
    apiContracts: 1,
    dbMigrations: 1,
    backgroundJobs: 0.8,
    featureFlows: 1,
    failureModes: 1,
    testPlan: 1,
    rolloutPlan: 0.9,
    rollbackPlan: 1,
    auth: 1,
    billing: 0.9,
    observability: 0.7,
  },
  marketplace: {
    apiContracts: 1,
    dbMigrations: 1,
    backgroundJobs: 0.9,
    featureFlows: 1,
    failureModes: 1,
    testPlan: 1,
    rolloutPlan: 0.9,
    rollbackPlan: 1,
    auth: 1,
    payments: 1,
    abuse: 0.9,
  },
  chatbot: {
    apiContracts: 0.9,
    dbMigrations: 0.7,
    backgroundJobs: 0.6,
    featureFlows: 1,
    failureModes: 1,
    testPlan: 0.9,
    rolloutPlan: 0.8,
    rollbackPlan: 0.9,
    auth: 0.8,
    rateLimit: 0.9,
  },
  api_only: {
    apiContracts: 1,
    dbMigrations: 0.8,
    backgroundJobs: 0.7,
    featureFlows: 0.8,
    failureModes: 1,
    testPlan: 0.9,
    rolloutPlan: 0.8,
    rollbackPlan: 0.9,
  },
  default: {
    apiContracts: 1,
    dbMigrations: 1,
    backgroundJobs: 0.8,
    featureFlows: 1,
    failureModes: 1,
    testPlan: 1,
    rolloutPlan: 0.9,
    rollbackPlan: 1,
  },
};

const REVIEW_PASSES = [
  { id: "feasibility", name: "Feasibility", description: "Can we build this with stated stack/constraints?" },
  { id: "dependencies", name: "Dependency completeness", description: "Are all dependencies and orderings captured?" },
  { id: "edge_cases", name: "Edge cases / failure paths", description: "Are failure modes and rollback covered?" },
  { id: "cost_time", name: "Cost/time realism", description: "Are estimates and scope realistic?" },
];

const QUALITY_THRESHOLD = 0.6;

/**
 * Hard validator: Definition-of-Done contract. If any required section missing -> fail.
 * @param {object} artifact - Expansion/blueprint artifact (must have required section keys).
 * @returns {{ ok: boolean, missingCritical: string[], missingImportant: string[], repairsSuggested: string[] }}
 */
function validateDefinitionOfDone(artifact) {
  const missingCritical = [];
  const missingImportant = [];
  const repairsSuggested = [];

  for (const key of REQUIRED_DOD_SECTIONS) {
    const val = artifact && artifact[key];
    const missing = val === undefined || val === null || (Array.isArray(val) && val.length === 0) || (typeof val === "string" && !val.trim());
    if (missing) {
      missingCritical.push(key);
      repairsSuggested.push(`Add or populate "${key}" (required). Use TBD + assumptionRiskScore if unknown.`);
    }
  }

  return {
    ok: missingCritical.length === 0,
    missingCritical,
    missingImportant,
    repairsSuggested,
  };
}

/**
 * Gap finder: score artifact against weighted checklist for app type; emit missingCritical, missingImportant.
 * @param {object} artifact - Expansion/blueprint artifact.
 * @param {string} appType - One of: saas, marketplace, chatbot, api_only, default.
 * @returns {{ missingCritical: string[], missingImportant: string[], completenessScore: number, sectionScores: object }}
 */
function gapFinder(artifact, appType = "default") {
  const weights = CHECKLIST_WEIGHTS[appType] || CHECKLIST_WEIGHTS.default;
  const sectionScores = {};
  let totalWeight = 0;
  let weightedSum = 0;

  const missingCritical = [];
  const missingImportant = [];

  for (const [section, weight] of Object.entries(weights)) {
    totalWeight += weight;
    const val = artifact && artifact[section];
    const present = val !== undefined && val !== null && (Array.isArray(val) ? val.length > 0 : (typeof val !== "string" || val.trim().length > 0));
    const score = present ? 1 : 0;
    sectionScores[section] = score;
    weightedSum += score * weight;
    if (!present) {
      if (weight >= 0.9) missingCritical.push(section);
      else if (weight >= 0.6) missingImportant.push(section);
    }
  }

  const completenessScore = totalWeight > 0 ? weightedSum / totalWeight : 0;

  return {
    missingCritical,
    missingImportant,
    completenessScore,
    sectionScores,
  };
}

/**
 * Multi-pass self-review (stub: returns structure; real implementation can call LLM or rules).
 * @param {object} artifact - Expansion/blueprint artifact.
 * @returns {{ accepted: boolean, passResults: object[], qualityScore: number }}
 */
function runMultiPassReview(artifact) {
  const passResults = REVIEW_PASSES.map((p) => ({
    id: p.id,
    name: p.name,
    pass: true,
    issues: [],
  }));

  const feasibilityOk = artifact && (artifact.featureFlows?.length || artifact.apiContracts?.length);
  if (!feasibilityOk) {
    passResults[0].pass = false;
    passResults[0].issues.push("No featureFlows or apiContracts to assess feasibility.");
  }

  const hasRollback = artifact && artifact.rollbackPlan && (typeof artifact.rollbackPlan === "string" ? artifact.rollbackPlan.trim() : true);
  if (!hasRollback) {
    const idx = passResults.findIndex((r) => r.id === "edge_cases");
    if (idx >= 0) {
      passResults[idx].pass = false;
      passResults[idx].issues.push("rollbackPlan missing or empty.");
    }
  }

  const passed = passResults.filter((r) => r.pass).length;
  const qualityScore = passResults.length > 0 ? passed / passResults.length : 0;
  const accepted = qualityScore >= QUALITY_THRESHOLD;

  return {
    accepted,
    passResults,
    qualityScore,
  };
}

/**
 * Assumption resolver: from sparse prompt + expansion, return assumptions and risk score.
 * @param {string} prompt - Original user goal/prompt.
 * @param {object} expansion - Expansion output (inferredScope, etc.).
 * @returns {{ assumptions: object[], assumptionRiskScore: number, followUpQuestions: string[] }}
 */
function assumptionResolver(prompt, expansion) {
  const assumptions = [];
  let assumptionRiskScore = 0;
  const followUpQuestions = [];

  if (!prompt || (typeof prompt === "string" && prompt.trim().length < 20)) {
    assumptions.push({ key: "scope", value: "Full scope inferred from short goal", risk: "high" });
    assumptionRiskScore = Math.max(assumptionRiskScore, 0.8);
    followUpQuestions.push("What are the top 3 must-have flows or APIs?");
  }

  const scope = expansion && expansion.inferredScope;
  if (Array.isArray(scope)) {
    const lowConfidence = scope.filter((s) => (s.confidence ?? 1) < 0.6);
    if (lowConfidence.length > 0) {
      assumptionRiskScore = Math.max(assumptionRiskScore, 0.5);
      followUpQuestions.push(`${lowConfidence.length} inferred items have confidence < 0.6. Confirm or correct?`);
    }
  }

  assumptionRiskScore = Math.min(1, assumptionRiskScore);

  return {
    assumptions,
    assumptionRiskScore,
    followUpQuestions,
  };
}

/**
 * Run full proof pass: DoD validation -> gap finder -> multi-pass review -> assumption resolver.
 * Returns metrics for UI proof panel.
 * @param {object} artifact - Expansion/blueprint artifact.
 * @param {{ appType?: string, prompt?: string, expansion?: object }} options
 * @returns {{ ok: boolean, missingCritical: string[], missingImportant: string[], assumptionRiskScore: number, qualityScore: number, completenessScore: number, repairsSuggested: string[], followUpQuestions: string[], accepted: boolean }}
 */
function runProofPass(artifact, options = {}) {
  const appType = options.appType || "default";
  const dod = validateDefinitionOfDone(artifact);
  const gap = gapFinder(artifact, appType);
  const review = runMultiPassReview(artifact);
  const assumption = assumptionResolver(options.prompt || "", options.expansion || artifact);

  const missingCritical = [...new Set([...dod.missingCritical, ...gap.missingCritical])];
  const missingImportant = [...new Set([...dod.missingImportant, ...gap.missingImportant])];
  const ok = missingCritical.length === 0 && review.accepted;

  return {
    ok,
    missingCritical,
    missingImportant,
    assumptionRiskScore: assumption.assumptionRiskScore,
    qualityScore: review.qualityScore,
    completenessScore: gap.completenessScore,
    repairsSuggested: dod.repairsSuggested || [],
    followUpQuestions: assumption.followUpQuestions || [],
    accepted: review.accepted,
    sectionScores: gap.sectionScores,
    passResults: review.passResults,
  };
}

/**
 * Strict context expansion completeness gate: read artifact from SQLite memory first; refuse blueprint unless all required build sections are filled.
 * Use before emitting or writing any blueprint output. Throws if not complete (caller should not write blueprint).
 * @param {string} projectId - Project key (e.g. "default"); artifact is read from SQLite for this project.
 * @param {{ dbPath?: string, memory?: { get: (id: string) => object|null } }} options - Optional dbPath; or inject memory adapter for tests.
 * @returns {{ allowed: true, artifact: object }} When complete.
 * @throws {{ allowed: false, missingCritical: string[], repairsSuggested: string[], artifact: object|null }} When not complete (throw this object so caller can catch and refuse).
 */
function contextExpansionCompletenessGate(projectId, options = {}) {
  const memory = options.memory || require("../control/requirement-expansion-memory");
  const artifact = memory.get(projectId || "default", { dbPath: options.dbPath });
  const dod = validateDefinitionOfDone(artifact);
  if (dod.ok) {
    return { allowed: true, artifact: artifact || {} };
  }
  const err = new Error("CONTEXT_EXPANSION_INCOMPLETE");
  err.allowed = false;
  err.missingCritical = dod.missingCritical;
  err.repairsSuggested = dod.repairsSuggested;
  err.artifact = artifact;
  throw err;
}

/**
 * Same as contextExpansionCompletenessGate but returns a result object instead of throwing when incomplete.
 * @returns {{ allowed: boolean, artifact: object|null, missingCritical: string[], repairsSuggested: string[] }}
 */
function checkContextExpansionComplete(projectId, options = {}) {
  const memory = options.memory || require("../control/requirement-expansion-memory");
  const artifact = memory.get(projectId || "default", { dbPath: options.dbPath });
  const dod = validateDefinitionOfDone(artifact);
  return {
    allowed: dod.ok,
    artifact: artifact || null,
    missingCritical: dod.missingCritical || [],
    repairsSuggested: dod.repairsSuggested || [],
  };
}

module.exports = {
  REQUIRED_DOD_SECTIONS,
  DOD_SECTION_KEYS,
  CHECKLIST_WEIGHTS,
  REVIEW_PASSES,
  QUALITY_THRESHOLD,
  validateDefinitionOfDone,
  gapFinder,
  runMultiPassReview,
  assumptionResolver,
  runProofPass,
  contextExpansionCompletenessGate,
  checkContextExpansionComplete,
};
