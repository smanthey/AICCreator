// agents/qa-agent.js
// YAML spec runner for Playwright QA tests.
//
// Reads spec files from specs/ directory (YAML format from clawdbot),
// executes them via Playwright, persists results to qa_results table.
//
// Payload:
//   { spec: "forgot-password" }                    — run a named spec
//   { spec: "forgot-password", url: "https://..." }— override target URL
//   { specs_dir: "~/specs" }                       — run all specs in dir
//
// Queue: claw_tasks_qa  (qa worker — needs Playwright installed)
//
// Install Playwright browsers once:
//   npx playwright install chromium

const fs   = require("fs");
const path = require("path");
const os   = require("os");
const yaml = require("js-yaml");
const { Pool } = require("pg");
const { chromium } = require("playwright");
const { register } = require("./registry");
require("dotenv").config();

const pg = new Pool({
  host:     process.env.POSTGRES_HOST,
  port:     parseInt(process.env.POSTGRES_PORT || "5432"),
  database: process.env.POSTGRES_DB,
  user:     process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
});

// Default specs dir — can be overridden per payload
const DEFAULT_SPECS_DIR = path.resolve(__dirname, "../specs");
const DEFAULT_PACKS_DIR = path.resolve(__dirname, "../tests/playwright/packs");

function resolveHome(p) {
  return p?.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p;
}

function loadSpec(specPath) {
  const raw = fs.readFileSync(specPath, "utf8");
  return yaml.load(raw);
}

function expandValue(val, env = {}) {
  // Replace {{VAR}} placeholders with env vars
  if (typeof val !== "string") return val;
  return val.replace(/\{\{(\w+)\}\}/g, (_, key) => env[key] || process.env[key] || "");
}

async function runStep(page, step, env = {}) {
  const trace = { action: step.action, status: "ok", error: null };
  try {
    switch (step.action) {
      case "navigate": {
        const url = expandValue(step.url, env);
        await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
        break;
      }
      case "click": {
        await page.click(step.selector, { timeout: 10000 });
        break;
      }
      case "fill": {
        const val = expandValue(step.value || "", env);
        await page.fill(step.selector, val, { timeout: 10000 });
        break;
      }
      case "wait": {
        await page.waitForTimeout(step.milliseconds || 1000);
        break;
      }
      case "waitForSelector": {
        await page.waitForSelector(step.selector, { timeout: step.timeout || 10000 });
        break;
      }
      case "screenshot": {
        const p = step.path || `artifacts/step-${Date.now()}.png`;
        await page.screenshot({ path: p });
        trace.screenshot = p;
        break;
      }
      case "assert_title": {
        const title = await page.title();
        if (!title.includes(expandValue(step.contains || "", env))) {
          throw new Error(`Title "${title}" does not contain "${step.contains}"`);
        }
        break;
      }
      case "assert_url": {
        const url = page.url();
        if (!url.includes(expandValue(step.contains || "", env))) {
          throw new Error(`URL "${url}" does not contain "${step.contains}"`);
        }
        break;
      }
      default:
        console.warn(`[qa] Unknown step action: ${step.action}`);
        trace.status = "skipped";
    }
  } catch (err) {
    trace.status = "error";
    trace.error  = err.message;
    throw err;
  }
  return trace;
}

