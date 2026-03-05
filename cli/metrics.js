// cli/metrics.js
// Print a live metrics snapshot.
//
// Usage:
//   node cli/metrics.js           — full snapshot
//   node cli/metrics.js --json    — machine-readable JSON

require("dotenv").config();
const { snapshot, byType, printReport } = require("../control/metrics");

async function main() {
  if (process.argv.includes("--json")) {
    const s = await snapshot();
    const t = await byType();
    console.log(JSON.stringify({ snapshot: s, byType: t }, null, 2));
  } else {
    await printReport();
  }
  process.exit(0);
}

main().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
