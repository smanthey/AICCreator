#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const os = require("os");
const pg = require("../infra/postgres");

const ROOT = path.join(__dirname, "..");
const ARGS = process.argv.slice(2);

function arg(flag, fallback = null) {
  const i = ARGS.indexOf(flag);
  if (i < 0 || i + 1 >= ARGS.length) return fallback;
  return ARGS[i + 1];
}

function has(flag) {
  return ARGS.includes(flag);
}

const DEFAULT_REPO_URL = "https://github.com/smanthey/payclaw";
const DEFAULT_LOCAL_PATH = path.join(
  process.env.REPOS_BASE_PATH || path.join(os.homedir(), "claw-repos"),
  "payclaw"
);

function writeIfMissing(filePath, content) {
  if (fs.existsSync(filePath)) return false;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return true;
}

function copyFile(src, dest) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return true;
}

function scaffoldRepo(repoPath) {
  fs.mkdirSync(repoPath, { recursive: true });

  const readme = `# PayClaw

Invoice payment collection via email and SMS — **not** debt collection. Invoices under 45 days only.

## Positioning

- Subscription-based macOS desktop app (DMG) that automates invoice payment reminders.
- Users supply debtor lists, amounts, due dates; system handles outreach and payment processing (Stripe Connect, Telnyx/10DLC).
- Built under the OpenClaw overseer; rules and compliance live in claw-architect and are copied here. See \`docs/CONTEXT.md\` and \`docs/COMPLIANCE.md\`.
- **Source:** This system is essentially a version of **AutopayAgent** (repo **autopay_ui**). The autopay_ui repo has **most of what PayClaw needs** — Stripe, Telnyx, webhooks, message flow, dashboard. It may need cleanup (single-tenant, desktop-only). Copy and adapt; do not rebuild from scratch. Repo: https://github.com/smanthey/autopay_ui ; local: \`~/claw-repos/autopay_ui\`. See \`docs/SOURCES.md\`.

## Summary dashboard (required)

- The app must include a **summary dashboard** where you can **upload** (e.g. CSV) or **manually add** the list (debtors/invoices: name, email, phone, invoice number, amount, due date, description). Show list summary, status, validate/dedupe; support export for audits.

## Status

- Scaffolding initialized by claw-architect launcher. Core implementation is done by creators in this repo using the rules and compliance from claw-architect.
`;

  const contextDoc = `# PayClaw Project Context (OpenClaw Overseer)

**Purpose:** Orientation for creators and swarm agents. Claw-architect does **not** build PayClaw; it provides rules, compliance, infrastructure, and an agent swarm that researches, manages, and updates the PayClaw repo so creators can build it quickly and correctly.

## Repo and product

- **PayClaw repo:** https://github.com/smanthey/payclaw
- **Product:** PayClaw Lite — subscription-based macOS desktop app (DMG) for invoice payment collection via email and SMS. Users supply debtor lists, amounts, due dates; system handles outreach and payment processing. **Not** debt collection; invoices under 45 days only.
- **Source:** PayClaw is a version of **AutopayAgent** (repo **autopay_ui**). Copy as much as works from autopay_ui (Stripe, Telnyx, webhooks, message flow). Do not copy auth or multi-tenant — single-tenant / desktop, Stripe Connect–only.
- **Summary dashboard (required):** The program must have a summary dashboard where the user can **upload** (e.g. CSV) or **manually add** the list (debtors/invoices). Dashboard shows list summary, status, validate/dedupe; export for audits.

## Where things live in claw-architect

| What | Location |
|------|----------|
| **Rules** (must follow when working on PayClaw) | In claw-architect: \`.cursor/rules/payclaw-overseer.mdc\` |
| **Compliance** (canonical) | In claw-architect: \`docs/payclaw/COMPLIANCE.md\`, \`config/payclaw/risk-categories.json\`, \`config/payclaw/message-templates.txt\` — copies are in this repo under \`docs/\` and \`config/payclaw/\`. |
| **Code sources** (Swift, git repos to copy from) | \`docs/SOURCES.md\` — autopay_ui paths, Swift/Mac shell references, capability names. Read before implementing. |
| **Research** (Telnyx, Stripe Connect, DMG) | In claw-architect: \`docs/payclaw/RESEARCH.md\` or \`agent-state/payclaw-research/\` |
| **Launcher** | \`npm run payclaw:launch\` in claw-architect (seed repo, copy compliance, register managed_repos). Re-run to sync latest compliance. |

## How the swarm operates

1. **Research:** Keeps PayClaw-specific docs (Telnyx 10DLC, Stripe Connect, Electron DMG) updated in claw-architect.
2. **Manage:** PayClaw is in \`managed_repos\`; mission control or recurring tasks can report repo status.
3. **Update:** Swarm can re-run the launcher to re-copy compliance, or queue opencode_controller to update this repo per rules.

## Creators

Humans or agents who implement PayClaw in this repo. Use the rules and compliance; the swarm oversees and equips.
`;

  const migrationStub = `-- PayClaw schema stub (intended shape for creators)
-- Canonical: merchants, numbers, invoice_jobs, message_schedule; see plan and docs.

-- merchants: id, stripe_account_id, telnyx_number_id, business_type, risk_level, approved, attestation, ...
-- numbers: telnyx_number_id, assigned_merchant_id, campaign_id
-- invoice_jobs, message_schedule, etc.
`;

  const created = [];
  if (writeIfMissing(path.join(repoPath, "README.md"), readme)) created.push("README.md");
  if (writeIfMissing(path.join(repoPath, "docs", "CONTEXT.md"), contextDoc)) created.push("docs/CONTEXT.md");
  if (writeIfMissing(path.join(repoPath, "migrations", "001_schema_stub.sql"), migrationStub)) created.push("migrations/001_schema_stub.sql");

  return created;
}

