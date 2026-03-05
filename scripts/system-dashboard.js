#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { Pool } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(ROOT, "artifacts");
const OUT_MD = path.join(OUT_DIR, "system-dashboard.md");
const OUT_JSON = path.join(OUT_DIR, "system-dashboard.json");

function sh(cmd) {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (e) {
    return (e.stdout || e.stderr || e.message || "").toString().trim();
  }
}

function toNum(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

async function q1(pool, sql, params = [], fallback = {}) {
  try {
    const { rows } = await pool.query(sql, params);
    return rows[0] || fallback;
  } catch {
    return fallback;
  }
}

async function q(pool, sql, params = []) {
  try {
    const { rows } = await pool.query(sql, params);
    return rows || [];
  } catch {
    return [];
  }
}

function parsePm2Jlist(raw) {
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function latestReportJson(suffix) {
  const dir = path.join(ROOT, "scripts", "reports");
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(suffix)).sort();
  if (!files.length) return null;
  const full = path.join(dir, files[files.length - 1]);
  try {
    return { file: full, data: JSON.parse(fs.readFileSync(full, "utf8")) };
  } catch {
    return null;
  }
}

function makeNextSteps(m) {
  const steps = [];

  if (m.runtime.coreOffline.length) {
    steps.push(`Restart offline core services: ${m.runtime.coreOffline.join(", ")}.`);
  }
  if (m.database.pendingMigrations > 0) {
    steps.push(`Apply ${m.database.pendingMigrations} pending migration(s) with \`npm run migrate\`.`);
  }
  if (m.schema.ok !== true) {
    steps.push("Run schema audit and resolve mismatches before queue processing.");
  }
  if (m.loyalty.queuedWebhooks > 0) {
    steps.push(`Process loyalty backlog: ${m.loyalty.queuedWebhooks} queued webhook(s).`);
  }
  if (m.credit.openIssues > 0) {
    steps.push(`Review credit queue: ${m.credit.openIssues} open issue(s), ${m.credit.draftActions} draft action(s).`);
  }
  if (m.dedupe.recoverableGb >= 50) {
    steps.push(`Continue quarantine dedupe in capped batches; current recoverable estimate is ${Number(m.dedupe.recoverableGb || 0).toFixed(2)} GB.`);
  }
  if (!m.backup.ok) {
    steps.push("Run backup lanes first: backup:to:nas on each device, then backup:verify:nas. Dedupe deletion should stay blocked until backup is fully green.");
  } else if (!m.backup.duplicatesOk) {
    steps.push(`Backup verified but duplicates exist in backup store (${m.backup.duplicateGroups}). Normalize NAS canonical set before deletion phase.`);
  }
  if (m.disk.dataCapacityPct >= 85) {
    steps.push(`Data volume at ${m.disk.dataCapacityPct}% — prioritize off-volume quarantine/NAS moves.`);
  }
  if (steps.length === 0) {
    steps.push("System is healthy. Keep daily cadence: qa:fast, platform:daily, loyalty-maintenance.");
  }
  return steps;
}

async function main() {
  const pool = new Pool({
    host: process.env.CLAW_DB_HOST || process.env.POSTGRES_HOST,
    port: parseInt(process.env.CLAW_DB_PORT || process.env.POSTGRES_PORT || "15432", 10),
    user: process.env.CLAW_DB_USER || process.env.POSTGRES_USER || "claw",
    password: process.env.CLAW_DB_PASSWORD || process.env.POSTGRES_PASSWORD,
    database: process.env.CLAW_DB_NAME || process.env.POSTGRES_DB || "claw_architect",
    max: 2,
  });

  const now = new Date().toISOString();

  const pm2Raw = sh("pm2 jlist");
  const procs = parsePm2Jlist(pm2Raw);
  const coreNames = ["claw-dispatcher", "claw-gateway", "claw-webhook-server", "claw-worker-ai", "claw-worker-nas"];
  const statusMap = new Map(procs.map((p) => [p.name, p.pm2_env?.status || "unknown"]));
  const coreOffline = coreNames.filter((n) => statusMap.get(n) !== "online");

  const dfRaw = sh("df -k /System/Volumes/Data | tail -1");
  const parts = dfRaw.split(/\s+/);
  const usedKb = toNum(parts[2]);
  const availKb = toNum(parts[3]);
  const capPct = toNum((parts[4] || "0").replace("%", ""));

  const mig = await q1(pool, `select count(*)::int as applied, max(version) as max_version from schema_migrations`, [], { applied: 0 });
  const files = fs.readdirSync(path.join(ROOT, "migrations")).filter((f) => f.endsWith(".sql"));
  const migrationFiles = files.length;
  const appliedMigrations = toNum(mig.applied);
  const pendingMigrations = Math.max(0, migrationFiles - appliedMigrations);

  const schema = await q1(pool, `
    SELECT
      (SELECT count(*) FROM pg_constraint WHERE NOT convalidated)::int AS invalid_constraints,
      (SELECT count(*) FROM pg_index WHERE NOT indisvalid)::int AS invalid_indexes
  `, [], { invalid_constraints: 0, invalid_indexes: 0 });
  const schemaOk = schema.invalid_constraints === 0 && schema.invalid_indexes === 0 && pendingMigrations === 0;

  const tasksByStatus = await q(pool, `
    SELECT status, count(*)::int AS n
    FROM tasks
    GROUP BY status
    ORDER BY n DESC
  `);

  const dup = await q1(pool, `
    SELECT
      count(*)::int AS groups,
      coalesce(sum(wasted_bytes),0)::bigint AS wasted
    FROM duplicate_groups
  `, [], { groups: 0, wasted: 0 });

  const loyalty = await q1(pool, `
    SELECT
      count(*) FILTER (WHERE processing_status='queued')::int AS queued_webhooks,
      count(*) FILTER (WHERE processing_status='failed')::int AS failed_webhooks,
      count(*) FILTER (WHERE processing_status='processed')::int AS processed_webhooks
    FROM loyalty_webhook_events
  `, [], { queued_webhooks: 0, failed_webhooks: 0, processed_webhooks: 0 });

  const loyaltyEvents = await q1(pool, `
    SELECT count(*)::int AS n
    FROM loyalty_domain_events
    WHERE created_at >= now() - interval '24 hours'
  `, [], { n: 0 });

  const credit = await q1(pool, `
    SELECT
      count(*) FILTER (WHERE status='open')::int AS open_issues,
      count(*) FILTER (WHERE status='resolved')::int AS resolved_issues
    FROM credit_issues
  `, [], { open_issues: 0, resolved_issues: 0 });

  const creditActions = await q1(pool, `
    SELECT
      count(*) FILTER (WHERE status='draft')::int AS draft_actions,
      count(*) FILTER (WHERE status='queued')::int AS queued_actions
    FROM credit_actions
  `, [], { draft_actions: 0, queued_actions: 0 });

  const routing = await q1(pool, `
    SELECT
      COUNT(*) FILTER (WHERE routing_outcome='success')::int AS success_calls,
      COUNT(*) FILTER (WHERE routing_outcome='error')::int AS error_calls,
      COUNT(*) FILTER (WHERE routing_outcome='low_confidence')::int AS low_confidence_count,
      COUNT(*) FILTER (WHERE escalation_reason IS NOT NULL)::int AS fallback_invoked,
      COUNT(*) FILTER (WHERE escalation_reason='budget_blocked' OR routing_outcome='budget_blocked')::int AS budget_blocked
    FROM model_usage
    WHERE created_at >= date_trunc('day', timezone('UTC', now()))
  `, [], {
    success_calls: 0,
    error_calls: 0,
    low_confidence_count: 0,
    fallback_invoked: 0,
    budget_blocked: 0,
  });

  const spend = await q1(pool, `
    SELECT
      COALESCE(SUM(cost_usd), 0)::numeric AS total,
      COALESCE(SUM(CASE WHEN provider='openai' THEN cost_usd ELSE 0 END), 0)::numeric AS openai,
      COALESCE(SUM(CASE WHEN provider='deepseek' THEN cost_usd ELSE 0 END), 0)::numeric AS deepseek,
      COALESCE(SUM(CASE WHEN provider='gemini' THEN cost_usd ELSE 0 END), 0)::numeric AS gemini,
      COALESCE(SUM(CASE WHEN provider='anthropic' THEN cost_usd ELSE 0 END), 0)::numeric AS anthropic,
      COALESCE(SUM(CASE WHEN model_key='openai_codex' THEN cost_usd ELSE 0 END), 0)::numeric AS codex
    FROM model_usage
    WHERE created_at >= date_trunc('day', timezone('UTC', now()))
  `, [], { total: 0, openai: 0, deepseek: 0, gemini: 0, anthropic: 0, codex: 0 });

  const backupReport = latestReportJson("-backup-verify-nas.json");
  const expectedNasRoot = path.resolve(String(process.env.NAS_BACKUP_ROOT || "/Volumes/home/Storage/_claw_backup"));
  const expectedDevices = String(process.env.BACKUP_REQUIRED_DEVICES || "PRIMARY_DEV_MACHINE,SECONDARY_DEV_MACHINE,Mac")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const reportNasRoot = backupReport?.data?.nas_root ? path.resolve(String(backupReport.data.nas_root)) : null;
  const reportDevices = Array.isArray(backupReport?.data?.required_devices) ? backupReport.data.required_devices : [];
  const backupContextMatch =
    !!backupReport &&
    reportNasRoot === expectedNasRoot &&
    expectedDevices.every((d) => reportDevices.includes(d));

  const backup = {
    ok: backupContextMatch && !!backupReport?.data?.ok,
    coverageOk: backupContextMatch && !!backupReport?.data?.coverage_ok,
    duplicatesOk: backupContextMatch && !!backupReport?.data?.duplicates_ok,
    duplicateGroups: backupContextMatch ? toNum(backupReport?.data?.duplicate_groups) : 0,
    reportFile: backupContextMatch ? backupReport?.file || null : null,
    verifiedAt: backupContextMatch ? backupReport?.data?.finished_at || null : null,
    expectedNasRoot,
    expectedDevices,
    contextMatch: backupContextMatch,
    devices: backupContextMatch && Array.isArray(backupReport?.data?.devices) ? backupReport.data.devices.map((d) => ({
      device: d.device,
      ok: !!d.ok,
      fresh: !!d.fresh,
      entries: toNum(d.entries),
      ageHours: d.age_hours == null ? null : toNum(d.age_hours),
    })) : [],
  };

  const runtime = {
    coreServices: coreNames.map((name) => ({ name, status: statusMap.get(name) || "missing" })),
    coreOffline,
  };

  const model = {
    generatedAt: now,
    runtime,
    disk: {
      dataUsedGb: usedKb / 1024 / 1024,
      dataAvailGb: availKb / 1024 / 1024,
      dataCapacityPct: capPct,
    },
    database: {
      migrationFiles,
      appliedMigrations,
      pendingMigrations,
    },
    schema: {
      ok: schemaOk,
      invalidConstraints: toNum(schema.invalid_constraints),
      invalidIndexes: toNum(schema.invalid_indexes),
    },
    tasks: {
      byStatus: tasksByStatus,
    },
    dedupe: {
      groups: toNum(dup.groups),
      recoverableGb: toNum(dup.wasted) / 1e9,
    },
    backup,
    loyalty: {
      queuedWebhooks: toNum(loyalty.queued_webhooks),
      failedWebhooks: toNum(loyalty.failed_webhooks),
      processedWebhooks: toNum(loyalty.processed_webhooks),
      domainEvents24h: toNum(loyaltyEvents.n),
    },
    credit: {
      openIssues: toNum(credit.open_issues),
      resolvedIssues: toNum(credit.resolved_issues),
      draftActions: toNum(creditActions.draft_actions),
      queuedActions: toNum(creditActions.queued_actions),
    },
    modelRouting: {
      successCalls: toNum(routing.success_calls),
      errorCalls: toNum(routing.error_calls),
      fallbackInvoked: toNum(routing.fallback_invoked),
      budgetBlocked: toNum(routing.budget_blocked),
      lowConfidenceCount: toNum(routing.low_confidence_count),
      spendUsd: {
        total: toNum(spend.total),
        openai: toNum(spend.openai),
        deepseek: toNum(spend.deepseek),
        gemini: toNum(spend.gemini),
        anthropic: toNum(spend.anthropic),
        codex: toNum(spend.codex),
      },
    },
  };

  model.nextSteps = makeNextSteps(model);

  const md = [
    `# System Dashboard`,
    ``,
    `Generated: ${model.generatedAt}`,
    ``,
    `## Runtime`,
    ...model.runtime.coreServices.map((s) => `- ${s.name}: ${s.status}`),
    ``,
    `## Database + Schema`,
    `- Migrations: ${model.database.appliedMigrations}/${model.database.migrationFiles} applied`,
    `- Pending migrations: ${model.database.pendingMigrations}`,
    `- Schema OK: ${model.schema.ok ? "YES" : "NO"}`,
    `- Invalid constraints/indexes: ${model.schema.invalidConstraints}/${model.schema.invalidIndexes}`,
    ``,
    `## Disk`,
    `- Data used: ${Number(model.disk.dataUsedGb || 0).toFixed(2)} GB`,
    `- Data available: ${Number(model.disk.dataAvailGb || 0).toFixed(2)} GB`,
    `- Data capacity: ${model.disk.dataCapacityPct}%`,
    ``,
    `## Dedupe`,
    `- Duplicate groups: ${model.dedupe.groups}`,
    `- Estimated recoverable: ${Number(model.dedupe.recoverableGb || 0).toFixed(2)} GB`,
    ``,
    `## Backup`,
    `- Backup verified: ${model.backup.ok ? "YES" : "NO"}`,
    `- Coverage OK: ${model.backup.coverageOk ? "YES" : "NO"}`,
    `- Duplicate-free backup: ${model.backup.duplicatesOk ? "YES" : "NO"} (groups=${model.backup.duplicateGroups})`,
    `- Last verify: ${model.backup.verifiedAt || "n/a"}`,
    `- Report: ${model.backup.reportFile || "n/a"}`,
    `- Context match (NAS/devices): ${model.backup.contextMatch ? "YES" : "NO"}`,
    ...model.backup.devices.map((d) => `- Device ${d.device}: ok=${d.ok} fresh=${d.fresh} entries=${d.entries} age_h=${d.ageHours ?? "n/a"}`),
    ``,
    `## Loyalty`,
    `- Webhooks queued/failed/processed: ${model.loyalty.queuedWebhooks}/${model.loyalty.failedWebhooks}/${model.loyalty.processedWebhooks}`,
    `- Domain events (24h): ${model.loyalty.domainEvents24h}`,
    ``,
    `## Credit`,
    `- Open/resolved issues: ${model.credit.openIssues}/${model.credit.resolvedIssues}`,
    `- Draft/queued actions: ${model.credit.draftActions}/${model.credit.queuedActions}`,
    ``,
    `## Model Routing`,
    `- Success/error calls (UTC): ${model.modelRouting.successCalls}/${model.modelRouting.errorCalls}`,
    `- Fallback invoked: ${model.modelRouting.fallbackInvoked}`,
    `- Low confidence count: ${model.modelRouting.lowConfidenceCount}`,
    `- Budget blocked: ${model.modelRouting.budgetBlocked}`,
    `- Spend total/openai/deepseek/gemini/anthropic/codex: ` +
      `$${Number(model.modelRouting.spendUsd?.total || 0).toFixed(4)}/` +
      `$${Number(model.modelRouting.spendUsd?.openai || 0).toFixed(4)}/` +
      `$${Number(model.modelRouting.spendUsd?.deepseek || 0).toFixed(4)}/` +
      `$${Number(model.modelRouting.spendUsd?.gemini || 0).toFixed(4)}/` +
      `$${Number(model.modelRouting.spendUsd?.anthropic || 0).toFixed(4)}/` +
      `$${Number(model.modelRouting.spendUsd?.codex || 0).toFixed(4)}`,
    ``,
    `## Task Status`,
    ...model.tasks.byStatus.map((r) => `- ${r.status}: ${r.n}`),
    ``,
    `## Next Steps`,
    ...model.nextSteps.map((s, i) => `${i + 1}. ${s}`),
    ``,
  ].join("\n");

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_MD, md);
  fs.writeFileSync(OUT_JSON, JSON.stringify(model, null, 2));

  console.log(`Wrote dashboard: ${OUT_MD}`);
  console.log(`Wrote data:      ${OUT_JSON}`);
  console.log("\nNext steps:");
  model.nextSteps.forEach((s, i) => console.log(`${i + 1}. ${s}`));

  await pool.end();
}

main().catch((e) => {
  console.error(`[system-dashboard] fatal: ${e.message}`);
  process.exit(1);
});
