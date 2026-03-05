#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { Pool } = require("pg");

require("dotenv").config({ path: path.join(__dirname, "../.env") });

const ARGS = process.argv.slice(2);
const DRY_RUN = ARGS.includes("--dry-run");
const LIMIT = getArgInt("--limit", null);
const ONLY_REPO = getArg("--repo", null);
const INCLUDE_LOCAL_DEFAULTS = !ARGS.includes("--no-local-defaults");
const STRICT_BASELINE = ARGS.includes("--strict-baseline") || String(process.env.GITHUB_SCAN_STRICT_BASELINE || "false").toLowerCase() === "true";
const REQUIRE_SMOKE_E2E = ARGS.includes("--require-smoke-e2e") || String(process.env.GITHUB_SCAN_REQUIRE_SMOKE_E2E || "false").toLowerCase() === "true";

const pool = new Pool({
  host: process.env.CLAW_DB_HOST || process.env.POSTGRES_HOST,
  port: parseInt(process.env.CLAW_DB_PORT || process.env.POSTGRES_PORT || "15432", 10),
  database: process.env.CLAW_DB_NAME || process.env.POSTGRES_DB || "claw_architect",
  user: process.env.CLAW_DB_USER || process.env.POSTGRES_USER || "claw",
  password: process.env.CLAW_DB_PASSWORD || process.env.POSTGRES_PASSWORD,
});

const CODE_EXTS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".sql"]);
const SKIP_DIRS = new Set([".git", "node_modules", ".next", "dist", "build", ".cache", "coverage"]);
const MAX_FILE_BYTES = 512 * 1024;
const MAX_SCAN_FILES = 4000;

function getArg(flag, fallback) {
  const idx = ARGS.indexOf(flag);
  if (idx < 0 || idx + 1 >= ARGS.length) return fallback;
  return ARGS[idx + 1];
}

function getArgInt(flag, fallback) {
  const raw = getArg(flag, null);
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function exists(p) {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function safeRead(file) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return "";
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function git(cwd, args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 15000 });
  if (r.status !== 0) return "";
  return (r.stdout || "").trim();
}

function walkFiles(root) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const e of entries) {
      const full = path.join(current, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) stack.push(full);
        continue;
      }
      if (!e.isFile()) continue;
      out.push(full);
      if (out.length >= MAX_SCAN_FILES) return out;
    }
  }
  return out;
}

function detectFromDeps(deps) {
  const has = (k) => Boolean(deps[k]);
  const pick = (keys) => keys.find((k) => has(k)) || null;

  const ormUsed = pick(["drizzle-orm", "prisma", "sequelize", "typeorm", "knex", "mikro-orm"]);
  const dbClient = pick(["@neondatabase/serverless", "pg", "postgres", "mysql2", "sqlite3"]);
  const authProvider = has("better-auth")
    ? "better-auth"
    : pick(["next-auth", "@clerk/nextjs", "@supabase/supabase-js", "lucia"]) || "none";
  const emailProvider = pick(["mailersend", "mailerlite", "resend", "@sendgrid/mail", "postmark", "nodemailer"]) || "none";

  return { ormUsed, dbClient, authProvider, emailProvider };
}

