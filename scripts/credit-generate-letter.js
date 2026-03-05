#!/usr/bin/env node
"use strict";

require("dotenv").config();

const pg = require("../infra/postgres");
const { loadActionContext, buildDraft, ensureDraftForAction } = require("../control/credit/drafting");

const args = process.argv.slice(2);
const getArg = (flag, fallback = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};
const hasFlag = (flag) => args.includes(flag);

const ACTION_ID = getArg("--action-id");
const ISSUE_ID = getArg("--issue-id");
const TEMPLATE = getArg("--template");
const SAVE = hasFlag("--save");

async function loadContext() {
  if (ACTION_ID) {
    return loadActionContext(pg, ACTION_ID);
  }

  if (ISSUE_ID) {
    const { rows } = await pg.query(
      `SELECT NULL::uuid AS action_id, NULL::text AS action_type, NULL::text AS channel, i.person_id, i.id AS issue_id,
              p.full_name, p.current_address, i.issue_type, i.title, i.details,
              ci.account_ref, ci.furnisher_name, ci.creditor_type
       FROM credit_issues i
       JOIN credit_person_profiles p ON p.id = i.person_id
       LEFT JOIN credit_items ci ON ci.id = i.item_id
       WHERE i.id = $1
       LIMIT 1`,
      [ISSUE_ID]
    );
    if (!rows[0]) throw new Error(`issue_not_found:${ISSUE_ID}`);
    return rows[0];
  }

  throw new Error("Usage: --action-id <uuid> OR --issue-id <uuid> [--template bureau_dispute] [--save]");
}

async function main() {
  const ctx = await loadContext();
  const draft = buildDraft(ctx, TEMPLATE || null);
  let saveResult = null;
  if (SAVE && ctx.action_id) {
    saveResult = await ensureDraftForAction(pg, ctx.action_id, {
      templateKey: TEMPLATE || null,
      saveCorrespondence: true,
    });
  }

  console.log("\n=== Credit Letter Draft ===\n");
  console.log(`template: ${draft.template_key}`);
  console.log(`action_id: ${ctx.action_id || "(none)"}`);
  console.log(`issue_id: ${ctx.issue_id || "(none)"}`);
  console.log(`saved: ${SAVE ? "yes" : "no"}`);
  if (saveResult) {
    console.log(`letter_id: ${saveResult.letter_id}`);
    console.log(`drafted: ${saveResult.drafted ? "new" : "existing"}`);
  }
  console.log("\n" + draft.body);
}

main()
  .then(async () => { await pg.end(); })
  .catch(async (err) => {
    console.error("Fatal:", err.message);
    await pg.end();
    process.exit(1);
  });
