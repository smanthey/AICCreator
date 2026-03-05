#!/usr/bin/env node
"use strict";

const path = require("path");
const { spawnSync } = require("child_process");
const { Pool } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const db = new Pool({
  host: process.env.POSTGRES_HOST || process.env.CLAW_DB_HOST,
  port: parseInt(process.env.POSTGRES_PORT || process.env.CLAW_DB_PORT || "15432", 10),
  user: process.env.POSTGRES_USER || process.env.CLAW_DB_USER || "claw",
  password: process.env.POSTGRES_PASSWORD || process.env.CLAW_DB_PASSWORD,
  database: process.env.POSTGRES_DB || process.env.CLAW_DB_NAME || "claw_architect",
});

const BRAND = process.env.LEADGEN_BRAND_SLUG || "skynpatch";
const RATIO_FILE = path.join(__dirname, "../config/leadgen-send-ratio.json");
let ratioConfig = {};
try {
  if (require("fs").existsSync(RATIO_FILE)) {
    ratioConfig = JSON.parse(require("fs").readFileSync(RATIO_FILE, "utf8"));
  }
} catch (_) {}

const TARGET_LEADS = parseInt(
  process.env.LEAD_AUTOPILOT_TARGET_LEADS || (BRAND === "skynpatch" ? ratioConfig.skynpatch_target_leads : ratioConfig.bws_target_leads) || "500",
  10
);
const PER_QUERY_LIMIT = parseInt(process.env.LEAD_AUTOPILOT_QUERY_LIMIT || "30", 10);
const ENRICH_LIMIT = parseInt(process.env.LEAD_AUTOPILOT_ENRICH_LIMIT || "120", 10);
const SEND_MAX = parseInt(
  process.env.LEAD_AUTOPILOT_SEND_MAX || (BRAND === "skynpatch" ? ratioConfig.skynpatch_send_max : ratioConfig.bws_send_max) || "25",
  10
);
const DEFAULT_CITIES_BY_BRAND = {
  skynpatch: "Los Angeles, CA|Dallas, TX|Miami, FL|Chicago, IL|New York, NY|Atlanta, GA",
  blackwallstreetopoly: "Atlanta, GA|Houston, TX|Washington, DC|Nashville, TN",
};
const DEFAULT_QUERIES_BY_BRAND = {
  skynpatch: "health food store|gym supplement store|vitamin shop|wellness store",
  blackwallstreetopoly: "toy store|black owned boutique|hbcu shop",
};
const CITIES = String(process.env.LEAD_AUTOPILOT_CITIES || DEFAULT_CITIES_BY_BRAND[BRAND] || DEFAULT_CITIES_BY_BRAND.skynpatch)
  .split("|")
  .map((s) => s.trim())
  .filter(Boolean);
const QUERIES = String(process.env.LEAD_AUTOPILOT_QUERIES || DEFAULT_QUERIES_BY_BRAND[BRAND] || DEFAULT_QUERIES_BY_BRAND.skynpatch)
  .split("|")
  .map((s) => s.trim())
  .filter(Boolean);

const DRY_RUN = process.argv.includes("--dry-run");
const DAEMON_MODE = process.argv.includes("--daemon") || ["1", "true", "yes", "on"].includes(String(process.env.LEAD_AUTOPILOT_DAEMON || "").toLowerCase());
const INTERVAL_MIN = Math.max(5, parseInt(process.env.LEAD_AUTOPILOT_INTERVAL_MIN || "30", 10));
const SKIP_SCRAPE = process.argv.includes("--skip-scrape");
const SKIP_ENRICH = process.argv.includes("--skip-enrich");
const SKIP_SEND = process.argv.includes("--skip-send");
const SEND_DISABLED = process.argv.includes("--collect-only") || ["1", "true", "yes", "on"].includes(String(process.env.LEAD_AUTOPILOT_DISABLE_SEND || "").toLowerCase());
function lockKeyForBrand(brand) {
  let h = 2166136261;
  const s = String(brand || "default");
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const positive = (h >>> 0) % 2147483000;
  return 9100000 + positive;
}
const LOCK_KEY = lockKeyForBrand(BRAND);

