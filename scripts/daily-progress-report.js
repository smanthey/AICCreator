#!/usr/bin/env node
"use strict";

require("dotenv").config();
const pg = require("../infra/postgres");
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const getArg = (flag, fallback = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};

const TZ = getArg("--tz", process.env.TZ || "America/Phoenix");
const REPORTS_DIR = path.join(__dirname, "..", "reports");

function readJsonSafe(fileName) {
  try {
    return JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, fileName), "utf8"));
  } catch {
    return null;
  }
}

async function leadStats(brand) {
  const templateByBrand = {
    skynpatch: "skynpatch_b2b_intro",
    blackwallstreetopoly: "blackwallstreetopoly_wholesale_intro",
  };
  const template = templateByBrand[String(brand || "").toLowerCase()] || "skynpatch_b2b_intro";
  const { rows } = await pg.query(
    `WITH bounds AS (
       SELECT
         date_trunc('day', NOW() AT TIME ZONE $2) AT TIME ZONE $2 AS day_start,
         (date_trunc('day', NOW() AT TIME ZONE $2) + INTERVAL '1 day') AT TIME ZONE $2 AS day_end
     ),
     lead_stats AS (
       SELECT
         COUNT(*)::int AS leads_total,
         COUNT(*) FILTER (WHERE COALESCE(email,'') <> '')::int AS leads_with_email,
         COUNT(*) FILTER (WHERE created_at >= b.day_start AND created_at < b.day_end)::int AS leads_added_today,
         COUNT(*) FILTER (
           WHERE COALESCE(l.email,'') <> ''
             AND l.status NOT IN ('unsubscribed','bounced')
             AND NOT EXISTS (
               SELECT 1
               FROM email_sends es
               WHERE es.lead_id = l.id
                 AND es.template = $3
             )
         )::int AS leads_ready_to_send
       FROM leads l
       CROSS JOIN bounds b
       WHERE l.brand_slug = $1
     ),
     send_stats AS (
       SELECT
         COUNT(*)::int AS sends_today,
         COUNT(*) FILTER (WHERE status='delivered' OR delivered_at IS NOT NULL)::int AS delivered_today,
         COUNT(*) FILTER (WHERE opened_at IS NOT NULL)::int AS opened_today,
         COUNT(*) FILTER (WHERE clicked_at IS NOT NULL)::int AS clicked_today
       FROM email_sends es
       CROSS JOIN bounds b
       WHERE es.brand_slug = $1
         AND es.sent_at >= b.day_start AND es.sent_at < b.day_end
     )
     SELECT
       $1::text AS brand_slug,
       l.leads_total,
       l.leads_with_email,
       l.leads_added_today,
       l.leads_ready_to_send,
       s.sends_today,
       s.delivered_today,
       s.opened_today,
       s.clicked_today
     FROM lead_stats l
     CROSS JOIN send_stats s`,
    [brand, TZ, template]
  );
  return rows[0] || null;
}

async function githubStats() {
  const { rows } = await pg.query(
    `WITH latest AS (
       SELECT *
       FROM github_repo_scan_runs
       WHERE status='completed'
       ORDER BY finished_at DESC NULLS LAST
       LIMIT 1
     ),
     bounds AS (
       SELECT
         date_trunc('day', NOW() AT TIME ZONE $1) AT TIME ZONE $1 AS day_start,
         (date_trunc('day', NOW() AT TIME ZONE $1) + INTERVAL '1 day') AT TIME ZONE $1 AS day_end
     )
     SELECT
       l.id,
       l.finished_at,
       l.repos_total,
       l.repos_scanned,
       l.pass_count,
       l.fail_count,
       ROUND(EXTRACT(EPOCH FROM (NOW() - l.finished_at))/3600.0, 2) AS latest_age_h,
       (
         SELECT COUNT(*)::int
         FROM github_repo_scan_runs g
         CROSS JOIN bounds b
         WHERE g.status='completed'
           AND g.finished_at >= b.day_start AND g.finished_at < b.day_end
       ) AS runs_today
     FROM latest l`
  , [TZ]);
  return rows[0] || null;
}

async function learningStats() {
  try {
    const { rows } = await pg.query(
      `SELECT
         (SELECT COUNT(*)::int FROM symbol_feature_playbooks) AS playbooks,
         (SELECT COUNT(DISTINCT feature_key)::int FROM symbol_exemplar_symbols) AS features_indexed,
         (SELECT COUNT(*)::int FROM symbol_exemplar_symbols) AS symbols_indexed,
         (SELECT COUNT(*)::int FROM knowledge_sources WHERE source_type = 'repo' AND status = 'active') AS knowledge_repos,
         (SELECT COUNT(*)::int FROM knowledge_sources WHERE source_type = 'paper' AND status = 'active') AS knowledge_papers,
         (SELECT COUNT(*)::int FROM knowledge_sources WHERE source_type = 'repo' AND status = 'active' AND indexed = TRUE) AS knowledge_repos_indexed,
         (SELECT COUNT(*)::int FROM pattern_insights WHERE created_at >= NOW() - INTERVAL '24 hours') AS insights_24h,
         (SELECT COUNT(*)::int FROM pattern_insights) AS insights_total`
    );
    return rows[0] || null;
  } catch {
    return null;
  }
}

