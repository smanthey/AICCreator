#!/usr/bin/env node
"use strict";

const path = require("path");
const { Pool } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const ARGS = process.argv.slice(2);
const LIMIT = parseInt(getArg("--limit", "200"), 10);
const DAYS = parseInt(getArg("--days", "30"), 10);

const pool = new Pool({
  host: process.env.POSTGRES_HOST,
  port: parseInt(process.env.POSTGRES_PORT || "5432", 10),
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
});

function getArg(flag, fallback) {
  const idx = ARGS.indexOf(flag);
  if (idx < 0 || idx + 1 >= ARGS.length) return fallback;
  return ARGS[idx + 1];
}

function classify(update) {
  const txt = `${update.title || ""}\n${update.raw_content || ""}`.toLowerCase();
  let signalType = "docs";
  let urgency = "low";
  let requiresAction = false;
  const actions = [];
  const impactModules = [];

  const has = (re) => re.test(txt);
  if (has(/\bsecurity\b|\bcve\b|\bvulnerability\b|\bexploit\b/)) {
    signalType = "security";
    urgency = "critical";
    requiresAction = true;
    actions.push("Open security review issue and patch affected modules.");
  } else if (has(/\bbreaking\b|\bremoved\b|\bno longer\b|\bdeprecated\b/)) {
    signalType = has(/\bdeprecated\b/) ? "deprecation" : "breaking_change";
    urgency = "high";
    requiresAction = true;
    actions.push("Run compatibility scan and open upgrade PR plan.");
  } else if (has(/\bpricing\b|\bprice\b|\bbilling\b/)) {
    signalType = "pricing";
    urgency = "medium";
    requiresAction = true;
    actions.push("Review billing assumptions and update runbooks.");
  } else if (has(/\bperformance\b|\blatency\b|\bfaster\b/)) {
    signalType = "performance";
    urgency = "low";
    actions.push("Benchmark in staging before adopting.");
  } else if (has(/\bnew\b|\brelease\b|\bfeature\b/)) {
    signalType = "feature";
    urgency = "low";
    actions.push("Add to feature backlog if relevant.");
  }

  if (txt.includes("stripe")) impactModules.push("module-billing/stripe");
  if (txt.includes("telnyx")) impactModules.push("module-comm/telnyx");
  if (txt.includes("next.js") || txt.includes("nextjs")) impactModules.push("framework/nextjs");
  if (txt.includes("better-auth") || txt.includes("better auth")) impactModules.push("module-auth/betterauth");
  if (txt.includes("neon")) impactModules.push("infra/neon-postgres");

  if (signalType === "breaking_change" || signalType === "deprecation") {
    actions.push("Queue deterministic regression suite for impacted repos.");
  }
  if (signalType === "security") {
    actions.push("Block promotion of affected rule/module versions until patched.");
  }

  const confidence =
    signalType === "security" ? 0.95 :
    signalType === "breaking_change" ? 0.9 :
    signalType === "deprecation" ? 0.88 :
    signalType === "pricing" ? 0.82 :
    signalType === "feature" ? 0.75 : 0.7;

  const summary = `${signalType} (${urgency}) from ${update.domain_key}: ${update.title}`.slice(0, 500);

  return {
    signalType,
    urgency,
    requiresAction,
    impactModules: [...new Set(impactModules)],
    confidence,
    summary,
    actions,
    ruleCandidate: {
      mode: "suggested_update",
      reason: signalType,
      auto_apply: false
    }
  };
}

async function main() {
  const q = await pool.query(
    `SELECT u.id, u.domain_key, u.title, u.url, u.raw_content, u.published_at
     FROM external_updates u
     LEFT JOIN external_update_signals s ON s.update_id = u.id
     WHERE s.id IS NULL
       AND COALESCE(u.published_at, u.created_at) >= NOW() - ($1 || ' days')::interval
     ORDER BY COALESCE(u.published_at, u.created_at) DESC
     LIMIT $2`,
    [String(DAYS), LIMIT]
  );

  let inserted = 0;
  for (const row of q.rows) {
    const signal = classify(row);
    await pool.query(
      `INSERT INTO external_update_signals
       (update_id, domain_key, signal_type, urgency, requires_action, impact_modules, confidence, summary, recommended_actions, rule_candidate)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb)`,
      [
        row.id,
        row.domain_key,
        signal.signalType,
        signal.urgency,
        signal.requiresAction,
        signal.impactModules,
        signal.confidence,
        signal.summary,
        JSON.stringify(signal.actions),
        JSON.stringify(signal.ruleCandidate),
      ]
    );
    inserted += 1;
  }

  console.log(`[research-signals] scanned=${q.rowCount} inserted=${inserted}`);
  await pool.end();
}

main().catch(async (err) => {
  console.error("[research-signals] fatal:", err.message);
  await pool.end();
  process.exit(1);
});
