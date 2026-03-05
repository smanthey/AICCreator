"use strict";

const fs = require("fs");
const path = require("path");

const TPL_DIR = path.join(__dirname, "../../data/credit-kb/templates");

function loadTemplate(name) {
  const p = path.join(TPL_DIR, `${name}.txt`);
  if (!fs.existsSync(p)) {
    throw new Error(`template_not_found:${name}`);
  }
  return fs.readFileSync(p, "utf8");
}

function fillTemplate(templateText, vars = {}) {
  return templateText.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key) => {
    const v = vars[key];
    return v === undefined || v === null || v === "" ? "(not provided)" : String(v);
  });
}

function templateForAction(actionType) {
  switch (actionType) {
    case "bureau_dispute":
      return "bureau_dispute";
    case "debt_validation":
      return "debt_validation";
    case "furnisher_dispute":
      return "furnisher_dispute";
    case "goodwill_request":
      return "goodwill_request";
    case "cfpb_escalation":
      return "cfpb_escalation";
    default:
      return "bureau_dispute";
  }
}

module.exports = {
  loadTemplate,
  fillTemplate,
  templateForAction,
};
