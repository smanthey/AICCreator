#!/usr/bin/env node
/**
 * fetch-leads-runner.js
 * ──────────────────────────────────────────────────────────────────────────
 * Standalone script to fetch B2B leads from Google Places API and store
 * them in the leads table. Calls the same logic as the leadgen-agent but
 * runs directly from terminal without needing the full worker stack.
 *
 * Usage:
 *   node scripts/fetch-leads-runner.js                               # Phoenix AZ (uses hardcoded coords)
 *   node scripts/fetch-leads-runner.js --location "Tempe, AZ"        # tries geocoding first
 *   node scripts/fetch-leads-runner.js --lat 33.4484 --lng -112.0740 # bypass geocoding entirely
 *   node scripts/fetch-leads-runner.js --category "yoga studio"
 *   node scripts/fetch-leads-runner.js --radius 30000
 *   node scripts/fetch-leads-runner.js --dry-run
 *   node scripts/fetch-leads-runner.js --all-categories
 *   node scripts/fetch-leads-runner.js --check-key             # test API key capabilities
 *
 * If you get REQUEST_DENIED on geocoding, the Geocoding API isn't enabled.
 * Fix: use --lat/--lng flags, OR enable the APIs below in Google Cloud Console:
 *   https://console.cloud.google.com/apis/library
 *   → Enable: "Geocoding API" and "Places API"
 */
"use strict";

const https   = require("https");
const path    = require("path");
const { Pool } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const { LEAD_CATEGORIES } = require("../config/lead-categories");

const dbHost = process.env.POSTGRES_HOST || process.env.CLAW_DB_HOST;
const dbPort = parseInt(process.env.POSTGRES_PORT || process.env.CLAW_DB_PORT || "15432", 10);
const dbUser = process.env.POSTGRES_USER || process.env.CLAW_DB_USER || "claw";
const dbPass = process.env.POSTGRES_PASSWORD || process.env.CLAW_DB_PASSWORD;
const dbName = process.env.POSTGRES_DB || process.env.CLAW_DB_NAME || "claw_architect";

if (!dbHost || !dbPass) {
  throw new Error("Missing DB env vars. Set POSTGRES_* (preferred) or CLAW_DB_* including password.");
}

const pool = new Pool({
  host: dbHost,
  port: dbPort,
  user: dbUser,
  password: dbPass,
  database: dbName,
});

const DRY_RUN      = process.argv.includes("--dry-run");
const ALL_CATS     = process.argv.includes("--all-categories");
const CHECK_KEY    = process.argv.includes("--check-key");
const LOCATION     = (() => { const i = process.argv.indexOf("--location"); return i >= 0 ? process.argv[i+1] : null; })();
const LAT_ARG      = (() => { const i = process.argv.indexOf("--lat");      return i >= 0 ? parseFloat(process.argv[i+1]) : null; })();
const LNG_ARG      = (() => { const i = process.argv.indexOf("--lng");      return i >= 0 ? parseFloat(process.argv[i+1]) : null; })();
const RADIUS       = (() => { const i = process.argv.indexOf("--radius");   return i >= 0 ? parseInt(process.argv[i+1]) : 50000; })();
const CATEGORY_ARG = (() => { const i = process.argv.indexOf("--category"); return i >= 0 ? process.argv[i+1] : null; })();
const MAX_RESULTS  = (() => { const i = process.argv.indexOf("--max");      return i >= 0 ? parseInt(process.argv[i+1]) : 60; })();

// Well-known city coordinates — used when geocoding is unavailable
const CITY_COORDS = {
  "phoenix, az":    { lat: 33.4484,  lng: -112.0740 },
  "tempe, az":      { lat: 33.4255,  lng: -111.9400 },
  "scottsdale, az": { lat: 33.4942,  lng: -111.9261 },
  "mesa, az":       { lat: 33.4152,  lng: -111.8315 },
  "chandler, az":   { lat: 33.3062,  lng: -111.8413 },
  "gilbert, az":    { lat: 33.3528,  lng: -111.7890 },
  "glendale, az":   { lat: 33.5387,  lng: -112.1860 },
  "tucson, az":     { lat: 32.2226,  lng: -110.9747 },
  "los angeles, ca":{ lat: 34.0522,  lng: -118.2437 },
  "san diego, ca":  { lat: 32.7157,  lng: -117.1611 },
  "las vegas, nv":  { lat: 36.1699,  lng: -115.1398 },
  "denver, co":     { lat: 39.7392,  lng: -104.9903 },
  "austin, tx":     { lat: 30.2672,  lng: -97.7431  },
  "dallas, tx":     { lat: 32.7767,  lng: -96.7970  },
  "miami, fl":      { lat: 25.7617,  lng: -80.1918  },
  "new york, ny":   { lat: 40.7128,  lng: -74.0060  },
  "chicago, il":    { lat: 41.8781,  lng: -87.6298  },
  "seattle, wa":    { lat: 47.6062,  lng: -122.3321 },
};