function copyCompliance(repoPath) {
  const copies = [];
  if (copyFile(path.join(ROOT, "docs", "payclaw", "COMPLIANCE.md"), path.join(repoPath, "docs", "COMPLIANCE.md"))) copies.push("docs/COMPLIANCE.md");
  if (copyFile(path.join(ROOT, "docs", "payclaw", "SPEC.md"), path.join(repoPath, "docs", "SPEC.md"))) copies.push("docs/SPEC.md");
  if (copyFile(path.join(ROOT, "docs", "payclaw", "SOURCES.md"), path.join(repoPath, "docs", "SOURCES.md"))) copies.push("docs/SOURCES.md");
  if (copyFile(path.join(ROOT, "config", "payclaw", "risk-categories.json"), path.join(repoPath, "config", "payclaw", "risk-categories.json"))) copies.push("config/payclaw/risk-categories.json");
  if (copyFile(path.join(ROOT, "config", "payclaw", "message-templates.txt"), path.join(repoPath, "config", "payclaw", "message-templates.txt"))) copies.push("config/payclaw/message-templates.txt");
  if (copyFile(path.join(ROOT, "config", "payclaw", "attestations.txt"), path.join(repoPath, "config", "payclaw", "attestations.txt"))) copies.push("config/payclaw/attestations.txt");
  return copies;
}

async function ensureManagedRepo(clientName, repoUrl, localPath, branch, notes, dryRun) {
  const select = await pg.query(
    `SELECT id, client_name, repo_url, local_path, branch, notes, status
       FROM managed_repos
      WHERE lower(client_name) = lower($1)
      LIMIT 1`,
    [clientName]
  );

  if (select.rows.length > 0) {
    if (dryRun) {
      return { action: "exists", row: select.rows[0] };
    }
    const row = select.rows[0];
    await pg.query(
      `UPDATE managed_repos
          SET repo_url = $2,
              local_path = $3,
              branch = $4,
              notes = COALESCE($5, notes),
              status = 'active'
        WHERE id = $1`,
      [row.id, repoUrl, localPath, branch, notes || row.notes]
    );
    return { action: "updated", id: row.id };
  }

  if (dryRun) {
    return { action: "would_insert", client_name: clientName, repo_url: repoUrl, local_path: localPath };
  }

  const ins = await pg.query(
    `INSERT INTO managed_repos (client_name, repo_url, branch, local_path, notes, status)
     VALUES ($1, $2, $3, $4, $5, 'active')
     RETURNING id`,
    [clientName, repoUrl, branch, localPath, notes]
  );
  return { action: "inserted", id: ins.rows[0].id };
}

async function main() {
  const dryRun = has("--dry-run");
  const repoUrl = String(arg("--repo-url", DEFAULT_REPO_URL));
  const branch = String(arg("--branch", "main"));
  const localPath = String(arg("--local-path", DEFAULT_LOCAL_PATH));
  const includeScaffold = !has("--no-scaffold");

  let scaffoldCreated = [];
  if (includeScaffold && !dryRun) {
    scaffoldCreated = scaffoldRepo(localPath);
  }

  const complianceCopied = [];
  if (!dryRun) {
    fs.mkdirSync(localPath, { recursive: true });
    const list = copyCompliance(localPath);
    complianceCopied.push(...list);
  }

  const managed = await ensureManagedRepo(
    "PayClaw",
    repoUrl,
    localPath,
    branch,
    "PayClaw invoice payment collection (OpenClaw overseer). Rules/compliance in claw-architect; launcher copies into repo.",
    dryRun
  );

  // Optional: queue opencode_controller via dashboard or goal-autopilot; launcher does not queue by default.
  const queued = [];

  console.log(JSON.stringify({
    ok: true,
    dry_run: dryRun,
    client_name: "PayClaw",
    repo_url: repoUrl,
    local_path: localPath,
    managed_repo: managed,
    scaffold_created: scaffoldCreated,
    compliance_copied: complianceCopied,
    queued,
  }, null, 2));
}

main()
  .catch((err) => {
    console.error("[payclaw-launch] fatal:", err.message || String(err));
    process.exit(1);
  })
  .finally(async () => {
    await pg.end().catch(() => {});
  });
