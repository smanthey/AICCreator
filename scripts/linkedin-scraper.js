#!/usr/bin/env node
// scripts/linkedin-scraper.js
// ─────────────────────────────────────────────────────────────────────────────
// LinkedIn B2B Scraper — uses li_at session cookie (no official API)
//
// Technique: Inject your real LinkedIn session cookie (li_at) into Playwright.
// LinkedIn then thinks you are you, browsing normally. We search for companies
// in wellness / health store categories and extract:
//   - Company name, website, size, industry, location
//   - Decision-maker names and titles (owner, buyer, manager)
//   - LinkedIn profile URLs
//
// These results are upserted into the leads table to enrich existing Google
// Maps leads or stand alone as new leads.
//
// ── Getting your li_at cookie ─────────────────────────────────────────────────
//   1. Log into linkedin.com in Chrome
//   2. Open DevTools → Application → Cookies → linkedin.com
//   3. Find the cookie named "li_at"
//   4. Copy its value into .env:  LINKEDIN_LI_AT=your_value_here
//
// ── Safety guidelines ─────────────────────────────────────────────────────────
//   - Don't scrape more than 80-100 profiles per day (LinkedIn's soft limit)
//   - Add random delays (already built in)
//   - Don't run from a fresh/new LinkedIn account
//   - Run no more than once per day per search
//
// Usage:
//   node scripts/linkedin-scraper.js --query "health food store owner" --location "Phoenix"
//   node scripts/linkedin-scraper.js --company "Sprouts Farmers Market" --contacts
//   node scripts/linkedin-scraper.js --search-companies --industry "Wellness" --location "Arizona"
//   node scripts/linkedin-scraper.js --status   (check cookie validity)
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

require('dotenv').config();
const { chromium } = require('playwright');
const { Pool }     = require('pg');
const fs           = require('fs');
const path         = require('path');

const dbHost = process.env.POSTGRES_HOST || process.env.CLAW_DB_HOST || process.env.DB_HOST;
const dbPort = parseInt(process.env.POSTGRES_PORT || process.env.CLAW_DB_PORT || process.env.DB_PORT || '15432', 10);
const dbName = process.env.POSTGRES_DB || process.env.CLAW_DB_NAME || process.env.DB_NAME || 'claw_architect';
const dbUser = process.env.POSTGRES_USER || process.env.CLAW_DB_USER || process.env.DB_USER || 'claw';
const dbPass = process.env.POSTGRES_PASSWORD || process.env.CLAW_DB_PASSWORD || process.env.DB_PASSWORD;

if (!dbHost || !dbPass) {
  throw new Error('Missing DB env vars. Set POSTGRES_* (preferred) or CLAW_DB_* / DB_* including password.');
}

// ── DB ────────────────────────────────────────────────────────────────────────
const pool = new Pool({
  host: dbHost,
  port: dbPort,
  database: dbName,
  user: dbUser,
  password: dbPass,
});

// ── Config ────────────────────────────────────────────────────────────────────
const LI_AT      = process.env.LINKEDIN_LI_AT || '';
const JSESSIONID = process.env.LINKEDIN_JSESSIONID || '';  // optional, improves stability

const args      = process.argv.slice(2);
const getArg    = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i+1] : null; };
const hasFlag   = (f) => args.includes(f);

const QUERY            = getArg('--query');
const LOCATION         = getArg('--location')  || 'Phoenix';
const COMPANY_NAME     = getArg('--company');
const INDUSTRY         = getArg('--industry')  || 'Wellness and Fitness Services';
const LIMIT            = parseInt(getArg('--limit') || '25', 10);
const SEARCH_COMPANIES = hasFlag('--search-companies');
const GET_CONTACTS     = hasFlag('--contacts');
const DRY_RUN          = hasFlag('--dry-run');
const STATUS_CHECK     = hasFlag('--status');
const HEADLESS         = !hasFlag('--visible');