// Target business categories for SkynPatch wholesale
// These are the best matches for wellness patch retail placement
const TARGET_CATEGORIES = LEAD_CATEGORIES;

const BRAND_SLUG = "skynpatch";
const API_KEY    = process.env.GOOGLE_PLACES_API_KEY;

// ── HTTP helpers ──────────────────────────────────────────────────────────

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let raw = "";
      res.on("data", d => raw += d);
      res.on("end", () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error(`JSON parse error: ${raw.slice(0,200)}`)); }
      });
    }).on("error", reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Resolve location to lat/lng ───────────────────────────────────────────

async function resolveLocation(location) {
  // 1. Try to use API key check result to pick right API
  // 2. Check hardcoded city table first (avoids Geocoding API call)
  const key = (location || "").toLowerCase().trim();
  if (CITY_COORDS[key]) {
    console.log(`     (using built-in coordinates for "${location}")`);
    return CITY_COORDS[key];
  }

  // 3. Try Geocoding API
  console.log(`     Trying Geocoding API...`);
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${API_KEY}`;
  try {
    const res = await httpGet(url);
    if (res.status === "OK" && res.results?.[0]) {
      const loc = res.results[0].geometry.location;
      return { lat: loc.lat, lng: loc.lng };
    }
    if (res.status === "REQUEST_DENIED") {
      console.warn(`\n  ⚠️  Geocoding API returned REQUEST_DENIED.`);
      console.warn(`     The Geocoding API may not be enabled for your key.`);
      console.warn(`     To fix: https://console.cloud.google.com/apis/library`);
      console.warn(`     → Enable "Geocoding API" and "Places API"\n`);
      console.warn(`     Falling back to Phoenix, AZ coordinates.\n`);
      return CITY_COORDS["phoenix, az"];
    }
    throw new Error(`Geocoding failed: ${res.status}`);
  } catch (e) {
    console.warn(`     Geocoding error: ${e.message} — falling back to Phoenix, AZ`);
    return CITY_COORDS["phoenix, az"];
  }
}

// ── API key diagnostic ────────────────────────────────────────────────────

async function checkApiKey() {
  console.log("\n  🔑 Testing API key capabilities...\n");
  const phx = CITY_COORDS["phoenix, az"];

  // Test Places Nearby Search
  const placesUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${phx.lat},${phx.lng}&radius=1000&keyword=gym&key=${API_KEY}`;
  const placesRes = await httpGet(placesUrl);
  console.log(`  Places Nearby Search : ${placesRes.status === "OK" || placesRes.status === "ZERO_RESULTS" ? "✓ WORKING" : `✗ ${placesRes.status}`}`);

  // Test Places Details
  if (placesRes.results?.[0]) {
    const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placesRes.results[0].place_id}&fields=name,website&key=${API_KEY}`;
    const detailRes = await httpGet(detailUrl);
    console.log(`  Places Details       : ${detailRes.status === "OK" ? "✓ WORKING" : `✗ ${detailRes.status}`}`);
  }

  // Test Geocoding
  const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=Phoenix,AZ&key=${API_KEY}`;
  const geoRes = await httpGet(geoUrl);
  console.log(`  Geocoding API        : ${geoRes.status === "OK" ? "✓ WORKING" : `✗ ${geoRes.status} (not required — we use built-in coords)`}`);

  console.log(`\n  If Places APIs show ✗ REQUEST_DENIED:`);
  console.log(`  → Go to: https://console.cloud.google.com/apis/library`);
  console.log(`  → Enable: "Places API" (required for lead fetching)`);
  console.log(`  → Enable: "Geocoding API" (optional — we have fallback coords)\n`);
}

// ── Fetch one category ────────────────────────────────────────────────────

async function fetchCategory(lat, lng, category) {
  let places = [], nextToken = null, pages = 0;

  do {
    let res;
    if (nextToken) {
      await sleep(2200);
      const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?pagetoken=${nextToken}&key=${API_KEY}`;
      res = await httpGet(url);
    } else {
      const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${RADIUS}&keyword=${encodeURIComponent(category)}&key=${API_KEY}`;
      res = await httpGet(url);
    }
    if (res.status !== "OK" && res.status !== "ZERO_RESULTS") {
      console.warn(`  ⚠️  Places error for "${category}": ${res.status}`);
      break;
    }
    places.push(...(res.results || []));
    nextToken = res.next_page_token || null;
    pages++;
  } while (nextToken && places.length < MAX_RESULTS && pages < 3);

  return places.slice(0, MAX_RESULTS);
}

