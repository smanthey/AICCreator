#!/usr/bin/env node
"use strict";

require("dotenv").config();

const pg = require("../infra/postgres");
const { createActionForIssue } = require("../control/credit/workflow");
const { orderIssues, phaseForIssue } = require("../control/credit/prioritizer");
const { buildUtilizationPlan } = require("../control/credit/optimizer");

const args = process.argv.slice(2);
const getArg = (flag, fallback = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};
const hasFlag = (flag) => args.includes(flag);

const personKey = getArg("--person-key");
const CREATE_ACTIONS = hasFlag("--create-actions");
const MONTHLY_BUDGET = Number(getArg("--monthly-budget", "0")) || 0;

async function loadProfileByKey(key) {
  const { rows } = await pg.query(
    `SELECT id, external_key, full_name
     FROM credit_person_profiles
     WHERE external_key = $1
     LIMIT 1`,
    [key]
  );
  return rows[0] || null;
}

async function loadLatestReportId(personId) {
  const { rows } = await pg.query(
    `SELECT id
     FROM credit_reports
     WHERE person_id = $1
     ORDER BY report_date DESC, created_at DESC
     LIMIT 1`,
    [personId]
  );
  return rows[0]?.id || null;
}

async function loadOpenIssuesForPerson(personId) {
  const { rows } = await pg.query(
    `SELECT i.*, r.bureau
     FROM credit_issues i
     LEFT JOIN credit_reports r ON r.id = i.report_id
     WHERE i.person_id = $1 AND i.status = 'open'
     ORDER BY CASE i.severity WHEN 'blocker' THEN 1 WHEN 'warn' THEN 2 ELSE 3 END, i.created_at DESC`,
    [personId]
  );
  return rows;
}

async function main() {
  if (!personKey) {
    throw new Error("Usage: node scripts/credit-plan.js --person-key <key> [--create-actions]");
  }

  const profile = await loadProfileByKey(personKey);
  if (!profile) throw new Error(`No profile found for person_key=${personKey}`);
  const reportId = await loadLatestReportId(profile.id);
  if (!reportId) throw new Error(`No reports found for person_key=${personKey}`);

  const utilPlan = await buildUtilizationPlan(reportId, { monthlyBudget: MONTHLY_BUDGET });
  const issues = orderIssues(await loadOpenIssuesForPerson(profile.id));

  console.log("\n=== Credit 30/60/90 Plan ===\n");
  console.log(`person_key: ${profile.external_key}`);
  console.log(`name:       ${profile.full_name || "(unknown)"}`);
  console.log(`report_id:  ${reportId}`);
  console.log(`budget:     ${MONTHLY_BUDGET > 0 ? `$${MONTHLY_BUDGET.toFixed(2)} / mo` : "(none provided)"}`);

  console.log("\n30 days:");
  console.log("- Identity normalization review (names/addresses/employers).");
  console.log("- Dispute only objective data errors and duplicate reporting.");
  console.log("- Keep card utilization at 1-9% overall.");

  console.log("\n60 days:");
  console.log("- Follow up on bureau/furnisher/collector responses.");
  console.log("- Escalate unresolved process failures to CFPB packet prep.");
  console.log("- Continue zero late payments and controlled balances.");

  console.log("\n90 days:");
  console.log("- Re-pull reports and re-run deterministic issue checks.");
  console.log("- Close resolved issues, open only newly proven inaccuracies.");
  console.log("- Evaluate controlled new-tradeline strategy if profile stable.");

  console.log("\nRanked action sequence (impact x legality x success):");
  if (!issues.length) {
    console.log("- No open issues detected.");
  } else {
    for (const i of issues.slice(0, 12)) {
      console.log(`- [phase ${phaseForIssue(i.issue_type)}] ${i.issue_type} | impact ${i.score_impact_estimate || 0} | confidence ${Math.round(Number(i.confidence || 0) * 100)}%`);
    }
  }

  console.log("\nUtilization tune-up targets:");
  if (!utilPlan.lines.length) {
    console.log("- No revolving lines above 30% utilization.");
  } else {
    console.log(`- Overall utilization now:       ${Math.round(Number(utilPlan.summary.overall_utilization_now || 0) * 100)}%`);
    console.log(`- Overall utilization projected: ${Math.round(Number(utilPlan.summary.overall_utilization_projected || 0) * 100)}%`);
    console.log(`- Paydown needed to hit 9%/card: $${Number(utilPlan.summary.paydown_needed_to_hit_per_card_target || 0).toFixed(2)}`);
    if (MONTHLY_BUDGET > 0) {
      console.log(`- Budget allocated this month:   $${Number(utilPlan.allocated_total || 0).toFixed(2)}`);
    }
    for (const u of utilPlan.lines
      .filter((x) => Number(x.utilization_now || 0) >= 0.3)
      .sort((a, b) => Number(b.utilization_now || 0) - Number(a.utilization_now || 0))
      .slice(0, 12)) {
      const payPart = MONTHLY_BUDGET > 0 ? ` | pay now ${Number(u.recommended_payment || 0).toFixed(2)} | projected ${Math.round(Number(u.projected_utilization || 0) * 100)}%` : "";
      const timing = u.payment_by ? ` | pay by ${u.payment_by}` : "";
      console.log(`- ${u.furnisher_name || "unknown"} (${u.account_ref || "n/a"}): now ${Math.round(u.utilization_now * 100)}% -> target balance ${u.target_balance.toFixed(2)}, paydown ${u.paydown_needed.toFixed(2)}${payPart}${timing}`);
    }
  }

  if (!CREATE_ACTIONS) return;

  let created = 0;
  for (const i of issues) {
    const res = await createActionForIssue(i, { evidenceTags: i.evidence_present || [] });
    if (res.policy_allowed) created += 1;
  }
  console.log(`\nactions_created_from_open_issues: ${issues.length}`);
  console.log(`actions_policy_allowed:           ${created}`);
}

main()
  .then(async () => { await pg.end(); })
  .catch(async (err) => {
    console.error("Fatal:", err.message);
    await pg.end();
    process.exit(1);
  });
