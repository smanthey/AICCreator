#!/usr/bin/env node
// scripts/lead-pipeline.js
// ─────────────────────────────────────────────────────────────────────────────
// SkynPatch Lead Pipeline Orchestrator
//
// Runs the full B2B outreach pipeline in the correct order:
//
//   Stage 1  SCRAPE   — google-maps-scraper.js  → finds businesses in leads table
//   Stage 2  LINKEDIN — linkedin-scraper.js      → finds buyers in leads_contacts
//   Stage 3  ENRICH   — email-finder.js          → fills email column on leads
//   Stage 4  SCHEDULE — daily-send-scheduler.js  → sends emails within daily ramp
//
// Also provides a STATUS dashboard showing counts at each stage.
//
// Usage:
//   node scripts/lead-pipeline.js --status          (show pipeline health)
//   node scripts/lead-pipeline.js --run scrape       (stage 1 only)
//   node scripts/lead-pipeline.js --run enrich       (stage 3 only)
//   node scripts/lead-pipeline.js --run send         (stage 4 only)
//   node scripts/lead-pipeline.js --run all          (full pipeline)
//   node scripts/lead-pipeline.js --run all --dry-run
//   node scripts/lead-pipeline.js --city "Scottsdale, AZ" --run scrape
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

require('dotenv').config();
const { execSync, spawn } = require('child_process');
const { Pool }   = require('pg');
const fs         = require('fs');
const path       = require('path');

const dbHost = process.env.POSTGRES_HOST || process.env.CLAW_DB_HOST || process.env.DB_HOST;
const dbPort = parseInt(process.env.POSTGRES_PORT || process.env.CLAW_DB_PORT || process.env.DB_PORT || '15432', 10);
const dbName = process.env.POSTGRES_DB || process.env.CLAW_DB_NAME || process.env.DB_NAME || 'claw_architect';
const dbUser = process.env.POSTGRES_USER || process.env.CLAW_DB_USER || process.env.DB_USER || 'claw';
const dbPass = process.env.POSTGRES_PASSWORD || process.env.CLAW_DB_PASSWORD || process.env.DB_PASSWORD;

if (!dbHost || !dbPass) {
  throw new Error('Missing DB env vars. Set POSTGRES_* (preferred) or CLAW_DB_* / DB_* including password.');
}

const pool = new Pool({
  host: dbHost,
  port: dbPort,
  database: dbName,
  user: dbUser,
  password: dbPass,
});

const args    = process.argv.slice(2);
const getArg  = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i+1] : null; };
const hasFlag = (f) => args.includes(f);

const STAGE    = getArg('--run')  || 'status';
const CITY     = getArg('--city') || 'Phoenix, AZ';
const DRY_RUN  = hasFlag('--dry-run');
const VERBOSE  = hasFlag('--verbose');

const SCRIPTS = path.join(__dirname);
const PIPELINE_LOCK_KEY = 'lead_pipeline_global';

async function acquirePipelineLock() {
  const { rows } = await pool.query(
    `SELECT pg_try_advisory_lock(hashtext($1)) AS ok`,
    [PIPELINE_LOCK_KEY]
  );
  return !!rows[0]?.ok;
}

async function releasePipelineLock() {
  await pool.query(
    `SELECT pg_advisory_unlock(hashtext($1))`,
    [PIPELINE_LOCK_KEY]
  ).catch(() => {});
}

// ── DB stats ──────────────────────────────────────────────────────────────────
async function getStats() {
  const queries = {
    total_leads:         `SELECT COUNT(*) FROM leads`,
    leads_with_website:  `SELECT COUNT(*) FROM leads WHERE website IS NOT NULL`,
    leads_with_email:    `SELECT COUNT(*) FROM leads WHERE email IS NOT NULL AND email <> ''`,
    leads_emailed:       `SELECT COUNT(*) FROM leads l WHERE EXISTS (SELECT 1 FROM email_sends es WHERE es.lead_id = l.id AND es.status = 'sent')`,
    leads_opened:        `SELECT COUNT(*) FROM leads l WHERE EXISTS (SELECT 1 FROM email_sends es WHERE es.lead_id = l.id AND es.status = 'sent' AND es.opened_at IS NOT NULL)`,
    leads_clicked:       `SELECT COUNT(*) FROM leads l WHERE EXISTS (SELECT 1 FROM email_sends es WHERE es.lead_id = l.id AND es.status = 'sent' AND es.clicked_at IS NOT NULL)`,
    sends_total_sent:    `SELECT COUNT(*) FROM email_sends WHERE status = 'sent'`,
    contacts_found:      `SELECT COUNT(*) FROM leads_contacts`,
    contacts_linkedin:   `SELECT COUNT(*) FROM leads_contacts WHERE source = 'linkedin'`,
    orders_total:        `SELECT COUNT(*) FROM orders`,
    orders_revenue:      `SELECT COALESCE(SUM(amount_total), 0)::numeric(10,2) FROM orders WHERE status IN ('completed','paid')`,
  };

  const stats = {};
  for (const [key, sql] of Object.entries(queries)) {
    try {
      const result = await pool.query(sql);
      stats[key] = Object.values(result.rows[0])[0];
    } catch {
      stats[key] = 'n/a';
    }
  }
  return stats;
}