// ── B2B target searches for SkynPatch ─────────────────────────────────────────
const SKYNPATCH_SEARCHES = [
  { query: 'health food store owner',   location: LOCATION },
  { query: 'vitamin shop owner buyer',  location: LOCATION },
  { query: 'yoga studio owner',         location: LOCATION },
  { query: 'day spa owner director',    location: LOCATION },
  { query: 'wellness center director',  location: LOCATION },
  { query: 'gym owner fitness manager', location: LOCATION },
  { query: 'chiropractor office manager', location: LOCATION },
  { query: 'natural foods buyer',       location: LOCATION },
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const rand  = (min, max) => min + Math.random() * (max - min);

// ── Daily rate-limit state ────────────────────────────────────────────────────
// LinkedIn's soft limit: ~80 profile views + ~20 searches per day per account.
// We track these across separate script runs using a state file.
const STATE_FILE = path.join(__dirname, '..', '.linkedin-state.json');
const DAILY_PROFILE_LIMIT = 75;
const DAILY_SEARCH_LIMIT  = 18;

function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    // Reset counters if it's a new calendar day
    const today = new Date().toISOString().slice(0, 10);
    if (s.date !== today) return { date: today, profiles: 0, searches: 0, blocked_until: null };
    return s;
  } catch {
    return { date: new Date().toISOString().slice(0, 10), profiles: 0, searches: 0, blocked_until: null };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function checkDailyLimits() {
  const state = loadState();

  // Check if we're in a block cooldown period
  if (state.blocked_until) {
    const blockedUntil = new Date(state.blocked_until);
    if (new Date() < blockedUntil) {
      const mins = Math.ceil((blockedUntil - new Date()) / 60000);
      console.error(`\n⛔ LinkedIn rate-limited. Blocked for ${mins} more minutes.`);
      console.error(`   Resume after: ${blockedUntil.toLocaleTimeString()}`);
      process.exit(1);
    } else {
      state.blocked_until = null;
      saveState(state);
    }
  }

  return state;
}

function incrementCounter(type, count = 1) {
  const state = loadState();
  state[type] = (state[type] || 0) + count;
  saveState(state);
  return state;
}

function markBlocked(minutes = 60) {
  const state = loadState();
  state.blocked_until = new Date(Date.now() + minutes * 60000).toISOString();
  saveState(state);
  console.error(`\n⛔ HTTP 999 detected — marking as rate-limited for ${minutes} minutes`);
}

function showQuotaStatus() {
  const state = loadState();
  const pLeft = DAILY_PROFILE_LIMIT - (state.profiles || 0);
  const sLeft = DAILY_SEARCH_LIMIT  - (state.searches || 0);
  console.log(`\n📊 Daily quota (${state.date}):`);
  console.log(`   Profiles viewed: ${state.profiles || 0} / ${DAILY_PROFILE_LIMIT} (${pLeft} remaining)`);
  console.log(`   Searches done:   ${state.searches || 0} / ${DAILY_SEARCH_LIMIT} (${sLeft} remaining)`);
  if (state.blocked_until) console.log(`   Blocked until:   ${state.blocked_until}`);
  return { profilesLeft: pLeft, searchesLeft: sLeft };
}

// ── Browser setup with li_at cookie ──────────────────────────────────────────
async function launchWithCookie() {
  const browser = await chromium.launch({
    headless: HEADLESS,
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--disable-extensions',
      '--disable-gpu',
      '--disable-gpu-compositing',
      '--use-angle=swiftshader',
    ],
  });

  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
             + 'AppleWebKit/537.36 (KHTML, like Gecko) '
             + 'Chrome/121.0.0.0 Safari/537.36',
    locale: 'en-US',
    viewport: { width: 1440, height: 900 },
    // Extra headers to look more human
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      'sec-ch-ua': '"Not A(Brand";v="99", "Google Chrome";v="121"',
      'sec-ch-ua-platform': '"macOS"',
    },
  });

  // Remove webdriver flag
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {} };
  });

  // Inject LinkedIn session cookies
  const cookies = [
    { name: 'li_at', value: LI_AT, domain: '.linkedin.com', path: '/', secure: true, httpOnly: true },
  ];
  if (JSESSIONID) {
    cookies.push({ name: 'JSESSIONID', value: JSESSIONID, domain: '.linkedin.com', path: '/', secure: true });
  }
  await ctx.addCookies(cookies);

  return { browser, ctx };
}

