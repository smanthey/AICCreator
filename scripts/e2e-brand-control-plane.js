#!/usr/bin/env node
"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const BASE = `http://127.0.0.1:${process.env.BRAND_CONTROL_PORT || 4050}`;

function fail(msg) {
  console.error(`[e2e:brand-control] FAIL ${msg}`);
  process.exit(1);
}

async function getJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { res, json, text };
}

async function main() {
  const health = await getJson(`${BASE}/healthz`);
  if (!health.res.ok || !health.json?.ok) fail(`healthz bad response: ${health.res.status} ${health.text}`);

  const body = {
    name: `E2E Brand ${Date.now()}`,
    primary_domain: "skynpatch.com",
    sending_subdomain: "mail",
    default_from_name: "SkyPatch Wholesale",
    default_from_email: "wholesale@skynpatch.com",
    dns: { provider: "cloudflare", zone_id: "e2e-zone" },
  };
  const create = await getJson(`${BASE}/v1/brands`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (create.res.status !== 202 || !create.json?.brand_id) {
    fail(`POST /v1/brands invalid: ${create.res.status} ${create.text}`);
  }
  const brandId = create.json.brand_id;
  if (!create.json?.install?.public_key || !create.json?.install?.script) {
    fail("install snippet missing from create response");
  }

  await new Promise((r) => setTimeout(r, 2000));
  const status = await getJson(`${BASE}/v1/brands/${brandId}/status`);
  if (!status.res.ok) fail(`GET status failed: ${status.res.status} ${status.text}`);
  if (!status.json?.brand?.id || status.json.brand.id !== brandId) fail("status brand mismatch");
  if (!Array.isArray(status.json?.provisioning_tasks)) fail("status provisioning_tasks missing");
  if (!status.json?.install?.public_key) fail("status install public_key missing");

  console.log(
    JSON.stringify(
      {
        ok: true,
        brand_id: brandId,
        provisioning_status: status.json.brand.provisioning_status,
        provisioning_tasks: status.json.provisioning_tasks.length,
      },
      null,
      2
    )
  );
}

main().catch((err) => fail(err.message || String(err)));

