#!/usr/bin/env node
"use strict";

require("dotenv").config();

const pg = require("../infra/postgres");
const { assertParalegalReady } = require("../control/ip/pipeline-gate");

const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const FORCE = hasFlag("--force");
const LIMIT = (() => {
  const i = args.indexOf("--limit");
  return i >= 0 ? Math.max(1, Number(args[i + 1]) || 30) : 30;
})();

async function main() {
  const gate = await assertParalegalReady({ force: FORCE });
  if (gate.failed.length) {
    console.warn(`[ip-next-actions] FORCE override enabled; missing gates: ${gate.failed.join(", ")}`);
  }

  const { rows: deadlines } = await pg.query(
    `SELECT d.id, d.deadline_type, d.due_date, d.notes,
            c.case_key, c.primary_mark_text, c.serial_number, c.status AS case_status
     FROM ip_deadlines d
     JOIN ip_cases c ON c.id = d.case_id
     WHERE d.status = 'open'
     ORDER BY d.due_date ASC
     LIMIT $1`,
    [LIMIT]
  );

  const { rows: issues } = await pg.query(
    `SELECT i.id, i.issue_type, i.severity, i.status,
            c.case_key, c.primary_mark_text, c.serial_number
     FROM ip_issues i
     JOIN ip_cases c ON c.id = i.case_id
     WHERE i.status = 'open'
     ORDER BY CASE i.severity WHEN 'blocker' THEN 1 WHEN 'warn' THEN 2 ELSE 3 END, i.created_at DESC
     LIMIT $1`,
    [LIMIT]
  );

  console.log("\n=== IP Next Actions ===\n");

  if (!deadlines.length) {
    console.log("No open deadlines found.");
  } else {
    console.log("Deadlines:");
    for (const d of deadlines) {
      console.log(`- ${d.due_date} | ${d.deadline_type} | ${d.case_key || d.serial_number || 'unlinked'} | ${d.primary_mark_text || 'n/a'}`);
      if (d.notes) console.log(`  notes: ${d.notes}`);
    }
  }

  console.log("");

  if (!issues.length) {
    console.log("No open issues found.");
  } else {
    console.log("Open Issues:");
    for (const i of issues) {
      console.log(`- [${i.severity}] ${i.issue_type} | ${i.case_key || i.serial_number || 'unlinked'} | ${i.primary_mark_text || 'n/a'}`);
    }
  }

  console.log("\n(Paralegal output is checklist/draft support only; final filing remains manual in TEAS/TEASi.)");
}

main()
  .then(async () => { await pg.end(); })
  .catch(async (err) => {
    console.error("Fatal:", err.message);
    await pg.end();
    process.exit(1);
  });
