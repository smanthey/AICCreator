#!/usr/bin/env node
"use strict";

require("dotenv").config();

const pg = require("../infra/postgres");
const { setState, getStateMap } = require("../control/ip/pipeline-gate");

const args = process.argv.slice(2);
const getArg = (flag, fallback = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};

const KEY = getArg("--key", null);
const VALUE = getArg("--value", null);

async function main() {
  if (!KEY || VALUE == null) {
    const map = await getStateMap();
    console.log("[ip-mark-stage] current state:");
    for (const [k, v] of map.entries()) console.log(`- ${k}=${v}`);
    return;
  }

  const normalized = String(VALUE).toLowerCase();
  if (!["true", "false"].includes(normalized)) {
    throw new Error("--value must be true or false");
  }

  if (KEY === "paralegal_enabled" && normalized === "true") {
    const state = await getStateMap();
    const prereq = ["ingestion_complete", "parsing_complete", "tagging_complete", "categorization_complete"];
    const missing = prereq.filter((k) => state.get(k) !== "true");
    if (missing.length) {
      throw new Error(`Cannot enable paralegal until prior stages are true: ${missing.join(", ")}`);
    }

    const checks = await pg.query(
      `SELECT
         (SELECT COUNT(*) FROM ip_cases) AS cases_count,
         (SELECT COUNT(*) FROM ip_documents) AS docs_count`
    );
    const row = checks.rows[0] || {};
    const casesCount = Number(row.cases_count || 0);
    const docsCount = Number(row.docs_count || 0);
    if (casesCount === 0 || docsCount === 0) {
      throw new Error(
        `Cannot enable paralegal with empty pipeline data (cases=${casesCount}, docs=${docsCount}).`
      );
    }
  }

  await setState(KEY, normalized, { updated_by: "ip-mark-stage" });
  console.log(`[ip-mark-stage] ${KEY}=${normalized}`);
}

main()
  .then(async () => { await pg.end(); })
  .catch(async (err) => {
    console.error("Fatal:", err.message);
    await pg.end();
    process.exit(1);
  });