async function runSpec(spec, overrideUrl, resultId) {
  const targetUrl  = overrideUrl || spec.target;
  const steps      = spec.steps || [];
  const captures   = spec.captures || {};
  const env        = { TEST_EMAIL: process.env.TEST_EMAIL, ...(spec.env || {}) };
  const stepsTrace = [];

  await pg.query(
    `UPDATE qa_results SET status='running', started_at=NOW() WHERE id=$1`,
    [resultId]
  );

  const browser = await chromium.launch({ headless: true });
  const page    = await browser.newPage();

  let status = "passed", errorMessage = null, title = null, screenshotPath = null;

  try {
    // Navigate to base URL first if target is set and first step isn't navigate
    if (targetUrl && (steps.length === 0 || steps[0].action !== "navigate")) {
      await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 30000 });
    }

    for (const step of steps) {
      try {
        const trace = await runStep(page, step, env);
        stepsTrace.push(trace);
      } catch (err) {
        stepsTrace.push({ action: step.action, status: "error", error: err.message });
        status       = "failed";
        errorMessage = `Step "${step.action}" failed: ${err.message}`;
        break; // stop on first failure
      }
    }

    title = await page.title();

    // Capture screenshot if requested or on failure
    if (captures.screenshot || status === "failed") {
      fs.mkdirSync("artifacts", { recursive: true });
      screenshotPath = `artifacts/qa-${spec.name || "spec"}-${Date.now()}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });
    }

  } catch (err) {
    status       = "error";
    errorMessage = err.message;
  } finally {
    await browser.close();
  }

  const finishedAt = new Date();
  await pg.query(
    `UPDATE qa_results SET
       status=$1, error_message=$2, page_title=$3, screenshot=$4,
       steps_trace=$5, finished_at=$6
     WHERE id=$7`,
    [status, errorMessage, title, screenshotPath,
     JSON.stringify(stepsTrace), finishedAt, resultId]
  );

  return { status, error_message: errorMessage, title, screenshot: screenshotPath,
           steps: stepsTrace.length };
}

register("qa_spec", async (payload) => {
  const specName  = payload?.spec || payload?.pack;
  const specsDir  = resolveHome(payload?.specs_dir) || DEFAULT_SPECS_DIR;
  const packsDir  = resolveHome(payload?.packs_dir) || DEFAULT_PACKS_DIR;
  const overrideUrl = payload?.url || null;

  // ── Single spec mode ─────────────────────────────────────────
  if (specName) {
    const candidates = [
      path.join(specsDir, `${specName}.yaml`),
      path.join(specsDir, `${specName}.yml`),
      path.join(packsDir, `${specName}.yaml`),
      path.join(packsDir, `${specName}.yml`),
      // also check clawdbot/specs for backwards compat
      path.join(os.homedir(), `clawdbot/specs/${specName}.yaml`),
      path.join(os.homedir(), `clawdbot/specs/${specName}.yml`),
    ];

    const specFile = candidates.find(p => {
      try { return fs.existsSync(p); } catch { return false; }
    });

    if (!specFile) throw new Error(
      `Spec/pack "${specName}" not found. Looked in: ${candidates.join(", ")}`
    );

    const spec = loadSpec(specFile);
    spec.name  = spec.name || specName;

    const { rows: [row] } = await pg.query(
      `INSERT INTO qa_results (spec_name, spec_file, target_url, plan_id, task_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [spec.name, specFile, overrideUrl || spec.target || "",
       payload?.plan_id || null, payload?.task_id || null]
    );

    const result = await runSpec(spec, overrideUrl, row.id);
    console.log(`[qa] ${spec.name} → ${result.status}`);

    return {
      spec:      spec.name,
      result_id: row.id,
      ...result,
      cost_usd:    0,
      model_used:  "playwright",
    };
  }

  // ── All specs mode ───────────────────────────────────────────
  if (!fs.existsSync(specsDir)) throw new Error(`Specs dir not found: ${specsDir}`);

  const files = fs.readdirSync(specsDir)
    .filter(f => f.endsWith(".yaml") || f.endsWith(".yml"));

  if (files.length === 0) throw new Error(`No YAML specs found in ${specsDir}`);

  const results = [];
  for (const file of files) {
    const specFile = path.join(specsDir, file);
    const spec     = loadSpec(specFile);
    spec.name      = spec.name || file.replace(/\.(yaml|yml)$/, "");

    const { rows: [row] } = await pg.query(
      `INSERT INTO qa_results (spec_name, spec_file, target_url, plan_id, task_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [spec.name, specFile, overrideUrl || spec.target || "",
       payload?.plan_id || null, payload?.task_id || null]
    );

    const result = await runSpec(spec, overrideUrl, row.id);
    results.push({ spec: spec.name, result_id: row.id, ...result });
    console.log(`[qa] ${spec.name} → ${result.status}`);
  }

  const passed = results.filter(r => r.status === "passed").length;
  const failed = results.filter(r => r.status !== "passed").length;

  return {
    specs_run: results.length,
    passed,
    failed,
    results,
    cost_usd:   0,
    model_used: "playwright",
  };
});

// Backwards-compatible qa_run alias used by planner/verifier.
// If no spec is provided, run a basic smoke check against payload.url.
register("qa_run", async (payload = {}) => {
  if (payload.spec || payload.pack || payload.specs_dir || payload.packs_dir) {
    return registerQaSpecCompat(payload);
  }

  const url = payload.url;
  if (!url) throw new Error("qa_run requires url or spec/specs_dir");

  const spec = {
    name: "qa_run_inline_smoke",
    target: url,
    steps: [
      { action: "navigate", url },
      { action: "assert_url", contains: new URL(url).hostname },
    ],
    captures: { screenshot: true },
  };

  const { rows: [row] } = await pg.query(
    `INSERT INTO qa_results (spec_name, spec_file, target_url, plan_id, task_id)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [
      spec.name,
      "inline:qa_run",
      url,
      payload?.plan_id || null,
      payload?.task_id || null,
    ]
  );

  const result = await runSpec(spec, url, row.id);
  return {
    spec: spec.name,
    result_id: row.id,
    ...result,
    cost_usd: 0,
    model_used: "playwright",
  };
});

