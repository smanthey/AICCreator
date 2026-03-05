"use strict";

const { loadTemplate, fillTemplate, templateForAction } = require("./templates");

async function loadActionContext(db, actionId) {
  const { rows } = await db.query(
    `SELECT a.id AS action_id, a.action_type, a.channel, a.person_id, a.issue_id,
            p.full_name, p.current_address, i.issue_type, i.title, i.details,
            ci.account_ref, ci.furnisher_name, ci.creditor_type
     FROM credit_actions a
     JOIN credit_person_profiles p ON p.id = a.person_id
     LEFT JOIN credit_issues i ON i.id = a.issue_id
     LEFT JOIN credit_items ci ON ci.id = i.item_id
     WHERE a.id = $1
     LIMIT 1`,
    [actionId]
  );
  if (!rows[0]) throw new Error(`action_not_found:${actionId}`);
  return rows[0];
}

function buildVars(ctx) {
  return {
    bureau_name: "Credit Bureau",
    account_number: ctx.account_ref || "Unknown Account",
    furnisher: ctx.furnisher_name || ctx.creditor_type || "Unknown Furnisher",
    issue_type: ctx.issue_type || "issue_review",
    field_name: ctx.title || "reported field",
    evidence_list: "- (attach statements and supporting records)",
    collector_name: ctx.furnisher_name || "Collection Agency",
    original_creditor: ctx.creditor_type || "Unknown Creditor",
    request_items: [
      "- Complete account-level payment history and status timeline",
      "- Full transfer/assignment chain with dates",
      "- Name/address of current legal owner/furnisher",
      "- Signed application or contract bearing my signature (if asserted)",
    ].join("\n"),
  };
}

function buildDraft(ctx, templateKey = null) {
  const tk = templateKey || templateForAction(ctx.action_type);
  const template = loadTemplate(tk);
  const vars = buildVars(ctx);
  const body = fillTemplate(template, vars);
  const subject = `[${tk}] ${ctx.issue_type || "credit_issue"} - ${ctx.account_ref || "account"}`;
  return { template_key: tk, subject, body, variables: vars };
}

async function ensureDraftForAction(db, actionId, opts = {}) {
  const ctx = await loadActionContext(db, actionId);
  const draft = buildDraft(ctx, opts.templateKey || null);

  const { rows: existingRows } = await db.query(
    `SELECT id, version
     FROM credit_letters
     WHERE action_id = $1
       AND template_key = $2
     ORDER BY version DESC, created_at DESC
     LIMIT 1`,
    [actionId, draft.template_key]
  );
  if (existingRows[0]) {
    return {
      drafted: false,
      existing: true,
      letter_id: existingRows[0].id,
      version: existingRows[0].version,
      template_key: draft.template_key,
    };
  }

  const { rows: versionRows } = await db.query(
    `SELECT COALESCE(MAX(version), 0)::int + 1 AS next_version
     FROM credit_letters
     WHERE action_id = $1`,
    [actionId]
  );
  const nextVersion = Number(versionRows[0]?.next_version || 1);

  const { rows: inserted } = await db.query(
    `INSERT INTO credit_letters
       (person_id, issue_id, action_id, letter_type, template_key, version, subject, body_text, body_hash, variables_json)
     VALUES
       ($1,$2,$3,$4,$5,$6,$7,$8,md5($8),$9::jsonb)
     RETURNING id, version`,
    [
      ctx.person_id,
      ctx.issue_id || null,
      ctx.action_id,
      "generated",
      draft.template_key,
      nextVersion,
      draft.subject,
      draft.body,
      JSON.stringify(draft.variables),
    ]
  );

  if (opts.saveCorrespondence !== false) {
    await db.query(
      `INSERT INTO credit_correspondence
         (action_id, issue_id, person_id, channel, subject, body_text, attachments_json, sent_at)
       VALUES
         ($1,$2,$3,$4,$5,$6,'[]'::jsonb,NULL)`,
      [
        ctx.action_id,
        ctx.issue_id || null,
        ctx.person_id,
        ctx.channel === "bureau" ? "mail" : "internal",
        draft.subject,
        draft.body,
      ]
    );
  }

  return {
    drafted: true,
    existing: false,
    letter_id: inserted[0].id,
    version: inserted[0].version,
    template_key: draft.template_key,
  };
}

module.exports = {
  loadActionContext,
  buildDraft,
  ensureDraftForAction,
};
