#!/usr/bin/env node
"use strict";

require("dotenv").config();

const path = require("path");
const pg = require("../infra/postgres");
const { ingestFolderForPerson, attachEvidence, refreshOpenIssuesForPerson } = require("../control/credit/evidence");

const args = process.argv.slice(2);
const getArg = (flag, fallback = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};
const hasFlag = (flag) => args.includes(flag);

const PERSON_KEY = getArg("--person-key", "");
const FOLDER = getArg("--folder", "");
const FILE = getArg("--file", "");
const TYPE = getArg("--type", "");
const ISSUE_ID = getArg("--issue-id", null);
const DRY_RUN = hasFlag("--dry-run");

async function resolvePersonId(personKey) {
  const { rows } = await pg.query(`SELECT id FROM credit_person_profiles WHERE external_key = $1 LIMIT 1`, [personKey]);
  if (!rows[0]) throw new Error(`person_not_found:${personKey}`);
  return rows[0].id;
}

async function main() {
  if (!PERSON_KEY) {
    throw new Error("Usage: --person-key <key> [--folder <dir> | --file <path> --type <evidence_type>] [--issue-id <uuid>] [--dry-run]");
  }
  if (!FOLDER && !FILE) {
    throw new Error("Provide --folder or --file");
  }

  const personId = await resolvePersonId(PERSON_KEY);
  let attached = 0;
  let scanned = 0;

  if (FOLDER) {
    const abs = path.resolve(FOLDER);
    if (DRY_RUN) {
      console.log(`[credit-attach-evidence] dry-run folder=${abs}`);
    } else {
      const res = await ingestFolderForPerson(personId, abs, TYPE || null);
      scanned += res.scanned;
      attached += res.attached;
    }
  }

  if (FILE) {
    if (!TYPE) throw new Error("--type is required when using --file");
    if (DRY_RUN) {
      console.log(`[credit-attach-evidence] dry-run file=${path.resolve(FILE)} type=${TYPE}`);
    } else {
      const row = await attachEvidence({
        personId,
        issueId: ISSUE_ID || null,
        evidenceType: TYPE,
        filePath: FILE,
        notes: "manual attach",
        metadata: { source: "manual_cli" },
      });
      if (row) attached += 1;
      scanned += 1;
    }
  }

  let refreshed = { updated: 0, issues: 0 };
  if (!DRY_RUN) {
    refreshed = await refreshOpenIssuesForPerson(personId);
  }

  console.log("\n=== Credit Attach Evidence ===\n");
  console.log(`person_key: ${PERSON_KEY}`);
  console.log(`scanned:    ${scanned}`);
  console.log(`attached:   ${attached}`);
  console.log(`issues_refreshed: ${refreshed.updated}/${refreshed.issues}`);
  console.log(`dry_run:    ${DRY_RUN ? "yes" : "no"}`);
}

main()
  .then(async () => { await pg.end(); })
  .catch(async (err) => {
    console.error("Fatal:", err.message);
    try { await pg.end(); } catch {}
    process.exit(1);
  });

