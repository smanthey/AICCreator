"use strict";

const fs = require("fs");
const path = require("path");

const KB_ROOT = path.join(__dirname, "../../data/credit-kb");

function readJson(relPath) {
  const p = path.join(KB_ROOT, relPath);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function listJson(dirRel) {
  const dir = path.join(KB_ROOT, dirRel);
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ({ file: f, data: readJson(path.join(dirRel, f)) }));
}

function loadComplianceKb() {
  const laws = listJson("laws").map((x) => x.data);
  const workflows = listJson("workflows").map((x) => x.data);
  const allowedActions = readJson("policy/allowed_actions.json");
  const prohibitedActions = readJson("policy/prohibited_actions.json");
  const issueEvidence = readJson("policy/issue_evidence.json");
  return {
    laws,
    workflows,
    allowedActions,
    prohibitedActions,
    issueEvidence,
  };
}

module.exports = {
  loadComplianceKb,
};