// ── Status dashboard ──────────────────────────────────────────────────────────
function bar(val, max, width = 20) {
  const filled = Math.round((Math.min(val, max) / Math.max(max, 1)) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function pct(a, b) {
  if (!b || b === 'n/a' || b === 0) return '—';
  return ((a / b) * 100).toFixed(1) + '%';
}

async function showStatus() {
  const s = await getStats();

  // LinkedIn state
  const liStateFile = path.join(__dirname, '..', '.linkedin-state.json');
  const liState = fs.existsSync(liStateFile)
    ? JSON.parse(fs.readFileSync(liStateFile, 'utf8'))
    : { date: '—', profiles: 0, searches: 0 };

  // Daily send state
  const sendStateFile = path.join(__dirname, '..', '.leadgen-state.json');
  const sendState = fs.existsSync(sendStateFile)
    ? JSON.parse(fs.readFileSync(sendStateFile, 'utf8'))
    : { firstSendDate: null, totalSent: 0, daySends: {} };

  const dayNum = (() => {
    if (!sendState.firstSendDate) return 0;
    const first = new Date(sendState.firstSendDate);
    const now = new Date();
    const diff = Math.floor((now - first) / (1000 * 60 * 60 * 24));
    return diff + 1;
  })();

  const D = '\x1b[90m'; // dim
  const G = '\x1b[32m'; // green
  const Y = '\x1b[33m'; // yellow
  const B = '\x1b[34m'; // blue
  const R = '\x1b[31m'; // red
  const W = '\x1b[0m';  // reset
  const BOLD = '\x1b[1m';

  console.log(`\n${BOLD}╔══════════════════════════════════════════════════════╗${W}`);
  console.log(`${BOLD}║         SkynPatch Lead Pipeline — Status             ║${W}`);
  console.log(`${BOLD}╚══════════════════════════════════════════════════════╝${W}\n`);

  console.log(`${BOLD}STAGE 1 — Scrape (Google Maps)${W}`);
  console.log(`  Total leads:          ${G}${s.total_leads}${W}`);
  console.log(`  With website:         ${s.leads_with_website}  ${D}(${pct(s.leads_with_website, s.total_leads)} have a site to scrape)${W}`);
  console.log(`  ${bar(s.total_leads, 500)} ${s.total_leads} / 500 target`);

  console.log(`\n${BOLD}STAGE 2 — LinkedIn Contacts${W}`);
  console.log(`  Contacts found:       ${G}${s.contacts_found}${W}  ${D}(${s.contacts_linkedin} from LinkedIn)${W}`);
  console.log(`  Today's quota:        ${liState.profiles || 0}/75 profiles · ${liState.searches || 0}/18 searches`);
  if (liState.blocked_until) {
    const until = new Date(liState.blocked_until);
    console.log(`  ${R}RATE LIMITED until ${until.toLocaleTimeString()}${W}`);
  }

  console.log(`\n${BOLD}STAGE 3 — Email Enrichment${W}`);
  console.log(`  With email:           ${G}${s.leads_with_email}${W}  ${D}(${pct(s.leads_with_email, s.leads_with_website)} of leads with sites)${W}`);
  const needsEmail = Math.max(0, parseInt(s.leads_with_website || 0) - parseInt(s.leads_with_email || 0));
  if (needsEmail > 0) {
    console.log(`  ${Y}Needs enrichment:     ${needsEmail} leads${W}`);
    console.log(`  Run: node scripts/email-finder.js --limit ${needsEmail}`);
  }

  console.log(`\n${BOLD}STAGE 4 — Email Outreach${W}`);
  console.log(`  Emailed:              ${G}${s.leads_emailed}${W}  ${D}(of ${s.leads_with_email} with email)${W}`);
  console.log(`  Opened:               ${s.leads_opened}  ${D}(${pct(s.leads_opened, s.leads_emailed)} open rate)${W}`);
  console.log(`  Clicked:              ${s.leads_clicked}  ${D}(${pct(s.leads_clicked, s.leads_emailed)} click rate)${W}`);
  console.log(`  Campaign day:         ${dayNum}  |  Total sent: ${s.sends_total_sent || 0}`);
  const ramp = [0,20,20,20,20,20,20,20,50,50,50,50,50,50,50,100,100,100,100,100,100,100,200,200,200,200,200,200,200];
  const todayLimit = ramp[Math.min(dayNum, ramp.length - 1)] || 500;
  console.log(`  Today's send limit:   ${todayLimit}/day`);

  console.log(`\n${BOLD}STAGE 5 — Revenue${W}`);
  console.log(`  Orders:               ${G}${s.orders_total}${W}`);
  console.log(`  Revenue:              ${G}$${s.orders_revenue}${W}`);

  // Next recommended action
  console.log(`\n${BOLD}── Recommended Next Action ─────────────────────────────${W}`);
  if (parseInt(s.total_leads || 0) < 50) {
    console.log(`  ${Y}→ Scrape more leads:${W}  node scripts/google-maps-scraper.js --all-categories --city "${CITY}"`);
  } else if (parseInt(s.leads_with_email || 0) < 20) {
    console.log(`  ${Y}→ Enrich emails:${W}  node scripts/email-finder.js --limit 100`);
  } else if (parseInt(s.leads_emailed || 0) < parseInt(s.leads_with_email || 0)) {
    console.log(`  ${Y}→ Send campaign:${W}  node scripts/daily-send-scheduler.js --dry-run`);
    console.log(`                  node scripts/daily-send-scheduler.js`);
  } else {
    console.log(`  ${G}✓ Pipeline healthy. Scrape more cities or run next day's campaign.${W}`);
  }

  console.log('');
}

// ── Spawn a script and stream its output ──────────────────────────────────────
function runScript(scriptName, scriptArgs = []) {
  return new Promise((resolve, reject) => {
    const fullPath = path.join(SCRIPTS, scriptName);
    console.log(`\n${'─'.repeat(55)}`);
    console.log(`▶  node ${scriptName} ${scriptArgs.join(' ')}`);
    console.log('─'.repeat(55));

    const child = spawn('node', [fullPath, ...scriptArgs], {
      stdio: 'inherit',
      env: process.env,
    });

    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${scriptName} exited with code ${code}`));
    });

    child.on('error', reject);
  });
}

// ── Stage runners ─────────────────────────────────────────────────────────────
async function runScrape() {
  const scrapeArgs = ['--all-categories', '--city', CITY, '--limit', '30'];
  if (DRY_RUN) scrapeArgs.push('--dry-run');
  await runScript('google-maps-scraper.js', scrapeArgs);
}

async function runLinkedIn() {
  const liArgs = ['--all', '--location', CITY.split(',')[0]];
  if (DRY_RUN) liArgs.push('--dry-run');
  await runScript('linkedin-scraper.js', liArgs);
}

async function runEnrich() {
  const enrichArgs = ['--limit', '100'];
  if (DRY_RUN) enrichArgs.push('--dry-run');
  await runScript('email-finder.js', enrichArgs);
}

async function runSend() {
  const sendArgs = [];
  if (DRY_RUN) sendArgs.push('--dry-run');
  await runScript('daily-send-scheduler.js', sendArgs);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const lock = await acquirePipelineLock();
  if (!lock) {
    console.error('Another lead-pipeline run is already active. Exiting.');
    await pool.end();
    process.exit(1);
  }

  switch (STAGE) {
    case 'status':
      await showStatus();
      break;

    case 'scrape':
      await runScrape();
      console.log('\n✅ Scrape complete.');
      await showStatus();
      break;

    case 'linkedin':
      await runLinkedIn();
      await showStatus();
      break;

    case 'enrich':
      await runEnrich();
      console.log('\n✅ Enrichment complete.');
      await showStatus();
      break;

    case 'send':
      await runSend();
      await showStatus();
      break;

    case 'all':
      console.log('\n🚀 Running full pipeline...\n');

      // Stage 1: Scrape if needed
      const statsB = await getStats();
      if (parseInt(statsB.total_leads || 0) < 30) {
        console.log('Stage 1: Scraping leads...');
        await runScrape().catch(err => console.error('Scrape error:', err.message));
      } else {
        console.log(`Stage 1: Skipped — ${statsB.total_leads} leads already in DB`);
      }

      // Stage 3: Enrich emails
      const statsA = await getStats();
      const needsEmail = Math.max(0, parseInt(statsA.leads_with_website || 0) - parseInt(statsA.leads_with_email || 0));
      if (needsEmail > 0) {
        console.log(`\nStage 3: Enriching ${needsEmail} leads...`);
        await runEnrich().catch(err => console.error('Enrich error:', err.message));
      } else {
        console.log('Stage 3: Skipped — all leads already have emails');
      }

      // Stage 4: Send campaign
      const statsC = await getStats();
      if (parseInt(statsC.leads_with_email || 0) > 0) {
        console.log('\nStage 4: Running email campaign...');
        await runSend().catch(err => console.error('Send error:', err.message));
      } else {
        console.log('Stage 4: Skipped — no emails to send yet');
      }

      console.log('\n✅ Pipeline run complete.\n');
      await showStatus();
      break;

    default:
      console.log('\nUsage:');
      console.log('  node scripts/lead-pipeline.js --status');
      console.log('  node scripts/lead-pipeline.js --run scrape   [--city "City, ST"]');
      console.log('  node scripts/lead-pipeline.js --run linkedin [--city "City, ST"]');
      console.log('  node scripts/lead-pipeline.js --run enrich');
      console.log('  node scripts/lead-pipeline.js --run send     [--dry-run]');
      console.log('  node scripts/lead-pipeline.js --run all      [--dry-run]');
  }

  await releasePipelineLock();
  await pool.end();
}

main()
  .catch(async (err) => {
    console.error('Fatal:', err.message);
    await releasePipelineLock();
    await pool.end();
    process.exit(1);
  });
