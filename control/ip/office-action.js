"use strict";

function detectOfficeActionType(text) {
  const s = String(text || "").toLowerCase();
  if (s.includes("final office action") || s.includes("this is a final action")) return "final";
  if (s.includes("nonfinal office action") || s.includes("non-final office action")) return "nonfinal";
  if (s.includes("office action")) return "unknown";
  return null;
}

function extractIssueDate(text) {
  const s = String(text || "");
  const m = s.match(/issue\s*date\s*[:\-]\s*([A-Za-z]{3,9}\s+\d{1,2},\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{4})/i);
  if (!m) return null;
  const d = new Date(m[1]);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function findIssues(text) {
  const s = String(text || "");
  const issues = [];

  const push = (issue_type, severity, re, actions) => {
    if (re.test(s)) {
      const snippet = (s.match(re)?.[0] || "").slice(0, 400);
      issues.push({ issue_type, severity, extracted_text_snippet: snippet, recommended_actions: actions });
    }
  };

  push("disclaimer_requirement", "warn", /disclaimer\s+(is\s+)?required|must\s+disclaim/i, [
    "Draft exact disclaimer statement in USPTO format",
    "Confirm wording does not disclaim the entire mark",
  ]);

  push("id_goods_services", "warn", /identification\s+of\s+goods|indefinite|overly\s+broad|amend\s+the\s+identification/i, [
    "Amend identification to be definite and narrower",
    "Ensure amendment does not broaden scope",
  ]);

  push("specimen_refusal", "blocker", /specimen\s+refused|refusal.*specimen|substitute\s+specimen/i, [
    "Provide substitute specimen showing mark in commerce",
    "Prepare declaration language for substitute specimen",
  ]);

  push("likelihood_of_confusion_2d", "blocker", /section\s*2\(d\)|likelihood\s+of\s+confusion/i, [
    "Draft 2(d) argument structure: marks/goods/channels/purchasers",
    "Gather marketplace evidence and coexistence facts",
  ]);

  push("descriptiveness_2e1", "warn", /section\s*2\(e\)\(1\)|merely\s+descriptive|descriptiveness/i, [
    "Evaluate suggestive argument vs Supplemental Register",
    "Gather acquired distinctiveness evidence if available",
  ]);

  push("owner_entity_or_domicile", "warn", /domicile|owner\s+information|entity\s+type\s+required/i, [
    "Confirm legal entity name and domicile",
    "Align owner fields across all submissions",
  ]);

  return issues;
}

function buildDeadline(oaType, issueDate) {
  if (!issueDate) return null;
  // Operational default: 3-month OA response window; extendable when applicable.
  const due = new Date(issueDate);
  due.setUTCMonth(due.getUTCMonth() + 3);
  return {
    deadline_type: oaType === "final" ? "oa_response_final" : "oa_response",
    due_date: due.toISOString().slice(0, 10),
    source: "doc_parse",
    notes: `Auto-computed from issue date (${issueDate.toISOString().slice(0, 10)}). Verify in TEAS before filing.`,
  };
}

function parseOfficeAction(text) {
  const oaType = detectOfficeActionType(text);
  const issueDate = extractIssueDate(text);
  const issues = findIssues(text);
  const deadline = buildDeadline(oaType, issueDate);

  return {
    office_action_type: oaType,
    issue_date: issueDate ? issueDate.toISOString().slice(0, 10) : null,
    issues,
    deadlines: deadline ? [deadline] : [],
  };
}

module.exports = {
  parseOfficeAction,
};