// ── Get place details ─────────────────────────────────────────────────────

async function getDetails(placeId) {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,formatted_address,formatted_phone_number,website,address_component&key=${API_KEY}`;
  const res = await httpGet(url);
  return res.result || {};
}

// ── Store lead ────────────────────────────────────────────────────────────

async function storeLead(place, category, detail) {
  let city = null, state = null;
  for (const comp of detail.address_components || []) {
    if (comp.types.includes("locality"))                   city  = comp.long_name;
    if (comp.types.includes("administrative_area_level_1")) state = comp.short_name;
  }
  await pool.query(
    `INSERT INTO leads (brand_slug, business_name, address, city, state, phone, website, category, place_id, raw_data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (place_id) DO UPDATE
       SET phone=COALESCE(EXCLUDED.phone,leads.phone),
           website=COALESCE(EXCLUDED.website,leads.website),
           city=COALESCE(EXCLUDED.city,leads.city),
           state=COALESCE(EXCLUDED.state,leads.state)`,
    [
      BRAND_SLUG,
      place.name,
      detail.formatted_address || place.vicinity || null,
      city, state,
      detail.formatted_phone_number || null,
      detail.website || null,
      category,
      place.place_id,
      JSON.stringify(place),
    ]
  );
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  if (!API_KEY) { console.error("GOOGLE_PLACES_API_KEY not set in .env"); process.exit(1); }

  console.log("\n");
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║         SKYNPATCH LEAD FETCHER (Google Places)              ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");
  if (CHECK_KEY) { await checkApiKey(); await pool.end(); return; }

  // Resolve coordinates
  let lat, lng;
  if (LAT_ARG !== null && LNG_ARG !== null) {
    lat = LAT_ARG; lng = LNG_ARG;
    console.log(`  Location : (manual coords)`);
  } else if (LOCATION) {
    console.log(`  Location : ${LOCATION}`);
  } else {
    console.log(`  Location : Phoenix, AZ (default)`);
  }
  console.log(`  Radius   : ${(RADIUS/1000).toFixed(0)} km`);
  console.log(`  Max/cat  : ${MAX_RESULTS}\n`);

  if (DRY_RUN) {
    console.log("  ⚠️  DRY RUN — no API calls or DB writes\n");
    const cats = ALL_CATS ? TARGET_CATEGORIES : [CATEGORY_ARG || TARGET_CATEGORIES[0]];
    console.log(`  Would fetch categories:\n  ${cats.join("\n  ")}\n`);
    await pool.end();
    return;
  }

  if (lat === undefined) {
    if (LAT_ARG !== null) {
      lat = LAT_ARG; lng = LNG_ARG;
    } else {
      console.log(`  📍 Resolving coordinates for "${LOCATION || "Phoenix, AZ"}"...`);
      const coords = await resolveLocation(LOCATION || "Phoenix, AZ");
      lat = coords.lat; lng = coords.lng;
    }
    console.log(`     → ${lat}, ${lng}\n`);
  }

  const categories = ALL_CATS ? TARGET_CATEGORIES : [CATEGORY_ARG || "health food store"];

  let totalFound = 0, totalStored = 0;

  for (const category of categories) {
    console.log(`  🔍 "${category}"`);
    process.stdout.write(`     Searching...`);

    const places = await fetchCategory(lat, lng, category);
    process.stdout.write(` ${places.length} found\n`);

    let stored = 0;
    for (const place of places) {
      await sleep(200);
      let detail = {};
      try { detail = await getDetails(place.place_id); }
      catch (e) { console.warn(`     details failed: ${e.message.slice(0,60)}`); }

      try { await storeLead(place, category, detail); stored++; }
      catch (e) { console.warn(`     store failed: ${e.message.slice(0,60)}`); }
    }

    console.log(`     ✓ ${stored} stored to DB\n`);
    totalFound  += places.length;
    totalStored += stored;

    // Pause between categories to stay under rate limits
    if (categories.length > 1) await sleep(1000);
  }

  // Summary
  const { rows } = await pool.query(
    "SELECT COUNT(*) AS total, COUNT(email) AS with_email, COUNT(website) AS with_website FROM leads WHERE brand_slug='skynpatch'"
  );
  const stats = rows[0];

  console.log("  ─────────────────────────────────────────────────────");
  console.log(`  Found this run  : ${totalFound}`);
  console.log(`  Stored to DB    : ${totalStored}`);
  console.log(`\n  All skynpatch leads in DB:`);
  console.log(`  Total leads     : ${stats.total}`);
  console.log(`  With website    : ${stats.with_website}  ← run enrich-leads-email.js next`);
  console.log(`  With email      : ${stats.with_email}`);
  console.log(`\n  Next step: node scripts/enrich-leads-email.js --limit 200\n`);

  await pool.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
