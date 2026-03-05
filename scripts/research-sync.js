#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const https = require("https");
const { Pool } = require("pg");

require("dotenv").config({ path: path.join(__dirname, "../.env") });

const ARGS = process.argv.slice(2);
const LIMIT_PER_SOURCE = parseInt(getArg("--limit", "25"), 10);
const DAYS = parseInt(getArg("--days", "30"), 10);
const DRY_RUN = ARGS.includes("--dry-run");
const DOMAIN = getArg("--domain", null);

const CONFIG_PATH = path.join(__dirname, "../config/research-domains.json");
const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));

const pool = new Pool({
  host: process.env.POSTGRES_HOST,
  port: parseInt(process.env.POSTGRES_PORT || "5432", 10),
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
});

function getArg(flag, fallback) {
  const idx = ARGS.indexOf(flag);
  if (idx < 0 || idx + 1 >= ARGS.length) return fallback;
  return ARGS[idx + 1];
}

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const headers = {
      "User-Agent": "claw-research-monitor/1.0",
      "Accept": "application/json",
    };
    if (process.env.GITHUB_TOKEN && u.hostname === "api.github.com") {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }
    const req = https.get(url, { headers }, (res) => {
      let data = "";
      res.on("data", (d) => (data += d));
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`HTTP ${res.statusCode} ${url}`));
        }
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(new Error(`JSON parse error for ${url}: ${err.message}`));
        }
      });
    });
    req.setTimeout(15000, () => req.destroy(new Error(`timeout ${url}`)));
    req.on("error", reject);
  });
}

function httpGetText(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "claw-research-monitor/1.0" } }, (res) => {
      let data = "";
      res.on("data", (d) => (data += d));
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`HTTP ${res.statusCode} ${url}`));
        }
        resolve(data);
      });
    });
    req.setTimeout(15000, () => req.destroy(new Error(`timeout ${url}`)));
    req.on("error", reject);
  });
}

function parseRssItems(xml) {
  const items = [];
  const matches = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  for (const block of matches) {
    const title = stripTag(extractTag(block, "title") || "");
    const link = stripTag(extractTag(block, "link") || "");
    const pubDateRaw = stripTag(extractTag(block, "pubDate") || "");
    const description = stripTag(extractTag(block, "description") || "");
    const content = stripTag(extractTag(block, "content:encoded") || "");
    const publishedAt = parseDate(pubDateRaw);
    if (!title || !link) continue;
    items.push({
      title,
      url: link,
      published_at: publishedAt,
      raw_content: [description, content].filter(Boolean).join("\n"),
      vendor_version: extractVersion(title) || extractVersion(content),
    });
  }
  return items;
}

function extractTag(block, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = block.match(re);
  return m ? m[1] : null;
}

function stripTag(s) {
  return String(s).replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function parseDate(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function extractVersion(txt) {
  if (!txt) return null;
  const m = String(txt).match(/\bv?\d+\.\d+(\.\d+)?\b/);
  return m ? m[0] : null;
}

function hashEntry(title, url, rawContent) {
  return crypto.createHash("sha256").update(`${title}|${url}|${rawContent || ""}`).digest("hex");
}

function isFresh(iso, days) {
  if (!iso) return true;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return true;
  return Date.now() - t <= days * 86400000;
}

async function ensureSource(domainKey, source) {
  const q = await pool.query(
    `INSERT INTO external_update_sources (domain_key, source_name, source_type, source_url, enabled)
     VALUES ($1,$2,$3,$4,true)
     ON CONFLICT (domain_key, source_url)
     DO UPDATE SET source_name=EXCLUDED.source_name, source_type=EXCLUDED.source_type, updated_at=NOW()
     RETURNING id`,
    [domainKey, source.name, source.type, source.url]
  );
  return q.rows[0].id;
}

async function insertUpdate(sourceId, domainKey, row) {
  const hash = hashEntry(row.title, row.url, row.raw_content);
  if (DRY_RUN) return { inserted: false, hash };
  const q = await pool.query(
    `INSERT INTO external_updates (source_id, domain_key, title, url, published_at, raw_content, content_hash, vendor_version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (source_id, content_hash) DO NOTHING
     RETURNING id`,
    [sourceId, domainKey, row.title, row.url, row.published_at, row.raw_content || "", hash, row.vendor_version || null]
  );
  return { inserted: q.rowCount > 0, hash };
}

async function fetchBySource(source) {
  if (source.type === "github_releases") {
    const data = await httpGetJson(source.url);
    const rows = Array.isArray(data) ? data : [];
    return rows.slice(0, LIMIT_PER_SOURCE).map((r) => ({
      title: r.name || r.tag_name || "release",
      url: r.html_url || source.url,
      published_at: r.published_at || r.created_at || null,
      raw_content: `${r.body || ""}`.slice(0, 12000),
      vendor_version: r.tag_name || extractVersion(r.name || ""),
    }));
  }
  if (source.type === "rss" || source.type === "changelog") {
    const xml = await httpGetText(source.url);
    return parseRssItems(xml).slice(0, LIMIT_PER_SOURCE);
  }
  return [];
}

async function main() {
  const domains = (cfg.domains || []).filter((d) => !DOMAIN || d.key === DOMAIN);
  let totalFetched = 0;
  let totalInserted = 0;
  let totalSources = 0;

  for (const domain of domains) {
    for (const source of domain.sources || []) {
      totalSources += 1;
      const sourceId = await ensureSource(domain.key, source);
      let rows = [];
      try {
        rows = await fetchBySource(source);
      } catch (err) {
        console.warn(`[research-sync] ${domain.key}/${source.name} fetch failed: ${err.message}`);
        continue;
      }
      rows = rows.filter((r) => isFresh(r.published_at, DAYS));
      totalFetched += rows.length;
      let inserted = 0;
      for (const row of rows) {
        const res = await insertUpdate(sourceId, domain.key, row);
        if (res.inserted) inserted += 1;
      }
      totalInserted += inserted;
      console.log(`[research-sync] ${domain.key}/${source.name} fetched=${rows.length} inserted=${inserted}`);
    }
  }

  console.log(`[research-sync] sources=${totalSources} fetched=${totalFetched} inserted=${totalInserted} dry_run=${DRY_RUN}`);
  await pool.end();
}

main().catch(async (err) => {
  console.error("[research-sync] fatal:", err.message);
  await pool.end();
  process.exit(1);
});