// ── Check cookie validity ─────────────────────────────────────────────────────
async function checkCookieStatus() {
  if (!LI_AT) {
    console.error('\n⚠️  LINKEDIN_LI_AT not set in .env');
    console.error('   1. Log into linkedin.com in Chrome');
    console.error('   2. DevTools → Application → Cookies → linkedin.com → li_at');
    console.error('   3. Add LINKEDIN_LI_AT=<value> to .env');
    return false;
  }

  console.log('\n🔍 Checking LinkedIn cookie validity...');
  const { browser, ctx } = await launchWithCookie();
  const page = await ctx.newPage();

  try {
    await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await sleep(2000);

    const url = page.url();
    if (url.includes('/login') || url.includes('/authwall')) {
      console.log('❌ Cookie expired or invalid. You need to log in and get a fresh li_at.');
      return false;
    }

    // Get profile name to confirm
    const name = await page.$eval('.global-nav__me-photo, .profile-rail-card__member-name', el => el.alt || el.textContent.trim()).catch(() => 'unknown');
    console.log(`✅ Cookie valid! Logged in as: ${name}`);
    return true;
  } finally {
    await ctx.close();
    await browser.close();
  }
}

// ── HTTP 999 / rate-limit detector ───────────────────────────────────────────
async function checkForBlock(page) {
  const url = page.url();
  if (url.includes('/login') || url.includes('/authwall')) {
    throw new Error('COOKIE_EXPIRED: LinkedIn requires login — get a fresh li_at cookie');
  }

  // HTTP 999 = LinkedIn's rate-limit response code (shows as a redirect to error page)
  const status = await page.evaluate(() => {
    return document.title.includes('999') ||
           document.body?.innerText?.includes('unusual activity') ||
           document.body?.innerText?.includes('temporarily restricted') ||
           window.location.href.includes('error=999');
  }).catch(() => false);

  if (status) {
    markBlocked(45); // 45-minute cooldown
    throw new Error('RATE_LIMITED: LinkedIn HTTP 999 — cooling down for 45 minutes');
  }
}

