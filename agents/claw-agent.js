// agents/claw-agent.js
// Bridges the claw file-indexer DB into Architect plans.
// Lets the planner trigger file searches against the indexed library.
//
// Task types registered here:
//   claw_search  — full-text / filter search over indexed files
//   claw_stats   — summary stats about the indexed library
//   claw_recent  — recently added files (for "what's new" queries)
//
// The `claw` DB is written by the ~/claw repo's indexer.
// Canonical table in this stack: file_index

const { pool: clawDb, ping } = require("../infra/claw-db");
const { register } = require("./registry");

// ── claw_search ───────────────────────────────────────────────────
// Search indexed files by path fragment, extension, size range.
//
// Payload:
//   { query: "vacation 2022" }           — path contains phrase
//   { ext: "jpg", min_size_mb: 1 }       — filter by extension + size
//   { query: "...", limit: 50 }          — default limit: 100
register("claw_search", async (payload) => {
  const status = await ping();
  if (!status.ok) throw new Error(`Claw DB unavailable: ${status.error}`);

  const query       = payload?.query       || "";
  const extFilter   = payload?.ext         || null;
  const minSizeMb   = payload?.min_size_mb || null;
  const maxSizeMb   = payload?.max_size_mb || null;
  const limit       = Math.min(payload?.limit || 100, 1000);

  const conditions = [];
  const params     = [];
  let   paramIdx   = 1;

  if (query) {
    conditions.push(`path ILIKE $${paramIdx++}`);
    params.push(`%${query}%`);
  }
  if (extFilter) {
    conditions.push(`ext = $${paramIdx++}`);
    params.push(extFilter.toLowerCase().replace(/^\./, ""));
  }
  if (minSizeMb !== null) {
    conditions.push(`size_bytes >= $${paramIdx++}`);
    params.push(minSizeMb * 1024 * 1024);
  }
  if (maxSizeMb !== null) {
    conditions.push(`size_bytes <= $${paramIdx++}`);
    params.push(maxSizeMb * 1024 * 1024);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(limit);

  const { rows } = await clawDb.query(
    `SELECT id, path, name AS filename, ext, size_bytes, sha256, category, brand, indexed_at
     FROM file_index
     ${where}
     ORDER BY indexed_at DESC
     LIMIT $${paramIdx}`,
    params
  );

  console.log(`[claw_search] query="${query}" ext=${extFilter} → ${rows.length} results`);

  return {
    files:      rows,
    count:      rows.length,
    query,
    cost_usd:   0,
    model_used: "local-claw-search",
  };
});

// ── claw_stats ────────────────────────────────────────────────────
// Summary stats about the indexed library.
// Payload: {} (no params needed)
register("claw_stats", async () => {
  const status = await ping();
  if (!status.ok) throw new Error(`Claw DB unavailable: ${status.error}`);

  const { rows: total }     = await clawDb.query(`SELECT COUNT(*) AS n, SUM(size_bytes) AS bytes FROM file_index`);
  const { rows: byExt }     = await clawDb.query(
    `SELECT ext, COUNT(*) AS n, SUM(size_bytes) AS bytes
     FROM file_index GROUP BY ext ORDER BY n DESC LIMIT 20`
  );
  const { rows: recentDay } = await clawDb.query(
    `SELECT COUNT(*) AS n FROM file_index WHERE indexed_at > NOW() - INTERVAL '24 hours'`
  );

  const totalFiles = parseInt(total[0]?.n || 0);
  const totalBytes = parseInt(total[0]?.bytes || 0);

  return {
    total_files:     totalFiles,
    total_gb:        (totalBytes / 1024 / 1024 / 1024).toFixed(2),
    indexed_last_24h: parseInt(recentDay[0]?.n || 0),
    by_extension:    byExt.map(r => ({
      ext:        r.ext,
      count:      parseInt(r.n),
      size_mb:    Math.round(parseInt(r.bytes) / 1024 / 1024),
    })),
    cost_usd:   0,
    model_used: "local-claw-stats",
  };
});

// ── claw_recent ───────────────────────────────────────────────────
// Recently indexed files — useful for "what was added today" queries.
// Payload: { hours: 24, limit: 50 }
register("claw_recent", async (payload) => {
  const status = await ping();
  if (!status.ok) throw new Error(`Claw DB unavailable: ${status.error}`);

  const hours = payload?.hours || 24;
  const limit = Math.min(payload?.limit || 50, 500);

  const { rows } = await clawDb.query(
    `SELECT id, path, name AS filename, ext, size_bytes, category, brand, indexed_at
     FROM file_index
     WHERE indexed_at > NOW() - INTERVAL '${parseInt(hours)} hours'
     ORDER BY indexed_at DESC
     LIMIT $1`,
    [limit]
  );

  return {
    files:      rows,
    count:      rows.length,
    hours_back: hours,
    cost_usd:   0,
    model_used: "local-claw-recent",
  };
});
