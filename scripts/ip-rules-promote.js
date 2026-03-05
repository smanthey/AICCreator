#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const pg = require("../infra/postgres");
const {
  getActiveRules,
  loadProposalFromFile,
  buildPatchedRules,
  simulateAgainstRules,
  getPatchBeforeAfter,
} = require("../control/ip/rules-harness");

const args = process.argv.slice(2);
const getArg = (flag, fallback = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};

const PROPOSAL = getArg("--proposal", null);
const MIN_DOC_F1 = Number(getArg("--min-doc-f1", "0.7"));
const MIN_ISSUE_F1 = Number(getArg("--min-issue-f1", "0.7"));
const MIN_DEADLINE = Number(getArg("--min-deadline", "0.95"));
const MIN_DOC_F1_DELTA = Number(getArg("--min-doc-f1-delta", "0"));
const MIN_ISSUE_F1_DELTA = Number(getArg("--min-issue-f1-delta", "0"));
const MIN_DEADLINE_DELTA = Number(getArg("--min-deadline-delta", "0"));
const DRY_RUN = args.includes("--dry-run");
const LIMIT_DOCS = Math.max(50, Number(getArg("--limit-docs", "2000")) || 2000);
const LIMIT_ISSUES = Math.max(50, Number(getArg("--limit-issues", "5000")) || 5000);
const LIMIT_DEADLINES = Math.max(50, Number(getArg("--limit-deadlines", "2000")) || 2000);

const RULES_DIR = path.join(process.cwd(), "config", "ip-rules");

function hashText(text) {
  return require("crypto").createHash("sha256").update(String(text)).digest("hex");
}

async function markRuleSetStatuses(newVersion) {
  await pg.query(`UPDATE ip_rule_sets SET status = 'retired' WHERE status = 'active' AND version <> $1`, [newVersion]);
  await pg.query(`UPDATE ip_rule_sets SET status = 'active', activated_at = NOW() WHERE version = $1`, [newVersion]);
}

