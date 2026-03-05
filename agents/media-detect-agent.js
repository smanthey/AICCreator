"use strict";

const pg = require("../infra/postgres");
const { register } = require("./registry");

register("media_detect", async (payload = {}) => {
  const {
    limit = 5000,
    hostname,
  } = payload;

  const params = [];
  const where = ["(fi.mime LIKE 'image/%' OR fi.mime LIKE 'video/%' OR fi.mime LIKE 'audio/%')"];
  if (hostname) {
    params.push(hostname);
    where.push(`fi.hostname = $${params.length}`);
  }

  params.push(Math.min(Math.max(Number(limit) || 5000, 1), 50000));

  const summarySql = `
    SELECT
      COUNT(*)::int AS total_candidates,
      COUNT(*) FILTER (WHERE fi.mime LIKE 'image/%')::int AS image_candidates,
      COUNT(*) FILTER (WHERE fi.mime LIKE 'video/%')::int AS video_candidates,
      COUNT(*) FILTER (WHERE fi.mime LIKE 'audio/%')::int AS audio_candidates,
      COUNT(*) FILTER (
        WHERE NOT EXISTS (SELECT 1 FROM media_metadata mm WHERE mm.file_index_id = fi.id)
      )::int AS missing_metadata,
      COUNT(*) FILTER (
        WHERE NOT EXISTS (SELECT 1 FROM media_hashes mh WHERE mh.file_index_id = fi.id)
      )::int AS missing_hash
    FROM (
      SELECT fi.id, fi.mime
      FROM file_index fi
      WHERE ${where.join(" AND ")}
      ORDER BY fi.indexed_at DESC
      LIMIT $${params.length}
    ) fi
  `;

  const sampleParams = params.slice(0, -1);
  sampleParams.push(20);

  const sampleSql = `
    SELECT fi.id, fi.path, fi.mime, fi.hostname, fi.indexed_at
    FROM file_index fi
    WHERE ${where.join(" AND ")}
    ORDER BY fi.indexed_at DESC
    LIMIT $${sampleParams.length}
  `;

  const [{ rows: summaryRows }, { rows: sampleRows }] = await Promise.all([
    pg.query(summarySql, params),
    pg.query(sampleSql, sampleParams),
  ]);

  return {
    ...(summaryRows[0] || {}),
    sample: sampleRows,
    hostname: hostname || null,
    limit: params[params.length - 1],
    cost_usd: 0,
    model_used: "deterministic-media-detect",
  };
});
