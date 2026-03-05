#!/usr/bin/env node
"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const pg = require("../infra/postgres");

function parseArgs(argv) {
  const out = { brand: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--brand") {
      out.brand = argv[i + 1] || null;
      i += 1;
    }
  }
  return out;
}

const FLOW_PACK = [
  {
    name: "welcome_v1",
    trigger: "customer.created",
    definition: {
      pack: "core_v1_welcome_order_ops",
      steps: [
        { type: "email", template: "welcome_primary" },
        { type: "wait", minutes: 1440 },
        { type: "email", template: "welcome_followup_prefs" },
      ],
    },
  },
  {
    name: "order_confirm_v1",
    trigger: "order.completed",
    definition: {
      pack: "core_v1_welcome_order_ops",
      steps: [
        { type: "email", template: "order_confirmation" },
      ],
    },
  },
  {
    name: "ops_wholesale_notify_v1",
    trigger: "order.completed",
    definition: {
      pack: "core_v1_welcome_order_ops",
      steps: [
        { type: "email", template: "ops_wholesale_order_notify", to: "shop@skynpatch.com" },
      ],
    },
  },
];

async function getBrandId(key) {
  const { rows } = await pg.query(
    `SELECT id, slug, name
       FROM brands
      WHERE id::text = $1 OR slug = $1
      LIMIT 1`,
    [key]
  );
  return rows[0] || null;
}

async function upsertFlow(brandId, flow) {
  const { rows } = await pg.query(
    `INSERT INTO flows (brand_id, name, trigger, definition_json, status, updated_at)
     VALUES ($1,$2,$3,$4,'active',NOW())
     ON CONFLICT (brand_id, name) DO UPDATE SET
       trigger = EXCLUDED.trigger,
       definition_json = EXCLUDED.definition_json,
       status = 'active',
       updated_at = NOW()
     RETURNING id, name, trigger, status`,
    [brandId, flow.name, flow.trigger, flow.definition]
  );
  return rows[0];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const brandKey = args.brand || process.env.BRAND_SLUG || "skynpatch";
  const brand = await getBrandId(brandKey);
  if (!brand) throw new Error(`Brand not found: ${brandKey}`);

  const seeded = [];
  for (const flow of FLOW_PACK) {
    seeded.push(await upsertFlow(brand.id, flow));
  }
  console.log(JSON.stringify({
    brand: { id: brand.id, slug: brand.slug, name: brand.name },
    flow_pack: "core_v1_welcome_order_ops",
    seeded,
  }, null, 2));
}

main()
  .catch((err) => {
    console.error(`[flow:seed:core] failed: ${err.message}`);
    process.exit(1);
  })
  .finally(async () => {
    await pg.end().catch(() => {});
  });