// Explicit pack alias for module-level Playwright packs.
register("qa_pack", async (payload = {}) => {
  if (!payload.pack) throw new Error("qa_pack requires payload.pack");
  return registerQaSpecCompat({ ...payload, spec: payload.pack, specs_dir: payload.packs_dir || DEFAULT_PACKS_DIR });
});

async function registerQaSpecCompat(payload) {
  // Reuse qa_spec behavior when a named spec or directory is provided.
  const specName  = payload?.spec || payload?.pack;
  const specsDir  = resolveHome(payload?.specs_dir) || DEFAULT_SPECS_DIR;
  const packsDir  = resolveHome(payload?.packs_dir) || DEFAULT_PACKS_DIR;
  const overrideUrl = payload?.url || null;

  if (specName) {
    const candidates = [
      path.join(specsDir, `${specName}.yaml`),
      path.join(specsDir, `${specName}.yml`),
      path.join(packsDir, `${specName}.yaml`),
      path.join(packsDir, `${specName}.yml`),
      path.join(os.homedir(), `clawdbot/specs/${specName}.yaml`),
      path.join(os.homedir(), `clawdbot/specs/${specName}.yml`),
    ];
    const specFile = candidates.find(p => {
      try { return fs.existsSync(p); } catch { return false; }
    });
    if (!specFile) throw new Error(`Spec/pack "${specName}" not found. Looked in: ${candidates.join(", ")}`);
    const spec = loadSpec(specFile);
    spec.name  = spec.name || specName;
    const { rows: [row] } = await pg.query(
      `INSERT INTO qa_results (spec_name, spec_file, target_url, plan_id, task_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [spec.name, specFile, overrideUrl || spec.target || "", payload?.plan_id || null, payload?.task_id || null]
    );
    const result = await runSpec(spec, overrideUrl, row.id);
    return { spec: spec.name, result_id: row.id, ...result, cost_usd: 0, model_used: "playwright" };
  }

  if (!fs.existsSync(specsDir)) throw new Error(`Specs dir not found: ${specsDir}`);
  const files = fs.readdirSync(specsDir).filter(f => f.endsWith(".yaml") || f.endsWith(".yml"));
  if (files.length === 0) throw new Error(`No YAML specs found in ${specsDir}`);

  const results = [];
  for (const file of files) {
    const specFile = path.join(specsDir, file);
    const spec     = loadSpec(specFile);
    spec.name      = spec.name || file.replace(/\.(yaml|yml)$/, "");
    const { rows: [row] } = await pg.query(
      `INSERT INTO qa_results (spec_name, spec_file, target_url, plan_id, task_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [spec.name, specFile, overrideUrl || spec.target || "", payload?.plan_id || null, payload?.task_id || null]
    );
    const result = await runSpec(spec, overrideUrl, row.id);
    results.push({ spec: spec.name, result_id: row.id, ...result });
  }

  return {
    specs_run: results.length,
    passed: results.filter(r => r.status === "passed").length,
    failed: results.filter(r => r.status !== "passed").length,
    results,
    cost_usd: 0,
    model_used: "playwright",
  };
}
