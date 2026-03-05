#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const pg = require("../infra/postgres");
const { getRules } = require("../control/ip/rules-engine");

const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const getArg = (flag, fallback = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};

const LIMIT = Math.max(10, Number(getArg("--limit", "500")) || 500);
const OUT_DIR = path.join(process.cwd(), "scripts", "ip-rules-proposals");
const DRY_RUN = hasFlag("--dry-run");

async function fetchStats() {
  const byIssue = await pg.query(
    `SELECT issue_type,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE result = 'accepted')::int AS accepted,
            COUNT(*) FILTER (WHERE result = 'final_refusal')::int AS final_refusal,
            COUNT(*) FILTER (WHERE result = 'abandoned')::int AS abandoned,
            AVG(NULLIF(time_to_resolution_days,0))::numeric(10,2) AS avg_days
     FROM ip_case_outcomes
     GROUP BY issue_type
     ORDER BY total DESC
     LIMIT 50`
  );

  const examiner = await pg.query(
    `SELECT examiner,
            issue_type,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE result = 'accepted')::int AS accepted
     FROM ip_case_outcomes
     WHERE examiner IS NOT NULL
     GROUP BY examiner, issue_type
     HAVING COUNT(*) >= 2
     ORDER BY total DESC
     LIMIT 100`
  );

  const sample = await pg.query(
    `SELECT c.case_key, o.issue_type, o.response_strategy_used, o.examiner, o.result,
            o.cycles_to_resolution, o.time_to_resolution_days, o.notes
     FROM ip_case_outcomes o
     JOIN ip_cases c ON c.id = o.case_id
     ORDER BY o.created_at DESC
     LIMIT $1`,
    [LIMIT]
  );

  const borderlineTop = await pg.query(
    `SELECT issue_type, class_number, mark_category, examiner_name, similarity_band, goods_overlap_band, strictness_band,
            strategy_mode, sample_size, acceptance_rate, avg_cycles, scope_shrink_penalty, score
     FROM ip_borderline_matrix
     WHERE sample_size >= 3
     ORDER BY score DESC, sample_size DESC
     LIMIT 50`
  ).catch(() => ({ rows: [] }));

  return {
    by_issue: byIssue.rows,
    examiner_patterns: examiner.rows,
    recent_samples: sample.rows,
    borderline_top_patterns: borderlineTop.rows,
  };
}

function pushUniqueProposal(proposals, proposal) {
  if (!proposal || !proposal.rule_path) return;
  const key = `${proposal.change_type}:${proposal.rule_path}:${JSON.stringify(proposal.after)}`;
  if (proposals.some((p) => `${p.change_type}:${p.rule_path}:${JSON.stringify(p.after)}` === key)) return;
  proposals.push(proposal);
}

function buildDeterministicProposals(rules, stats) {
  const proposals = [];
  const byIssue = Array.isArray(stats.by_issue) ? stats.by_issue : [];

  for (const row of byIssue) {
    const issue = String(row.issue_type || "");
    const cfg = rules?.issue_detection?.[issue];
    if (!cfg) continue;

    const total = Number(row.total || 0);
    if (!total) continue;
    const acceptedRate = Number(row.accepted || 0) / total;
    const avgDays = Number(row.avg_days || 0);

    if (acceptedRate < 0.50) {
      pushUniqueProposal(proposals, {
        rule_path: `issue_detection.${issue}.threshold`,
        change_type: "adjust_threshold",
        before: Number(cfg.threshold || 4),
        after: Math.max(2, Number(cfg.threshold || 4) - 1),
        expected_impact: `Low accepted rate (${acceptedRate.toFixed(2)}) suggests over-triggering; reduce threshold for stricter signal.`,
        confidence: 0.62,
      });
    }

    if (acceptedRate > 0.85 && avgDays > 60) {
      pushUniqueProposal(proposals, {
        rule_path: `issue_detection.${issue}.threshold`,
        change_type: "adjust_threshold",
        before: Number(cfg.threshold || 4),
        after: Number(cfg.threshold || 4) + 1,
        expected_impact: `High accepted rate but slow resolution (${avgDays.toFixed(1)} days); increase threshold to prioritize high-confidence matches.`,
        confidence: 0.58,
      });
    }
  }

  const examinerPatterns = Array.isArray(stats.examiner_patterns) ? stats.examiner_patterns : [];
  for (const row of examinerPatterns) {
    const total = Number(row.total || 0);
    if (total < 4) continue;
    const acceptedRate = Number(row.accepted || 0) / total;
    if (acceptedRate < 0.35) {
      const examiner = String(row.examiner || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
      const issue = String(row.issue_type || "");
      pushUniqueProposal(proposals, {
        rule_path: `overrides.examiner_${examiner}.issue_detection.${issue}.threshold`,
        change_type: "examiner_overlay",
        before: null,
        after: 5,
        expected_impact: `Examiner-specific low acceptance (${acceptedRate.toFixed(2)}). Add overlay to tighten ${issue} handling.`,
        confidence: 0.55,
      });
    }
  }

  const borderlinePatterns = Array.isArray(stats.borderline_top_patterns) ? stats.borderline_top_patterns : [];
  for (const row of borderlinePatterns) {
    const issue = String(row.issue_type || "");
    const strategy = String(row.strategy_mode || "other");
    const sampleSize = Number(row.sample_size || 0);
    const acceptanceRate = Number(row.acceptance_rate || 0);
    if (sampleSize < 3 || acceptanceRate < 0.75) continue;

    const classNum = row.class_number == null ? null : Number(row.class_number);
    const category = row.mark_category == null ? null : String(row.mark_category);
    const examiner = row.examiner_name == null ? null : String(row.examiner_name).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    const profileScope = examiner
      ? `examiner_${examiner}`
      : category
        ? `category_${String(category).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`
        : classNum != null
          ? `class_${classNum}`
          : null;
    if (!profileScope) continue;

    pushUniqueProposal(proposals, {
      rule_path: `strategy_overrides.${profileScope}.${issue}.preferred_strategy`,
      change_type: "strategy_override",
      before: null,
      after: strategy,
      expected_impact: `Borderline pattern score ${Number(row.score || 0).toFixed(3)} with acceptance ${acceptanceRate.toFixed(2)} over ${sampleSize} samples.`,
      confidence: 0.57,
    });
  }

  return proposals;
}

async function main() {
  const { rules, version } = await getRules();
  const stats = await fetchStats();

  let proposal = {
    summary: "Deterministic suggestions generated from outcome telemetry.",
    proposals: [],
  };

  if (!DRY_RUN) {
    proposal = {
      summary: `Generated from ${stats.by_issue.length} issue buckets and ${stats.examiner_patterns.length} examiner patterns.`,
      proposals: buildDeterministicProposals(rules, stats),
    };
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, `${Date.now()}-rules-proposal-v${version}.json`);
  fs.writeFileSync(out, JSON.stringify(proposal, null, 2));

  console.log(`[ip-rules-suggest] wrote ${out}`);
  console.log(`[ip-rules-suggest] proposals=${Array.isArray(proposal.proposals) ? proposal.proposals.length : 0}`);
}

main()
  .then(async () => { await pg.end(); })
  .catch(async (err) => {
    console.error("Fatal:", err.message);
    await pg.end();
    process.exit(1);
  });