function runNode(scriptName, args = []) {
  const full = path.join(__dirname, scriptName);
  const cmd = ["node", full, ...args];
  console.log(`\n[autopilot] $ ${cmd.join(" ")}`);
  if (DRY_RUN) return { status: 0 };
  const res = spawnSync("node", [full, ...args], {
    stdio: "inherit",
    env: process.env,
  });
  if (res.status !== 0) {
    throw new Error(`${scriptName} failed (${res.status})`);
  }
  return res;
}

async function getLeadStats() {
  const { rows } = await db.query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE website IS NOT NULL AND website <> '')::int AS with_website,
      COUNT(*) FILTER (WHERE email IS NOT NULL AND email <> '')::int AS with_email
    FROM leads
    WHERE brand_slug = COALESCE($1, brand_slug)
  `, [BRAND]);
  return rows[0];
}

async function acquireRunLock() {
  const { rows } = await db.query(`SELECT pg_try_advisory_lock($1) AS ok`, [LOCK_KEY]);
  return !!rows[0]?.ok;
}

async function releaseRunLock() {
  try {
    await db.query(`SELECT pg_advisory_unlock($1)`, [LOCK_KEY]);
  } catch (_) {}
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runCycle() {
  const acquired = await acquireRunLock();
  if (!acquired) {
    console.log("[autopilot] another lead-autopilot cycle is active; skipping this cycle");
    return;
  }
  try {
    console.log(`[autopilot] lead pipeline cycle started (brand=${BRAND})`);
    const pre = await getLeadStats();
    console.log(`[autopilot] leads total=${pre.total} website=${pre.with_website} email=${pre.with_email}`);

    if (!SKIP_SCRAPE && pre.total < TARGET_LEADS) {
      console.log(`[autopilot] below target (${TARGET_LEADS}), scraping...`);
      for (const city of CITIES) {
        for (const query of QUERIES) {
          try {
            runNode("google-maps-scraper.js", ["--query", query, "--city", city, "--limit", String(PER_QUERY_LIMIT)]);
          } catch (err) {
            console.error(`[autopilot] scrape failed (${query}, ${city}): ${err.message}`);
          }
        }
      }
    } else if (SKIP_SCRAPE) {
      console.log("[autopilot] scrape stage skipped by flag");
    } else {
      console.log("[autopilot] lead target met, skipping scrape stage");
    }

    if (!SKIP_ENRICH) {
      try {
        runNode("email-finder.js", ["--limit", String(ENRICH_LIMIT)]);
      } catch (err) {
        console.error(`[autopilot] enrich failed: ${err.message}`);
      }
    } else {
      console.log("[autopilot] enrich stage skipped by flag");
    }

    if (SEND_DISABLED) {
      console.log("[autopilot] send stage disabled (collect-only mode)");
    } else if (!SKIP_SEND) {
      try {
        const sendScript = BRAND === "blackwallstreetopoly" ? "blackwallstreetopoly-send-scheduler.js" : "daily-send-scheduler.js";
        runNode(sendScript, ["--max-sends", String(SEND_MAX)]);
      } catch (err) {
        console.error(`[autopilot] send stage failed: ${err.message}`);
      }
    } else {
      console.log("[autopilot] send stage skipped by flag");
    }

    runNode("lead-pipeline.js", ["--status"]);

    const post = await getLeadStats();
    console.log(`[autopilot] cycle done total=${post.total} website=${post.with_website} email=${post.with_email}`);
  } finally {
    await releaseRunLock();
  }
}

async function main() {
  if (!DAEMON_MODE) {
    await runCycle();
    return;
  }

  console.log(`[autopilot] daemon mode enabled (interval=${INTERVAL_MIN}m, dry_run=${DRY_RUN})`);
  while (true) {
    try {
      await runCycle();
    } catch (err) {
      console.error(`[autopilot] cycle fatal: ${err.message}`);
      await releaseRunLock();
    }
    await sleep(INTERVAL_MIN * 60 * 1000);
  }
}

main()
  .then(async () => {
    await db.end();
  })
  .catch(async (err) => {
    console.error("[autopilot] fatal:", err.message);
    await db.end();
    process.exit(1);
  });
