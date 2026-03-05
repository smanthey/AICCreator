"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const {
  validateDefinitionOfDone,
  gapFinder,
  runMultiPassReview,
  assumptionResolver,
  runProofPass,
  contextExpansionCompletenessGate,
  checkContextExpansionComplete,
  REQUIRED_DOD_SECTIONS,
  QUALITY_THRESHOLD,
} = require("../config/requirement-expansion-schema");

describe("validateDefinitionOfDone", () => {
  it("returns ok when all required sections present and non-empty", () => {
    const artifact = {};
    REQUIRED_DOD_SECTIONS.forEach((key) => {
      artifact[key] = key.includes("Plan") && !key.includes("test") ? "some plan" : ["item"];
    });
    const r = validateDefinitionOfDone(artifact);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.missingCritical.length, 0);
  });

  it("returns missingCritical when a required section is missing", () => {
    const artifact = { apiContracts: [], dbMigrations: [], featureFlows: [], failureModes: [], testPlan: [], rolloutPlan: "x", rollbackPlan: "x" };
    const r = validateDefinitionOfDone(artifact);
    assert.strictEqual(r.ok, false);
    assert.ok(r.missingCritical.includes("backgroundJobs"));
    assert.ok(r.repairsSuggested.length > 0);
  });

  it("treats empty string rolloutPlan as missing", () => {
    const artifact = {};
    REQUIRED_DOD_SECTIONS.forEach((key) => {
      artifact[key] = key === "rolloutPlan" || key === "rollbackPlan" ? "" : ["x"];
    });
    const r = validateDefinitionOfDone(artifact);
    assert.strictEqual(r.ok, false);
    assert.ok(r.missingCritical.includes("rolloutPlan"));
  });
});

describe("gapFinder", () => {
  it("returns completenessScore 1 when all weighted sections present", () => {
    const artifact = {
      apiContracts: [{}],
      dbMigrations: [{}],
      backgroundJobs: [{}],
      featureFlows: [{}],
      failureModes: [{}],
      testPlan: [{}],
      rolloutPlan: "x",
      rollbackPlan: "x",
    };
    const r = gapFinder(artifact, "default");
    assert.strictEqual(r.completenessScore, 1);
    assert.strictEqual(r.missingCritical.length, 0);
  });

  it("returns missingCritical for high-weight missing sections", () => {
    const artifact = { apiContracts: [], rollbackPlan: "" };
    const r = gapFinder(artifact, "default");
    assert.ok(r.missingCritical.length > 0);
    assert.ok(r.completenessScore < 1);
  });

  it("uses appType saas weights", () => {
    const artifact = {};
    const r = gapFinder(artifact, "saas");
    assert.ok(r.missingCritical.includes("apiContracts"));
    assert.ok(r.sectionScores["billing"] !== undefined);
  });
});

describe("runMultiPassReview", () => {
  it("accepts when qualityScore >= threshold and passes feasibility", () => {
    const artifact = { featureFlows: [{}], rollbackPlan: "revert" };
    const r = runMultiPassReview(artifact);
    assert.strictEqual(r.accepted, true);
    assert.ok(r.qualityScore >= QUALITY_THRESHOLD);
  });

  it("fails feasibility when no featureFlows or apiContracts", () => {
    const artifact = { rollbackPlan: "x" };
    const r = runMultiPassReview(artifact);
    assert.strictEqual(r.passResults[0].pass, false);
    assert.ok(r.passResults[0].issues.length > 0);
  });

  it("fails edge_cases when rollbackPlan missing", () => {
    const artifact = { featureFlows: [{}], rollbackPlan: "" };
    const r = runMultiPassReview(artifact);
    const edge = r.passResults.find((p) => p.id === "edge_cases");
    assert.ok(edge && !edge.pass);
  });
});

describe("assumptionResolver", () => {
  it("returns high assumptionRiskScore for very short prompt", () => {
    const r = assumptionResolver("hi", {});
    assert.ok(r.assumptionRiskScore >= 0.8);
    assert.ok(r.followUpQuestions.length > 0);
  });

  it("returns lower risk for longer prompt", () => {
    const r = assumptionResolver("Build a SaaS app with auth, billing, and admin dashboard with at least 20 chars", {});
    assert.ok(r.assumptionRiskScore < 0.8);
  });
});

describe("runProofPass", () => {
  it("returns ok false and missingCritical when artifact empty", () => {
    const r = runProofPass({}, { appType: "default" });
    assert.strictEqual(r.ok, false);
    assert.ok(r.missingCritical.length > 0);
    assert.ok(typeof r.assumptionRiskScore === "number");
    assert.ok(typeof r.qualityScore === "number");
    assert.ok(typeof r.completenessScore === "number");
  });

  it("returns ok true when artifact fully populated", () => {
    const artifact = {};
    REQUIRED_DOD_SECTIONS.forEach((key) => {
      artifact[key] = key === "rolloutPlan" || key === "rollbackPlan" ? "plan" : ["x"];
    });
    const r = runProofPass(artifact, { appType: "default" });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.missingCritical.length, 0);
    assert.ok(r.passResults.length === 4);
  });
});

describe("checkContextExpansionComplete (strict gate with memory)", () => {
  it("returns allowed false when memory returns empty artifact", () => {
    const r = checkContextExpansionComplete("default", {
      memory: { get: () => null },
    });
    assert.strictEqual(r.allowed, false);
    assert.ok(r.missingCritical.length > 0);
  });

  it("returns allowed false when memory returns incomplete artifact", () => {
    const r = checkContextExpansionComplete("p1", {
      memory: { get: () => ({ apiContracts: [], rollbackPlan: "" }) },
    });
    assert.strictEqual(r.allowed, false);
    assert.ok(r.missingCritical.includes("apiContracts") || r.missingCritical.length > 0);
  });

  it("returns allowed true when memory returns complete artifact", () => {
    const complete = {};
    REQUIRED_DOD_SECTIONS.forEach((key) => {
      complete[key] = key === "rolloutPlan" || key === "rollbackPlan" ? "plan" : ["x"];
    });
    const r = checkContextExpansionComplete("p1", {
      memory: { get: () => complete },
    });
    assert.strictEqual(r.allowed, true);
    assert.strictEqual(r.missingCritical.length, 0);
  });
});

describe("contextExpansionCompletenessGate (throws when incomplete)", () => {
  it("returns allowed true when artifact complete", () => {
    const complete = {};
    REQUIRED_DOD_SECTIONS.forEach((key) => {
      complete[key] = key === "rolloutPlan" || key === "rollbackPlan" ? "plan" : ["x"];
    });
    const r = contextExpansionCompletenessGate("p1", { memory: { get: () => complete } });
    assert.strictEqual(r.allowed, true);
    assert.ok(r.artifact);
  });

  it("throws when artifact incomplete", () => {
    assert.throws(
      () => contextExpansionCompletenessGate("p1", { memory: { get: () => null } }),
      (err) => err.allowed === false && Array.isArray(err.missingCritical)
    );
  });
});
