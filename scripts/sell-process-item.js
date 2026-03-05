#!/usr/bin/env node
"use strict";

require("dotenv").config();
const pg = require("../infra/postgres");
const {
  detectFlags,
  inferCategory,
  chooseChannels,
  computePrice,
  listingTemplate,
  canonicalTitle,
} = require("../control/sell/rules");

const args = process.argv.slice(2);
const getArg = (flag, fallback = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};

const ITEM_ID = getArg("--item-id", "");
const LIMIT = Math.max(1, Number(getArg("--limit", "20")) || 20);
const DRY_RUN = args.includes("--dry-run");

async function loadTargets() {
  if (ITEM_ID) {
    const { rows } = await pg.query(`SELECT * FROM sell_items WHERE id = $1`, [ITEM_ID]);
    return rows;
  }
  const { rows } = await pg.query(
    `SELECT *
       FROM sell_items
      WHERE status IN ('NEW', 'INGESTED', 'EXTRACTED', 'NEEDS_ID_INFO', 'NEEDS_LISTING_INFO')
      ORDER BY created_at ASC
      LIMIT $1`,
    [LIMIT]
  );
  return rows;
}

async function loadMedia(itemId) {
  const { rows } = await pg.query(
    `SELECT * FROM sell_item_media WHERE item_id = $1 ORDER BY created_at ASC`,
    [itemId]
  );
  return rows;
}

async function persistRun(itemId, stepName, status, detail, payload) {
  if (DRY_RUN) return;
  await pg.query(
    `INSERT INTO sell_pipeline_runs (item_id, step_name, status, detail, result_json)
     VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [itemId, stepName, status, detail || null, JSON.stringify(payload || {})]
  );
}

async function processItem(item) {
  const media = await loadMedia(item.id);
  const flags = detectFlags(item, media);
  const category = inferCategory(item, media);
  const pricing = computePrice(item, category);
  const channelsOut = chooseChannels(item, category, flags, pricing);
  const pricingWithMargins = {
    ...pricing,
    margin_by_channel: channelsOut.margin_by_channel || {},
  };
  const title = canonicalTitle(item, category);

  const blockedByMargin = (channelsOut.channels || []).length === 0;
  const foremanStatus = blockedByMargin
    ? "blocked"
    : (flags.includes("NEEDS_PHOTOS") || flags.includes("NEEDS_LABEL_PHOTO") ? "needs_info" : "approve");
  const questions = [];
  if (flags.includes("NEEDS_PHOTOS")) questions.push("Please upload at least 3 photos (front/back/label).");
  if (flags.includes("NEEDS_LABEL_PHOTO")) questions.push("Upload one close-up photo of model/brand label.");
  if (blockedByMargin) questions.push("Expected net margin is below floor for all channels. Adjust price/cost/shipping assumptions.");

  const listingPackets = channelsOut.channels.map((c) =>
    listingTemplate(item, c, category, pricingWithMargins, flags)
  );

  if (!DRY_RUN) {
    await pg.query("BEGIN");
    try {
      await pg.query(`DELETE FROM sell_listings WHERE item_id = $1 AND status = 'draft'`, [item.id]);
      for (const p of listingPackets) {
        await pg.query(
          `INSERT INTO sell_listings (item_id, channel, title, description, specifics_json, listing_packet_json, status)
           VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)`,
          [
            item.id,
            p.channel,
            p.title,
            p.description,
            JSON.stringify(p.specifics || {}),
            JSON.stringify(p.listing_packet_json || {}),
            foremanStatus === "approve" ? "ready_for_approval" : "draft",
          ]
        );
      }

      await pg.query(
        `UPDATE sell_items
            SET category = $2,
                channel_recommendations = $3::jsonb,
                flags = $4::jsonb,
                foreman_status = $5,
                next_questions = $6::jsonb,
                canonical_title = $7,
                list_price = $8,
                pricing_json = $9::jsonb,
                listing_json = $10::jsonb,
                status = $11,
                updated_at = NOW()
          WHERE id = $1`,
        [
          item.id,
          category,
          JSON.stringify(channelsOut),
          JSON.stringify(flags),
          foremanStatus,
          JSON.stringify(questions),
          title,
          pricing.list_price,
          JSON.stringify(pricingWithMargins),
          JSON.stringify({ channels: channelsOut.channels, generated_count: listingPackets.length }),
          foremanStatus === "approve" ? "READY_FOR_APPROVAL" : (foremanStatus === "blocked" ? "NEEDS_LISTING_INFO" : "NEEDS_LISTING_INFO"),
        ]
      );

      await persistRun(item.id, "rules_pipeline", "completed", "processed", {
        category,
        flags,
        channels: channelsOut.channels,
        pricing: pricingWithMargins,
        foreman_status: foremanStatus,
      });
      await pg.query("COMMIT");
    } catch (err) {
      await pg.query("ROLLBACK");
      await persistRun(item.id, "rules_pipeline", "failed", err.message, {});
      throw err;
    }
  }

  return {
    item_id: item.id,
    sku: item.sku,
    category,
    flags,
    channels: channelsOut.channels,
    list_price: pricing.list_price,
    status: foremanStatus === "approve" ? "READY_FOR_APPROVAL" : "NEEDS_LISTING_INFO",
  };
}

async function main() {
  await pg.connect();
  const targets = await loadTargets();
  console.log(`[sell-process-item] targets=${targets.length} dry_run=${DRY_RUN}`);
  const out = [];
  for (const t of targets) {
    try {
      const res = await processItem(t);
      out.push(res);
      console.log(`[sell-process-item] ${res.sku} category=${res.category} channels=${res.channels.join(",")} price=${res.list_price} status=${res.status}`);
    } catch (err) {
      console.error(`[sell-process-item] ${t.sku || t.id} failed: ${err.message}`);
    }
  }
  console.log(JSON.stringify({ processed: out.length, items: out }, null, 2));
}

main()
  .then(async () => { await pg.end(); })
  .catch(async (err) => {
    console.error(err.message || String(err));
    try { await pg.end(); } catch {}
    process.exit(1);
  });