function detectRepo(repo) {
  const localPath = repo.local_path || "";
  const pkgPath = path.join(localPath, "package.json");
  const nvmPath = path.join(localPath, ".nvmrc");
  const nextConfig = ["next.config.js", "next.config.mjs", "next.config.ts"].find((f) => exists(path.join(localPath, f)));

  let pkg = {};
  if (exists(pkgPath)) {
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    } catch {
      pkg = {};
    }
  }

  const deps = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
  };
  const depSignals = detectFromDeps(deps);

  const hasAppDir = exists(path.join(localPath, "app"));
  const hasPagesDir = exists(path.join(localPath, "pages"));
  let routerMode = "none";
  if (hasAppDir && hasPagesDir) routerMode = "mixed";
  else if (hasAppDir) routerMode = "app";
  else if (hasPagesDir) routerMode = "pages";

  const framework = deps.next ? "nextjs" : "other";
  const nextVersion = deps.next || null;
  const nodeVersion = (pkg.engines && pkg.engines.node) || (exists(nvmPath) ? safeRead(nvmPath).trim() : null);

  const files = walkFiles(localPath);
  let stripeUsed = false;
  let stripeWebhookVerified = false;
  let stripeWebhookRouteDetected = false;
  const stripeWebhookRouteEvidence = [];
  const stripeWebhookVerificationEvidence = [];
  let stripeWriteDetected = false;
  let stripeIdempotency = false;
  let telnyxUsed = false;
  let telnyxSignatureVerified = false;
  let telnyxWebhookRouteDetected = false;
  let meteredSignals = false;
  let orgModel = false;
  let rbac = false;
  let rls = false;
  let saasSignals = false;
  let legacyAuthRuntimeSignals = false;

  const manifestFiles = files.filter((f) => /(?:^|\/)(manifest\.ya?ml|manifest\.json|blueprint\.manifest\.ya?ml|blueprint\.manifest\.json)$/.test(f));
  const observabilityOverridePath = path.join(localPath, "claw-observability.json");
  let observabilityOverride = {};
  if (exists(observabilityOverridePath)) {
    try {
      observabilityOverride = JSON.parse(fs.readFileSync(observabilityOverridePath, "utf8")) || {};
    } catch {
      observabilityOverride = {};
    }
  }
  const ignoredViolationCodes = new Set(
    Array.isArray(observabilityOverride.ignoreViolationCodes)
      ? observabilityOverride.ignoreViolationCodes.map((v) => String(v || "").trim()).filter(Boolean)
      : []
  );
  const stripeWebhookRequired = observabilityOverride.stripeWebhookRequired !== false;
  const hasPlaywright =
    exists(path.join(localPath, "playwright.config.ts")) ||
    exists(path.join(localPath, "playwright.config.js")) ||
    files.some((f) => f.includes(`${path.sep}tests${path.sep}playwright${path.sep}`));

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (!CODE_EXTS.has(ext)) continue;
    const txt = safeRead(file);
    if (!txt) continue;
    const rel = path.relative(localPath, file).replace(/\\/g, "/");

    if (/\bfrom\s+['"]stripe['"]|\brequire\(['"]stripe['"]\)|stripe-replit-sync/i.test(txt)) stripeUsed = true;

    const runtimePath =
      /^(app|apps|pages|src|lib|server|api|routes|middleware)\//i.test(rel) ||
      /(^|\/)(middleware\.(ts|tsx|js|jsx)|auth\.(ts|tsx|js|jsx)|route\.(ts|tsx|js|jsx))$/i.test(rel);
    const stripeWebhookRouteHint =
      runtimePath &&
      /\bstripe\b/i.test(txt) &&
      /\/api\/.*webhook|stripe[_-]?webhook|stripe-signature|x-stripe-signature|webhooks\.constructEvent/i.test(txt);
    if (stripeWebhookRouteHint) {
      stripeWebhookRouteDetected = true;
      if (stripeWebhookRouteEvidence.length < 5) stripeWebhookRouteEvidence.push(rel);
    }
    if (
      /paymentIntents\.create|checkout\.sessions\.create|subscriptions\.create|invoices\.create|charges\.create|create-payment-intent|create-checkout-session/i.test(
        txt
      )
    ) {
      stripeWriteDetected = true;
    }
    if (
      /stripe\.webhooks\.constructEvent|constructEvent\s*\(|validatePayload\s*\(|stripe-signature|x-stripe-signature|findOrCreateManagedWebhook/i.test(
        txt
      )
    ) {
      stripeWebhookVerified = true;
      if (stripeWebhookVerificationEvidence.length < 5) stripeWebhookVerificationEvidence.push(rel);
    }
    if (/idempotency[_-]?key|idempotencyKey|idempotency/i.test(txt)) stripeIdempotency = true;
    if (/usage_record|metered|reportUsage|billing_usage|usage-based/i.test(txt)) meteredSignals = true;

    if (/telnyx/i.test(txt)) telnyxUsed = true;
    if (/\/webhook\/telnyx|webhook\/sms|telnyx webhook/i.test(txt)) telnyxWebhookRouteDetected = true;
    if (/x-telnyx-signature|telnyx-signature-ed25519|verify.*telnyx/i.test(txt)) telnyxSignatureVerified = true;

    // Detect legacy auth runtime imports/usages even if better-auth exists in deps.
    const runtimePathLegacy =
      /^(app|apps|pages|src|lib|server|api|routes|middleware)\//i.test(rel) ||
      /(^|\/)(middleware\.(ts|tsx|js|jsx)|auth\.(ts|tsx|js|jsx)|route\.(ts|tsx|js|jsx))$/i.test(rel);
    if (
      runtimePathLegacy &&
      /from\s+['"]next-auth(?:\/[^'"]+)?['"]|require\(['"]next-auth(?:\/[^'"]+)?['"]\)|createClient\s*\(\s*['"]https:\/\/.*supabase|from\s+['"]@supabase\/supabase-js['"]|from\s+['"]firebase\/auth['"]|from\s+['"]@clerk\/nextjs['"]|supabase\.auth\./i.test(
        txt
      )
    ) {
      legacyAuthRuntimeSignals = true;
    }

    if (/\borganization_id\b|\borg_id\b|\bworkspace_id\b|\btenant_id\b/i.test(txt)) orgModel = true;
    if (/\brequireRole\b|\bhasRole\b|\brbac\b|\brole\s*[:=]/i.test(txt)) rbac = true;
    if (/ENABLE ROW LEVEL SECURITY|ROW LEVEL SECURITY|CREATE POLICY/i.test(txt)) rls = true;
    if (/\b(subscription|billing|dashboard|workspace|tenant|organization|admin)\b/i.test(txt)) saasSignals = true;
  }

  const billingPattern = stripeUsed
    ? (meteredSignals ? "stripe-metered-custom" : "stripe-subscriptions-custom")
    : "none";
  const telnyxPattern = telnyxUsed ? (telnyxSignatureVerified ? "telnyx-signed" : "telnyx-unsigned") : "none";
  const deploymentTarget =
    exists(path.join(localPath, "vercel.json")) ? "vercel" :
    exists(path.join(localPath, "Dockerfile")) ? "docker" :
    exists(path.join(localPath, "fly.toml")) ? "fly" : "unknown";

  const multiTenantScore = Number(((orgModel ? 0.45 : 0) + (rbac ? 0.3 : 0) + (rls ? 0.25 : 0)).toFixed(3));
  const patternParts = [
    `framework:${framework}`,
    `router:${routerMode}`,
    `auth:${depSignals.authProvider}`,
    `billing:${billingPattern}`,
    `telnyx:${telnyxPattern}`,
    `orm:${depSignals.ormUsed || "none"}`,
    `db:${depSignals.dbClient || "none"}`,
    `email:${depSignals.emailProvider || "none"}`,
    `playwright:${hasPlaywright ? "yes" : "no"}`,
    `manifests:${manifestFiles.length}`,
  ].sort();
  const patternHash = crypto.createHash("sha256").update(patternParts.join("|")).digest("hex").slice(0, 20);

  const violations = [];
  const isWebAppRepo = framework === "nextjs" || routerMode !== "none";
  const addViolation = (severity, code, message, evidence) => {
    if (ignoredViolationCodes.has(code)) return;
    violations.push({ severity, code, message, evidence: evidence || {} });
  };
  if (stripeWebhookRequired && stripeUsed && stripeWebhookRouteDetected && !stripeWebhookVerified) {
    addViolation(
      "critical",
      "STRIPE_WEBHOOK_SIGNATURE_MISSING",
      "Stripe webhook handling detected without signature verification.",
      {
        route_files: stripeWebhookRouteEvidence.slice(0, 3),
        verification_files: stripeWebhookVerificationEvidence.slice(0, 3),
      }
    );
  }
  if (stripeUsed && stripeWriteDetected && !stripeIdempotency) {
    addViolation("warn", "STRIPE_IDEMPOTENCY_MISSING", "Stripe integration appears to lack idempotency handling.", {});
  }
  if (depSignals.authProvider !== "better-auth" && depSignals.authProvider !== "none") {
    addViolation(STRICT_BASELINE ? "critical" : "warn", "AUTH_NOT_STANDARDIZED", `Auth provider is ${depSignals.authProvider}; expected better-auth baseline.`, {});
  }
  if (legacyAuthRuntimeSignals) {
    addViolation(
      STRICT_BASELINE ? "critical" : "warn",
      "LEGACY_AUTH_RUNTIME_PRESENT",
      "Legacy auth runtime signals detected (NextAuth/Supabase/Firebase/Clerk). Replace with active BetterAuth handlers.",
      {}
    );
  }
  // Only enforce multi-tenant baseline when the repo shows explicit SaaS product signals.
  // E-commerce/marketing sites frequently use auth + Stripe but are intentionally single-tenant.
  const needsMultiTenant =
    observabilityOverride.multiTenantRequired === false
      ? false
      : (isWebAppRepo && saasSignals);
  if (needsMultiTenant && multiTenantScore < 0.45) {
    addViolation(
      STRICT_BASELINE ? "critical" : "warn",
      "MULTI_TENANT_BASELINE_MISSING",
      "SaaS-style repo missing multi-tenant baseline (org model + access controls).",
      { multiTenantScore }
    );
  }
  const requireSmokeE2E = observabilityOverride.requireSmokeE2E === false ? false : REQUIRE_SMOKE_E2E;
  if (isWebAppRepo && !hasPlaywright) {
    addViolation(
      requireSmokeE2E ? "critical" : "warn",
      "E2E_SMOKE_MISSING",
      "No Playwright smoke E2E signals detected (missing playwright config/tests).",
      {}
    );
  }
  if (isWebAppRepo && !hasPlaywright) {
    addViolation("warn", "PLAYWRIGHT_MISSING", "No Playwright harness detected.", {});
  }
  if (isWebAppRepo && manifestFiles.length === 0) {
    addViolation("warn", "MODULE_MANIFESTS_MISSING", "No module/blueprint manifests detected.", {});
  }
  if (framework === "nextjs" && routerMode === "pages") {
    addViolation("warn", "PAGES_ROUTER_LEGACY", "Next.js Pages Router detected; App Router is required baseline.", {});
  }
  if (telnyxUsed && telnyxWebhookRouteDetected && !telnyxSignatureVerified) {
    addViolation("warn", "TELNYX_SIGNATURE_MISSING", "Telnyx usage detected without signature verification evidence.", {});
  }

  let health = 100;
  for (const v of violations) {
    if (v.severity === "critical") health -= 30;
    else if (v.severity === "warn") health -= 10;
  }
  if (!nextConfig && framework === "nextjs") health -= 5;
  if (health < 0) health = 0;

  return {
    repoName: repo.client_name || path.basename(localPath),
    localPath,
    commitSha: git(localPath, ["rev-parse", "--short", "HEAD"]) || null,
    branch: git(localPath, ["rev-parse", "--abbrev-ref", "HEAD"]) || null,
    framework,
    nextVersion,
    routerMode,
    nodeVersion,
    ormUsed: depSignals.ormUsed,
    dbClient: depSignals.dbClient,
    authProvider: depSignals.authProvider,
    billingPattern,
    telnyxPattern,
    emailProvider: depSignals.emailProvider,
    deploymentTarget,
    hasPlaywright,
    hasModuleManifests: manifestFiles.length > 0,
    moduleManifestCount: manifestFiles.length,
    webhookSignatureVerified: stripeWebhookVerified || telnyxSignatureVerified,
    stripeIdempotencyUsed: stripeIdempotency,
    orgModelDetected: orgModel,
    rbacPresent: rbac,
    rlsPresent: rls,
    multiTenantScore,
    stackHealthScore: health,
    patternHash,
    findings: {
      files_scanned: files.length,
      next_config_present: Boolean(nextConfig),
      stripe_used: stripeUsed,
      stripe_write_detected: stripeWriteDetected,
      telnyx_used: telnyxUsed,
      telnyx_webhook_detected: telnyxWebhookRouteDetected,
      legacy_auth_runtime_signals: legacyAuthRuntimeSignals,
      manifest_files: manifestFiles.map((f) => path.relative(localPath, f)).slice(0, 50),
      pattern_parts: patternParts,
    },
    violations,
  };
}

async function insertResults(runId, repo, result) {
  const factRes = await pool.query(
    `INSERT INTO github_repo_stack_facts (
      run_id, repo_id, repo_name, local_path, commit_sha, branch, framework, next_version, router_mode,
      node_version, orm_used, db_client, auth_provider, billing_pattern, telnyx_pattern, email_provider,
      deployment_target, has_playwright, has_module_manifests, module_manifest_count, webhook_signature_verified,
      stripe_idempotency_used, org_model_detected, rbac_present, rls_present, multi_tenant_score,
      stack_health_score, pattern_hash, findings
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29
    ) RETURNING id`,
    [
      runId,
      repo.id,
      result.repoName,
      result.localPath,
      result.commitSha,
      result.branch,
      result.framework,
      result.nextVersion,
      result.routerMode,
      result.nodeVersion,
      result.ormUsed,
      result.dbClient,
      result.authProvider,
      result.billingPattern,
      result.telnyxPattern,
      result.emailProvider,
      result.deploymentTarget,
      result.hasPlaywright,
      result.hasModuleManifests,
      result.moduleManifestCount,
      result.webhookSignatureVerified,
      result.stripeIdempotencyUsed,
      result.orgModelDetected,
      result.rbacPresent,
      result.rlsPresent,
      result.multiTenantScore,
      result.stackHealthScore,
      result.patternHash,
      JSON.stringify(result.findings),
    ]
  );

  for (const v of result.violations) {
    await pool.query(
      `INSERT INTO github_repo_violations (run_id, repo_id, repo_name, severity, code, message, evidence)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [runId, repo.id, result.repoName, v.severity, v.code, v.message, JSON.stringify(v.evidence || {})]
    );
  }

  return factRes.rows[0].id;
}

async function main() {
  const where = ["status = 'active'"];
  const params = [];
  if (ONLY_REPO) {
    params.push(ONLY_REPO);
    where.push("(client_name ILIKE $1 OR repo_url ILIKE $1)");
    params[0] = `%${params[0]}%`;
  }
  let sql = `SELECT * FROM managed_repos WHERE ${where.join(" AND ")} ORDER BY client_name`;
  if (LIMIT && LIMIT > 0) sql += ` LIMIT ${LIMIT}`;
  let repos = (await pool.query(sql, params)).rows;

  if (INCLUDE_LOCAL_DEFAULTS && repos.length === 0) {
    const home = process.env.HOME || "/tmp";
    const defaults = [
      { id: null, client_name: "claw", local_path: path.join(home, "claw"), repo_url: null },
      { id: null, client_name: "clawdbot", local_path: path.join(home, "clawdbot"), repo_url: null },
      { id: null, client_name: "claw-architect", local_path: path.join(home, "claw-architect"), repo_url: null },
    ];
    repos = defaults.filter((r) => exists(r.local_path) && (!ONLY_REPO || r.client_name.includes(ONLY_REPO)));
    if (LIMIT && LIMIT > 0) repos = repos.slice(0, LIMIT);
    if (repos.length) {
      console.log(`[github:scan] using local default repos (${repos.length}) because managed_repos is empty.`);
    }
  }

  if (!repos.length) {
    console.log("[github:scan] no managed_repos rows matched.");
    await pool.end();
    return;
  }

  let runId = null;
  if (!DRY_RUN) {
    const run = await pool.query(
      `INSERT INTO github_repo_scan_runs (repos_total, status) VALUES ($1, 'running') RETURNING id`,
      [repos.length]
    );
    runId = run.rows[0].id;
  }

  let scanned = 0;
  let pass = 0;
  let fail = 0;
  let skipped = 0;
  const summaries = [];

  try {
    for (const repo of repos) {
      const localPath = repo.local_path;
      if (!localPath || !exists(localPath)) {
        const msg = `[github:scan] skip ${repo.client_name || repo.repo_url}: local_path missing`;
        console.log(msg);
        summaries.push({ repo: repo.client_name, status: "skipped", reason: "missing_local_path" });
        skipped += 1;
        continue;
      }
      if (!exists(path.join(localPath, ".git"))) {
        console.log(`[github:scan] skip ${repo.client_name || repo.repo_url}: not a git checkout`);
        summaries.push({ repo: repo.client_name, status: "skipped", reason: "not_git_repo" });
        skipped += 1;
        continue;
      }

      const result = detectRepo(repo);
      scanned += 1;
      const repoFail = result.violations.some((v) => v.severity === "critical");
      if (repoFail) fail += 1;
      else pass += 1;

      if (!DRY_RUN) {
        await insertResults(runId, repo, result);
      }

      console.log(
        `[github:scan] ${result.repoName} health=${result.stackHealthScore} ` +
        `violations=${result.violations.length} hash=${result.patternHash}`
      );
      summaries.push({
        repo: result.repoName,
        health: result.stackHealthScore,
        violations: result.violations.length,
        critical: result.violations.filter((v) => v.severity === "critical").length,
        pattern_hash: result.patternHash,
      });
    }

    if (!DRY_RUN) {
      await pool.query(
        `UPDATE github_repo_scan_runs
         SET finished_at = NOW(), status='completed', repos_scanned=$2, pass_count=$3, fail_count=$4, notes=$5
         WHERE id=$1`,
        [runId, scanned, pass, fail, JSON.stringify({ dry_run: false })]
      );
    }

    console.log(
      `[github:scan] completed run=${runId || "dry-run"} repos_total=${repos.length} scanned=${scanned} pass=${pass} fail=${fail} skipped=${skipped}`
    );
    console.log(JSON.stringify({ run_id: runId, pass, fail, skipped, summaries }, null, 2));
  } catch (err) {
    if (!DRY_RUN && runId) {
      await pool.query(
        `UPDATE github_repo_scan_runs
         SET finished_at = NOW(), status='failed', repos_scanned=$2, pass_count=$3, fail_count=$4, notes=$5
         WHERE id=$1`,
        [runId, scanned, pass, fail, JSON.stringify({ error: err.message })]
      );
    }
    throw err;
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[github:scan] fatal:", err.message);
  process.exit(1);
});
