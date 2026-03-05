#!/usr/bin/env node
"use strict";

require("dotenv").config();

const pg = require("../infra/postgres");
const { reconcileStaleArtifacts } = require("../control/credit/rules");
const { queueDueEchoTasks } = require("../control/credit/workflow");

const args = process.argv.slice(2);
const getArg = (flag, fallback = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};
const hasFlag = (flag) => args.includes(flag);

const personKey = getArg("--person-key");
const LIMIT = Number(getArg("--limit", "30")) || 30;
const CREATE_TASKS = hasFlag("--create-tasks");

async function resolvePersonId(key) {
  if (!key) return null;
  const { rows } = await pg.query(
    `SELECT id FROM credit_person_profiles WHERE external_key = $1 LIMIT 1`,
    [key]
  );
  if (!rows[0]) throw new Error(`No person found for person_key=${key}`);
  return rows[0].id;
}

async function loadDeadlines(personId) {
  const params = [];
  let where = "";
  if (personId) {
    params.push(personId);
    where = `AND d.person_id = $${params.length}`;
  }
  params.push(LIMIT);

  const { rows } = await pg.query(
    `SELECT d.id, d.deadline_type, d.due_date, d.status, d.notes,
            p.external_key, i.issue_type, i.title, i.score_impact_estimate,
            CASE i.issue_type
              WHEN 'mixed_file_indicator' THEN 1
              WHEN 'not_mine_account' THEN 1
              WHEN 'duplicate_tradeline' THEN 1
              WHEN 'duplicate_collection' THEN 1
              WHEN 'high_utilization' THEN 2
              ELSE 3
            END AS phase
     FROM credit_deadlines d
     JOIN credit_person_profiles p ON p.id = d.person_id
     LEFT JOIN credit_issues i ON i.id = d.issue_id
     WHERE d.status = 'open'
       ${where}
     ORDER BY phase ASC, COALESCE(i.score_impact_estimate,0) DESC, d.due_date ASC
     LIMIT $${params.length}`,
    params
  );
  return rows;
}

async function loadActions(personId) {
  const params = [];
  let where = "";
  if (personId) {
    params.push(personId);
    where = `AND a.person_id = $${params.length}`;
  }
  params.push(LIMIT);

  const { rows } = await pg.query(
    `SELECT a.id, a.action_type, a.channel, a.status, a.response_due_date,
            p.external_key, i.issue_type, i.title, i.score_impact_estimate,
            CASE i.issue_type
              WHEN 'mixed_file_indicator' THEN 1
              WHEN 'not_mine_account' THEN 1
              WHEN 'duplicate_tradeline' THEN 1
              WHEN 'duplicate_collection' THEN 1
              WHEN 'high_utilization' THEN 2
              ELSE 3
            END AS phase
     FROM credit_actions a
     JOIN credit_person_profiles p ON p.id = a.person_id
     LEFT JOIN credit_issues i ON i.id = a.issue_id
     WHERE a.status IN ('queued', 'blocked', 'draft')
       ${where}
     ORDER BY phase ASC, COALESCE(i.score_impact_estimate,0) DESC, a.created_at DESC
     LIMIT $${params.length}`,
    params
  );
  return rows;
}

async function main() {
  await reconcileStaleArtifacts();
  const personId = await resolvePersonId(personKey);
  const [deadlines, actions] = await Promise.all([loadDeadlines(personId), loadActions(personId)]);

  console.log("\n=== Credit Next Actions ===\n");
  if (!deadlines.length) console.log("No open deadlines.");
  else {
    console.log("Deadlines:");
    for (const d of deadlines) {
      console.log(`- [phase ${d.phase}] ${d.due_date} | ${d.external_key} | ${d.deadline_type} | ${d.issue_type || "n/a"} | ${d.title || "n/a"}`);
      if (d.notes) console.log(`  notes: ${d.notes}`);
    }
  }

  console.log("");
  if (!actions.length) console.log("No queued/blocked actions.");
  else {
    console.log("Actions:");
    for (const a of actions) {
      console.log(`- [phase ${a.phase}][${a.status}] ${a.external_key} | ${a.action_type} via ${a.channel} | ${a.issue_type || "n/a"} | due ${a.response_due_date || "n/a"}`);
    }
  }

  if (!CREATE_TASKS) return;
  const queued = await queueDueEchoTasks({ personId, limit: LIMIT });
  console.log("");
  console.log(`due_deadlines_seen: ${queued.due_rows}`);
  console.log(`echo_tasks_queued:  ${queued.tasks_queued}`);
}

main()
  .then(async () => { await pg.end(); })
  .catch(async (err) => {
    console.error("Fatal:", err.message);
    await pg.end();
    process.exit(1);
  });