async function main() {
  if (!PROPOSAL) throw new Error("Required: --proposal <path-to-proposal-json>");

  const active = await getActiveRules();
  const loaded = loadProposalFromFile(PROPOSAL);
  const patchOps = loaded.ops;
  if (!patchOps.length) {
    console.log("[ip-rules-promote] no patch operations in proposal; nothing to promote.");
    return;
  }

  const patchedRules = buildPatchedRules(active.rules, patchOps);
  const nextVersion = Number(active.version || 1) + 1;
  if (!patchedRules.meta) patchedRules.meta = {};
  patchedRules.meta.version = nextVersion;
  patchedRules.meta.updated_at = new Date().toISOString().slice(0, 10);
  patchedRules.meta.notes = `Promoted from v${active.version} using ${path.basename(PROPOSAL)}`;

  const [baseline, proposed] = await Promise.all([
    simulateAgainstRules(active.rules, { limitDocs: LIMIT_DOCS, limitIssues: LIMIT_ISSUES, limitDeadlines: LIMIT_DEADLINES }),
    simulateAgainstRules(patchedRules, { limitDocs: LIMIT_DOCS, limitIssues: LIMIT_ISSUES, limitDeadlines: LIMIT_DEADLINES }),
  ]);

  const delta = {
    doc_f1: Number((proposed.doc_type_macro.f1 - baseline.doc_type_macro.f1).toFixed(3)),
    issue_f1: Number((proposed.issue_macro.f1 - baseline.issue_macro.f1).toFixed(3)),
    deadline: Number((proposed.deadline_consistency.consistency - baseline.deadline_consistency.consistency).toFixed(3)),
  };

  const checks = {
    min_doc_f1: proposed.doc_type_macro.f1 >= MIN_DOC_F1,
    min_issue_f1: proposed.issue_macro.f1 >= MIN_ISSUE_F1,
    min_deadline: proposed.deadline_consistency.consistency >= MIN_DEADLINE,
    min_doc_f1_delta: delta.doc_f1 >= MIN_DOC_F1_DELTA,
    min_issue_f1_delta: delta.issue_f1 >= MIN_ISSUE_F1_DELTA,
    min_deadline_delta: delta.deadline >= MIN_DEADLINE_DELTA,
  };

  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
  const patchPreview = getPatchBeforeAfter(active.rules, patchOps);

  if (failed.length) {
    console.error(`[ip-rules-promote] blocked: thresholds failed -> ${failed.join(", ")}`);
    console.error(`[ip-rules-promote] proposed doc_f1=${proposed.doc_type_macro.f1} issue_f1=${proposed.issue_macro.f1} deadline=${proposed.deadline_consistency.consistency}`);
    process.exit(2);
  }

  const outFile = path.join(RULES_DIR, `ip-rules.v${nextVersion}.json`);
  const serialized = JSON.stringify(patchedRules, null, 2);
  const checksum = hashText(serialized);

  if (DRY_RUN) {
    console.log(`[ip-rules-promote] dry-run passed -> would write ${outFile}`);
    console.log(`[ip-rules-promote] delta doc_f1=${delta.doc_f1} issue_f1=${delta.issue_f1} deadline=${delta.deadline}`);
    return;
  }

  fs.mkdirSync(RULES_DIR, { recursive: true });
  fs.writeFileSync(outFile, serialized);

  const ruleSetInsert = await pg.query(
    `INSERT INTO ip_rule_sets (version, name, status, file_path, checksum_sha256, notes, activated_at)
     VALUES ($1, $2, 'active', $3, $4, $5, NOW())
     RETURNING id`,
    [nextVersion, `IP Deterministic Rules v${nextVersion}`, outFile, checksum, `Promoted from v${active.version}`]
  );

  const ruleSetId = ruleSetInsert.rows[0].id;

  for (const p of patchPreview) {
    await pg.query(
      `INSERT INTO ip_rule_changes
       (rule_set_id, change_type, rule_path, before_value, after_value, rationale)
       VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6)`,
      [
        ruleSetId,
        p.op,
        p.path,
        JSON.stringify(p.before === undefined ? null : p.before),
        JSON.stringify(p.after === undefined ? null : p.after),
        p.rationale,
      ]
    );
  }

  await markRuleSetStatuses(nextVersion);

  const changelogPath = path.join(RULES_DIR, "CHANGELOG.md");
  const lines = [];
  lines.push(`## v${nextVersion} (${new Date().toISOString()})`);
  lines.push(`- promoted from v${active.version}`);
  lines.push(`- proposal: ${PROPOSAL}`);
  lines.push(`- metrics: doc_f1=${proposed.doc_type_macro.f1} (delta ${delta.doc_f1}), issue_f1=${proposed.issue_macro.f1} (delta ${delta.issue_f1}), deadline=${proposed.deadline_consistency.consistency} (delta ${delta.deadline})`);
  lines.push(`- changes: ${patchPreview.length}`);
  for (const p of patchPreview) lines.push(`  - ${p.op} ${p.path}`);
  lines.push("");

  const prior = fs.existsSync(changelogPath) ? fs.readFileSync(changelogPath, "utf8") : "# IP Rules Changelog\n\n";
  fs.writeFileSync(changelogPath, `${prior}${lines.join("\n")}\n`);

  console.log(`[ip-rules-promote] promoted v${nextVersion}`);
  console.log(`[ip-rules-promote] wrote ${outFile}`);
  console.log(`[ip-rules-promote] delta doc_f1=${delta.doc_f1} issue_f1=${delta.issue_f1} deadline=${delta.deadline}`);
}

main()
  .then(async () => { await pg.end(); })
  .catch(async (err) => {
    console.error("Fatal:", err.message);
    await pg.end();
    process.exit(1);
  });
