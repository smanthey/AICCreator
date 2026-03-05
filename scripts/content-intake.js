#!/usr/bin/env node
/**
 * content-intake.js — content:intake CLI hook
 * ─────────────────────────────────────────────────────────────────────────────
 * Creates a content_brief row and queues the first draft generation task.
 *
 * Usage:
 *   node scripts/content-intake.js \
 *     --brand skynpatch \
 *     --channel email \
 *     --topic "Spring wholesale offer for health stores" \
 *     --audience "B2B health store buyers" \
 *     --tone "professional, direct" \
 *     --goal "drive store trials of SkynPatch patches" \
 *     --keywords "wellness,patches,wholesale" \
 *     --publish-at "2026-03-15T09:00:00-07:00"
 *
 *   Or pipe a JSON brief:
 *   echo '{"brand_slug":"skynpatch","channel":"email","topic":"..."}' | \
 *     node scripts/content-intake.js --stdin
 */
"use strict";

const { Pool }  = require("pg");
const { v4: uuidv4 } = require("uuid");
const path      = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const dbHost = process.env.POSTGRES_HOST || process.env.CLAW_DB_HOST;
const dbPort = parseInt(process.env.POSTGRES_PORT || process.env.CLAW_DB_PORT || "15432", 10);
const dbUser = process.env.POSTGRES_USER || process.env.CLAW_DB_USER || "claw";
const dbPass = process.env.POSTGRES_PASSWORD || process.env.CLAW_DB_PASSWORD;
const dbName = process.env.POSTGRES_DB || process.env.CLAW_DB_NAME || "claw_architect";

const pool = new Pool({ host: dbHost, port: dbPort, user: dbUser, password: dbPass, database: dbName });

// ── Arg parsing ───────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
  };
  const has = (flag) => args.includes(flag);

  return {
    stdin:         has("--stdin"),
    brandSlug:     get("--brand"),
    channel:       get("--channel"),
    topic:         get("--topic"),
    audience:      get("--audience"),
    tone:          get("--tone"),
    goal:          get("--goal"),
    keywords:      get("--keywords"),  // comma-separated
    publishAt:     get("--publish-at"),
    maxWords:      get("--max-words") ? parseInt(get("--max-words"), 10) : null,
    dryRun:        has("--dry-run"),
  };
}

async function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(JSON.parse(data)));
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();
  let brief;

  if (opts.stdin) {
    brief = await readStdin();
  } else {
    if (!opts.brandSlug || !opts.channel || !opts.topic) {
      console.error("❌ Required: --brand, --channel, --topic  (or --stdin with JSON)");
      process.exit(1);
    }
    brief = {
      brand_slug:      opts.brandSlug,
      channel:         opts.channel,
      topic:           opts.topic,
      target_audience: opts.audience,
      tone:            opts.tone,
      goal:            opts.goal,
      keywords:        opts.keywords ? opts.keywords.split(",").map((k) => k.trim()) : [],
      publish_at:      opts.publishAt,
      max_length_words: opts.maxWords,
    };
  }

  // Resolve brand_id
  const { rows: brands } = await pool.query(
    "SELECT id FROM brands WHERE slug = $1 LIMIT 1",
    [brief.brand_slug]
  );
  if (!brands.length) {
    console.error(`❌ Brand not found: ${brief.brand_slug}`);
    process.exit(1);
  }
  const brandId = brands[0].id;

  // Validate channel
  const validChannels = ["email","sms","blog","instagram","linkedin","push_notification"];
  if (!validChannels.includes(brief.channel)) {
    console.error(`❌ Invalid channel: ${brief.channel}. Valid: ${validChannels.join(", ")}`);
    process.exit(1);
  }

  if (opts.dryRun) {
    console.log("── DRY RUN — would create brief:");
    console.log(JSON.stringify({ ...brief, brand_id: brandId }, null, 2));
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Insert brief
    const { rows: [briefRow] } = await client.query(`
      INSERT INTO content_briefs (
        brand_id, channel, topic, target_audience, tone,
        keywords, goal, publish_at, max_length_words, created_by, status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending')
      RETURNING id, topic, channel, status
    `, [
      brandId,
      brief.channel,
      brief.topic,
      brief.target_audience || null,
      brief.tone || null,
      brief.keywords?.length ? brief.keywords : null,
      brief.goal || null,
      brief.publish_at || null,
      brief.max_length_words || null,
      "cli",
    ]);

    // Queue draft generation task
    const { rows: [taskRow] } = await client.query(`
      INSERT INTO tasks (type, payload, status, worker_tag, priority)
      VALUES ('content_draft_generate', $1, 'pending', 'content', 50)
      RETURNING id
    `, [JSON.stringify({ brief_id: briefRow.id, brand_slug: brief.brand_slug, variant_number: 1 })]);

    // Link task to brief
    await client.query(
      "UPDATE content_briefs SET task_id = $1, status = 'in_draft' WHERE id = $2",
      [taskRow.id, briefRow.id]
    );

    await client.query("COMMIT");

    console.log(`✅ Brief created`);
    console.log(`   Brief ID : ${briefRow.id}`);
    console.log(`   Topic    : ${briefRow.topic}`);
    console.log(`   Channel  : ${briefRow.channel}`);
    console.log(`   Task ID  : ${taskRow.id}  (content_draft_generate queued)`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("❌ Fatal:", err.message);
  process.exit(1);
});
