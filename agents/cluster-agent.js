// agents/cluster-agent.js
// Deterministic shoot clustering using metadata + perceptual hash distance.

"use strict";

const crypto = require("crypto");
const pg = require("../infra/postgres");
const { register } = require("./registry");

function toTs(v) {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

function hammingHex64(a, b) {
  if (!a || !b || a.length !== 16 || b.length !== 16) return null;
  let dist = 0;
  for (let i = 0; i < 16; i++) {
    const x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    dist += [0,1,1,2,1,2,2,3,1,2,2,3,2,3,3,4][x];
  }
  return dist;
}

function nearGps(aLat, aLon, bLat, bLon, delta = 0.02) {
  if ([aLat, aLon, bLat, bLon].some(v => v == null)) return true;
  return Math.abs(aLat - bLat) <= delta && Math.abs(aLon - bLon) <= delta;
}

function canJoin(row, cluster, cfg) {
  const ts = toTs(row.exif_datetime || row.indexed_at);
  if (!ts) return false;
  if (Math.abs(ts - cluster.lastTs) > cfg.timeWindowMs) return false;

  if (cluster.camera_model && row.camera_model && cluster.camera_model !== row.camera_model) return false;
  if (cluster.hostname && row.hostname && cluster.hostname !== row.hostname) return false;

  if (!nearGps(cluster.gps_lat, cluster.gps_lon, row.gps_lat, row.gps_lon, cfg.gpsDelta)) return false;

  // Hash distance check when available; missing hashes are tolerated.
  if (cluster.anchor_dhash && row.dhash_hex) {
    const d = hammingHex64(cluster.anchor_dhash, row.dhash_hex);
    if (d != null && d > cfg.hashThreshold) return false;
  }

  return true;
}

register("cluster_media", async (payload = {}) => {
  const {
    limit = 5000,
    hostname,
    dry_run = false,
    force = false,
    time_window_minutes = 90,
    hash_hamming_threshold = 12,
    gps_delta = 0.02,
  } = payload;

  const cfg = {
    timeWindowMs: Math.max(5, Number(time_window_minutes) || 90) * 60 * 1000,
    hashThreshold: Math.max(0, Number(hash_hamming_threshold) || 12),
    gpsDelta: Math.max(0, Number(gps_delta) || 0.02),
  };

  const params = [];
  const where = ["(fi.mime LIKE 'image/%' OR fi.mime LIKE 'video/%')"];

  if (hostname) {
    params.push(hostname);
    where.push(`fi.hostname = $${params.length}`);
  }

  if (!force) {
    where.push("NOT EXISTS (SELECT 1 FROM shoot_group_members sgm WHERE sgm.file_index_id = fi.id)");
  }

  params.push(Math.min(Math.max(Number(limit) || 5000, 1), 50000));

  const { rows } = await pg.query(
    `SELECT fi.id AS file_index_id, fi.hostname, fi.path, fi.indexed_at,
            mm.exif_datetime, mm.camera_make, mm.camera_model, mm.gps_lat, mm.gps_lon,
            mh.dhash_hex
       FROM file_index fi
       LEFT JOIN media_metadata mm ON mm.file_index_id = fi.id
       LEFT JOIN media_hashes   mh ON mh.file_index_id = fi.id
      WHERE ${where.join(" AND ")}
      ORDER BY COALESCE(mm.exif_datetime, fi.indexed_at) ASC
      LIMIT $${params.length}`,
    params
  );

  if (!rows.length) {
    return {
      scanned: 0,
      clusters_created: 0,
      memberships_written: 0,
      dry_run: !!dry_run,
      cost_usd: 0,
      model_used: "deterministic-cluster",
    };
  }

  // Optional force mode: clear memberships for selected files before reclustering.
  if (force && !dry_run) {
    const ids = rows.map(r => r.file_index_id);
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(",");
    await pg.query(`DELETE FROM shoot_group_members WHERE file_index_id IN (${placeholders})`, ids);
  }

  const clusters = [];
  for (const row of rows) {
    const ts = toTs(row.exif_datetime || row.indexed_at);
    if (!ts) continue;

    let matched = null;
    for (const c of clusters) {
      if (canJoin(row, c, cfg)) {
        matched = c;
        break;
      }
    }

    if (!matched) {
      matched = {
        id: crypto.randomUUID(),
        hostname: row.hostname || null,
        camera_make: row.camera_make || null,
        camera_model: row.camera_model || null,
        gps_lat: row.gps_lat ?? null,
        gps_lon: row.gps_lon ?? null,
        anchor_dhash: row.dhash_hex || null,
        startTs: ts,
        lastTs: ts,
        fileIds: [],
      };
      clusters.push(matched);
    } else {
      matched.lastTs = Math.max(matched.lastTs, ts);
      matched.startTs = Math.min(matched.startTs, ts);
      if (!matched.anchor_dhash && row.dhash_hex) matched.anchor_dhash = row.dhash_hex;
      if (!matched.camera_model && row.camera_model) matched.camera_model = row.camera_model;
      if (!matched.hostname && row.hostname) matched.hostname = row.hostname;
    }

    matched.fileIds.push(row.file_index_id);
  }

  const useful = clusters.filter(c => c.fileIds.length > 1);

  if (!dry_run) {
    for (const c of useful) {
      await pg.query(
        `INSERT INTO shoot_groups
           (id, hostname, camera_make, camera_model, gps_lat, gps_lon, start_at, end_at, files_count)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (id) DO NOTHING`,
        [
          c.id,
          c.hostname,
          c.camera_make,
          c.camera_model,
          c.gps_lat,
          c.gps_lon,
          new Date(c.startTs).toISOString(),
          new Date(c.lastTs).toISOString(),
          c.fileIds.length,
        ]
      );

      for (const fid of c.fileIds) {
        await pg.query(
          `INSERT INTO shoot_group_members (shoot_group_id, file_index_id)
           VALUES ($1,$2)
           ON CONFLICT (file_index_id) DO UPDATE SET shoot_group_id = EXCLUDED.shoot_group_id`,
          [c.id, fid]
        );
      }
    }
  }

  return {
    scanned: rows.length,
    clusters_built: clusters.length,
    clusters_created: useful.length,
    memberships_written: useful.reduce((n, c) => n + c.fileIds.length, 0),
    dry_run: !!dry_run,
    params: {
      time_window_minutes: time_window_minutes,
      hash_hamming_threshold: hash_hamming_threshold,
      gps_delta,
      force: !!force,
      limit,
      hostname: hostname || null,
    },
    cost_usd: 0,
    model_used: "deterministic-cluster",
  };
});
