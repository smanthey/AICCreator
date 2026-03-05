// cli/dead-letters.js
// Inspect dead-lettered tasks.
//
// Usage:
//   node cli/dead-letters.js           — last 50 dead-lettered tasks
//   node cli/dead-letters.js <plan-id> — dead letters for a specific plan

require("dotenv").config();
const pg = require("../infra/postgres");

async function main() {
  const planId = process.argv[2] || null;

  const { rows } = await pg.query(
    `SELECT
       t.id,
       t.type,
       t.title,
       t.retry_count,
       t.last_error,
       t.dead_lettered_at,
       t.dead_letter_reason,
       t.plan_id,
       p.goal
     FROM tasks t
     LEFT JOIN plans p ON p.id = t.plan_id
     WHERE t.status = 'DEAD_LETTER'
       ${planId ? "AND t.plan_id = $1" : ""}
     ORDER BY t.dead_lettered_at DESC
     LIMIT 50`,
    planId ? [planId] : []
  );

  if (!rows.length) {
    console.log("No dead-lettered tasks found.");
    process.exit(0);
  }

  console.log(`\n☠  Dead Letters (${rows.length})\n${"─".repeat(70)}`);

  for (const r of rows) {
    const when = r.dead_lettered_at
      ? new Date(r.dead_lettered_at).toISOString()
      : "unknown";
    console.log(`
ID:      ${r.id}
Type:    ${r.type}
Title:   ${r.title || "(none)"}
Plan:    ${r.plan_id} — ${(r.goal || "").slice(0, 60)}
Retries: ${r.retry_count}
Error:   ${r.last_error || r.dead_letter_reason || "(no error recorded)"}
When:    ${when}
${"─".repeat(70)}`);
  }

  process.exit(0);
}

main().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