// ── Search for people (People search) ────────────────────────────────────────
async function searchPeople({ query, location, limit = 25 }) {
  // Check daily quota before starting
  const state = checkDailyLimits();
  const searchesLeft = DAILY_SEARCH_LIMIT - (state.searches || 0);
  if (searchesLeft <= 0) {
    console.log(`\n⚠️  Daily search limit reached (${DAILY_SEARCH_LIMIT}). Try again tomorrow.`);
    return [];
  }
  const profilesLeft = DAILY_PROFILE_LIMIT - (state.profiles || 0);
  const actualLimit  = Math.min(limit, profilesLeft);
  if (actualLimit <= 0) {
    console.log(`\n⚠️  Daily profile view limit reached. Try again tomorrow.`);
    return [];
  }

  // Simpler URL without geo encoding (more reliable across LinkedIn versions)
  const simpleUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(query + ' ' + location)}`;

  console.log(`\n👥 People search: "${query}" in ${location} (quota: ${searchesLeft} searches, ${profilesLeft} profiles left)`);
  const { browser, ctx } = await launchWithCookie();
  const page = await ctx.newPage();
  const people = [];

  try {
    await page.goto(simpleUrl, { waitUntil: 'networkidle', timeout: 30_000 });
    await sleep(rand(1500, 2500));
    await checkForBlock(page);
    incrementCounter('searches');

    // Scroll to load more results
    const pages = Math.ceil(limit / 10);
    for (let p = 0; p < pages; p++) {
      // Extract profiles from current page
      const profiles = await page.evaluate(() => {
        const cards = document.querySelectorAll('.reusable-search__result-container, li.reusable-search__result-container');
        return [...cards].map(card => {
          // Multi-strategy extraction — LinkedIn rotates class names frequently
          // Strategy 1: aria-hidden name spans (most reliable across updates)
          const linkEl = card.querySelector('a[href*="/in/"]');
          const nameEl =
            card.querySelector('span[aria-hidden="true"]') ||          // current format
            card.querySelector('[data-anonymize="person-name"]') ||    // anonymized fallback
            card.querySelector('a[href*="/in/"] span:first-child') ||  // older format
            linkEl;

          const name = nameEl ? nameEl.textContent.trim().replace(/\s+/g, ' ') : '';

          // Subtitles: LinkedIn places title and location in ordered list items
          const subtitles = [...card.querySelectorAll('div[class*="subtitle"] *,' +
            'span[class*="subtitle"], [data-anonymize="job-title"],' +
            'li.reusable-search-simple-insight__item span')].map(el => el.textContent.trim()).filter(Boolean);

          return {
            name,
            title:       subtitles[0] || '',
            location:    subtitles[1] || '',
            profile_url: linkEl ? linkEl.href.split('?')[0] : '',
            company:     subtitles[2] || '',
          };
        }).filter(p => p.name && p.name.length > 1);
      });

      people.push(...profiles);
      incrementCounter('profiles', profiles.length);
      console.log(`   Page ${p+1}: ${profiles.length} profiles`);

      if (people.length >= actualLimit) break;

      // Check quota again after each page
      const freshState = loadState();
      if ((freshState.profiles || 0) >= DAILY_PROFILE_LIMIT) {
        console.log(`   ⚠️  Daily profile limit reached mid-run — stopping`);
        break;
      }

      // Go to next page
      const nextBtn = await page.$('button[aria-label="Next"]');
      if (!nextBtn) break;
      await nextBtn.click();
      await sleep(rand(2000, 3500));
      await checkForBlock(page).catch(() => null); // non-fatal block check
    }

  } finally {
    await ctx.close();
    await browser.close();
  }

  return people.slice(0, limit);
}

// ── Search for companies ──────────────────────────────────────────────────────
async function searchCompanies({ industry, location, limit = 20 }) {
  const searchUrl = `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(industry + ' ' + location)}&origin=FACETED_SEARCH`;

  console.log(`\n🏢 Company search: "${industry}" in ${location}`);
  const { browser, ctx } = await launchWithCookie();
  const page = await ctx.newPage();
  const companies = [];

  try {
    await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 30_000 });
    await sleep(rand(1500, 2500));

    if (page.url().includes('/login')) throw new Error('Cookie expired');

    const results = await page.evaluate(() => {
      // Use company page links as the anchor — more stable than class names
      const cards = [...document.querySelectorAll('a[href*="/company/"]')]
        .map(link => link.closest('li, [data-chameleon-result-urn]') || link.parentElement)
        .filter((el, i, arr) => arr.indexOf(el) === i); // dedupe

      return cards.map(card => {
        const linkEl  = card.querySelector('a[href*="/company/"]');
        const nameEl  = card.querySelector('span[aria-hidden="true"], [data-anonymize="company-name"]') || linkEl;
        const metaEls = [...card.querySelectorAll('span, div')]
          .map(el => el.textContent.trim())
          .filter(t => t.length > 3 && t.length < 120)
          .filter(t => !nameEl || t !== nameEl.textContent.trim());

        return {
          name:         nameEl ? nameEl.textContent.trim() : '',
          description:  metaEls[0] || '',
          summary:      metaEls[1] || '',
          linkedin_url: linkEl ? linkEl.href.split('?')[0] : '',
        };
      }).filter(c => c.name);
    });

    companies.push(...results.slice(0, limit));
    console.log(`   Found ${companies.length} companies`);

  } finally {
    await ctx.close();
    await browser.close();
  }

  return companies;
}

// ── Get company details (website, size, location) ─────────────────────────────
async function getCompanyDetails(linkedinUrl) {
  const { browser, ctx } = await launchWithCookie();
  const page = await ctx.newPage();

  try {
    await page.goto(linkedinUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await sleep(rand(1500, 2500));

    return await page.evaluate(() => {
      const getText = (sel) => {
        const el = document.querySelector(sel);
        return el ? el.textContent.trim() : '';
      };

      const website = document.querySelector('a[data-tracking-control-name*="website"], a[href*="://"][aria-label*="website" i]')?.href || '';
      const industry = getText('.org-top-card-summary-info-list__info-item:first-child');
      const size     = getText('.org-top-card-summary-info-list__info-item:nth-child(2)');
      const location = getText('.org-location-card__location-name, .org-top-card-summary-info-list__info-item:last-child');

      return { website, industry, size, location };
    });
  } catch {
    return { website: '', industry: '', size: '', location: '' };
  } finally {
    await ctx.close();
    await browser.close();
  }
}

// ── Save people to leads_contacts table ──────────────────────────────────────
async function saveContacts(people, searchQuery) {
  // Ensure table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS leads_contacts (
      id            SERIAL PRIMARY KEY,
      full_name     TEXT NOT NULL,
      title         TEXT,
      location      TEXT,
      company_name  TEXT,
      linkedin_url  TEXT UNIQUE,
      search_query  TEXT,
      source        TEXT DEFAULT 'linkedin',
      email         TEXT,
      enriched_at   TIMESTAMPTZ,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  let saved = 0;
  for (const p of people) {
    if (!p.profile_url) continue;
    await pool.query(`
      INSERT INTO leads_contacts (full_name, title, location, company_name, linkedin_url, search_query, source)
      VALUES ($1, $2, $3, $4, $5, $6, 'linkedin')
      ON CONFLICT (linkedin_url) DO NOTHING
    `, [p.name, p.title, p.location, p.company || '', p.profile_url, searchQuery]).catch(() => {});
    saved++;
  }
  return saved;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (STATUS_CHECK || hasFlag('--quota')) {
    showQuotaStatus();
    if (STATUS_CHECK) await checkCookieStatus();
    await pool.end();
    return;
  }

  if (!LI_AT) {
    console.error('\n⚠️  LINKEDIN_LI_AT not set in .env');
    console.error('   Steps to get it:');
    console.error('   1. Open LinkedIn in Chrome, sign in');
    console.error('   2. Press F12 → Application → Cookies → linkedin.com');
    console.error('   3. Find "li_at" → copy the Value');
    console.error('   4. Add to .env:  LINKEDIN_LI_AT=<paste_here>\n');
    process.exit(1);
  }

  // Single people search
  if (QUERY) {
    const people = await searchPeople({ query: QUERY, location: LOCATION, limit: LIMIT });
    console.log(`\n📋 Results (${people.length} people):`);
    people.forEach(p => console.log(`   • ${p.name} — ${p.title} @ ${p.location}`));

    if (!DRY_RUN) {
      const saved = await saveContacts(people, QUERY);
      console.log(`\n💾 Saved ${saved} contacts to leads_contacts table`);
    }

    await pool.end();
    return;
  }

  // Run all SkynPatch target searches
  if (hasFlag('--all')) {
    let total = 0;
    for (const search of SKYNPATCH_SEARCHES) {
      const people = await searchPeople({ query: search.query, location: search.location, limit: 15 });

      if (!DRY_RUN) {
        const saved = await saveContacts(people, search.query);
        total += saved;
      } else {
        console.log(`  [DRY RUN] Would save ${people.length} for: ${search.query}`);
        people.slice(0,3).forEach(p => console.log(`    → ${p.name} | ${p.title}`));
        total += people.length;
      }

      // Rate limit: 5-10s between searches
      const pause = rand(5000, 10000);
      console.log(`⏳ Pausing ${(pause/1000).toFixed(1)}s...\n`);
      await sleep(pause);
    }
    console.log(`\n✅ Done. ${total} total contacts collected.`);
  }

  // Company search
  if (SEARCH_COMPANIES) {
    const companies = await searchCompanies({ industry: INDUSTRY, location: LOCATION, limit: LIMIT });
    console.log(`\n🏢 Companies found: ${companies.length}`);
    companies.forEach(c => console.log(`   • ${c.name} | ${c.description}`));
  }

  if (!QUERY && !SEARCH_COMPANIES && !hasFlag('--all')) {
    console.log('\nUsage:');
    console.log('  node scripts/linkedin-scraper.js --status');
    console.log('  node scripts/linkedin-scraper.js --query "health store owner" --location "Phoenix"');
    console.log('  node scripts/linkedin-scraper.js --all --location "Phoenix, AZ"');
    console.log('  node scripts/linkedin-scraper.js --search-companies --industry "Wellness" --location "Arizona"');
    console.log('\nRequires:  LINKEDIN_LI_AT=<your_li_at_cookie>  in .env');
  }

  await pool.end();
}

main().catch(err => {
  console.error('Fatal:', err.message);
  pool.end();
  process.exit(1);
});