function p(name, value) {
  console.log(`${name}: ${value}`);
}

async function main() {
  const skyn = await leadStats("skynpatch");
  const bws = await leadStats("blackwallstreetopoly");
  const gh = await githubStats();
  const learning = await learningStats();
  const symbolicQa = readJsonSafe("symbolic-qa-hub-latest.json");
  const featureRotation = readJsonSafe("daily-feature-rotation-latest.json");
  const closedLoop = readJsonSafe("closed-loop-daily-latest.json");
  const knowledge = readJsonSafe("knowledge-troll-harvest-latest.json");
  const robust = readJsonSafe("pattern-robust-builder-latest.json");

  console.log("\n=== Daily Progress Report ===\n");
  p("timezone", TZ);
  p("generated_at", new Date().toISOString());
  console.log("");

  console.log("SkynPatch");
  console.log("---------");
  if (!skyn) {
    p("status", "no_data");
  } else {
    p("leads_total", skyn.leads_total);
    p("leads_with_email", skyn.leads_with_email);
    p("leads_added_today", skyn.leads_added_today);
    p("leads_ready_to_send", skyn.leads_ready_to_send);
    p("sends_today", skyn.sends_today);
    p("delivered_today", skyn.delivered_today);
    p("opened_today", skyn.opened_today);
    p("clicked_today", skyn.clicked_today);
  }
  console.log("");

  console.log("BlackWallstreetopoly");
  console.log("--------------------");
  if (!bws) {
    p("status", "no_data");
  } else {
    p("leads_total", bws.leads_total);
    p("leads_with_email", bws.leads_with_email);
    p("leads_added_today", bws.leads_added_today);
    p("leads_ready_to_send", bws.leads_ready_to_send);
    p("sends_today", bws.sends_today);
    p("delivered_today", bws.delivered_today);
    p("opened_today", bws.opened_today);
    p("clicked_today", bws.clicked_today);
  }
  console.log("");

  console.log("GitHub Observability");
  console.log("--------------------");
  if (!gh) {
    p("status", "no_completed_scan_run");
  } else {
    p("latest_run_id", gh.id);
    p("latest_finished_at", gh.finished_at);
    p("latest_age_h", gh.latest_age_h);
    p("repos_scanned", `${gh.repos_scanned}/${gh.repos_total}`);
    p("pass_fail", `${gh.pass_count}/${gh.fail_count}`);
    p("runs_today", gh.runs_today);
  }

  console.log("");
  console.log("Learning Flywheel");
  console.log("-----------------");
  if (!learning) {
    p("status", "no_learning_tables_or_no_data");
  } else {
    p("playbooks", learning.playbooks);
    p("features_indexed", learning.features_indexed);
    p("symbols_indexed", learning.symbols_indexed);
    p("knowledge_repos", learning.knowledge_repos);
    p("knowledge_papers", learning.knowledge_papers);
    p("knowledge_repos_indexed", learning.knowledge_repos_indexed);
    p("insights_24h", learning.insights_24h);
    p("insights_total", learning.insights_total);
  }

  console.log("");
  console.log("Daily Feature Upgrades");
  console.log("----------------------");
  p("symbolic_features_mapped", Array.isArray(symbolicQa?.features) ? symbolicQa.features.length : 0);
  p("symbolic_repos_missing_index", Array.isArray(symbolicQa?.repos_missing_index) ? symbolicQa.repos_missing_index.length : 0);
  p("rotation_repos_considered", Number(featureRotation?.repos_considered || 0));
  p("rotation_features_queued", Array.isArray(featureRotation?.queued) ? featureRotation.queued.length : 0);
  p("closed_loop_targets", Array.isArray(closedLoop?.targets) ? closedLoop.targets.length : 0);
  p("closed_loop_created", Array.isArray(closedLoop?.targets) ? closedLoop.targets.filter((t) => t && t.created === true).length : 0);
  p("playbooks_updated", Array.isArray(robust?.playbooks_updated) ? robust.playbooks_updated.length : 0);

  console.log("");
  console.log("Knowledge Discovery");
  console.log("-------------------");
  p("repos_discovered", Number(knowledge?.repos_discovered || 0));
  p("papers_discovered", Number(knowledge?.papers_discovered || 0));
  p("domains_covered", Object.keys(knowledge?.domains || {}).length);
  p("queued_index_subagent_tasks", Array.isArray(knowledge?.queued_index_subagent_tasks) ? knowledge.queued_index_subagent_tasks.length : 0);
  p("queued_pattern_subagent_tasks", Array.isArray(knowledge?.queued_pattern_subagent_tasks) ? knowledge.queued_pattern_subagent_tasks.length : 0);
}

main()
  .then(async () => { await pg.end(); })
  .catch(async (err) => {
    console.error("Fatal:", err.message);
    try { await pg.end(); } catch {}
    process.exit(1);
  });
