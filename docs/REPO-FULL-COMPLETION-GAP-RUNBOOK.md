# Repo-by-Repo Full Completion Gap Analysis Runbook

**Goal:** For every indexed GitHub repo (product/claw-repos), run a gap analysis one at a time so that **no part, section, email setup, admin setup, or capability is left incomplete**. Use best case from benchmarking as the **truth** to perfect each repo.

---

## 1. Repo list (one at a time)

**Source:** `config/repo-completion-master-list.json`

- **priority_repos:** CookiesPass, TempeCookiesPass, payclaw, autopay_ui, CaptureInbound, capture, Inbound-cookies, quantfusion, v0-skyn-patch, infinitedata, LeadGen3, veritap, veritap_2026, booked, gbusupdate, InayanBuilderBot, nirvaan, etc.
- **additional_repos:** 3DGameArtAcademy, BlackWallStreetopoly, Coinstbl, FoodTruckPass, SmartKB, … (full list in config).

Only repos that **exist** under `$CLAW_REPOS` (or `$REPOS_BASE_PATH`) are run. Run **one repo at a time** until the full list is done.

---

## 2. Sections to complete (leave no part unfinished)

From `config/repo-completion-master-list.json` → **sections_to_complete**:

| Section | What “complete” means | Best-case source |
|--------|------------------------|------------------|
| **email_setup** | Provider configured, env documented, webhook/verification if applicable | docs/EMAIL_RESEND_MIGRATION.md; CaptureInbound / exemplar |
| **admin_setup** | Admin UI/routes present, nav wired, access control | oss-dashboard-benchmark, dashboard-chatbot-repo-scout ui_signals |
| **auth** | better-auth or standardized auth; no legacy-only without migration path | config/capabilities.yaml auth.better_auth; veritap_2026 |
| **stripe_checkout** | Checkout session creation, metadata, idempotency | autopay_ui, CaptureInbound, payclaw |
| **stripe_webhooks** | Signature verification, constructEvent, idempotency | capability-factory canonical; feature-benchmark exemplars |
| **telnyx_sms** | Telnyx messages + webhook, STOP/HELP, signature verify | payclaw, config/capabilities.yaml comms.telnyx.sms |
| **webhooks_signature_verify** | All webhooks verify signature | config/capabilities.yaml webhooks.signature_verify |
| **queue_retry** | Queue usage, retries, backpressure | claw-architect, quantfusion, trigger.dev patterns |
| **observability** | Logging, metrics, audit trail | feature-benchmark observability; veritap_2026 |
| **e2e** | Passing E2E or launch matrix entry | reports/*-launch-e2e-matrix.json; qa-human-grade |
| **security_sweep** | No critical/high from security sweep | npm run security:sweep; audit:deep |
| **capability_factory_health** | No critical/high issues; required capabilities present | config/capabilities.yaml; capability-factory report |
| **feature_benchmark_vs_exemplar** | Feature scores vs exemplar; gaps closed | feature-benchmark-score.js; data/exemplar-repos.json |

---

## 3. One-repo-at-a-time process

For **each** repo in the master list (in order):

### Step 1: Run single-repo capability factory

```bash
CLAW_REPOS_ROOT="${CLAW_REPOS:-$HOME/claw-repos}"
node scripts/capability-factory.js --root "$CLAW_REPOS_ROOT" --repos "<REPO_NAME>"
```

Example: `--repos "CookiesPass"`. Output: `reports/capability-factory/latest.json` (and timestamped files). Read **score**, **issues**, **capabilityFindings** for that repo.

### Step 2: Run feature benchmark for this repo (if indexed)

Repo must be in jCodeMunch index as `local/<RepoName>` (e.g. `local/CookiesPass`). If not indexed, run `index_folder` for `$CLAW_REPOS/<RepoName>` first.

```bash
node scripts/feature-benchmark-score.js --repo "local/<RepoName>" --source "repo_completion_gap"
```

Writes to DB and compares to exemplars. Use to see **feature_benchmark_vs_exemplar** gaps.

### Step 3: Record gap row and next actions

Use **scripts/repo-completion-gap-one.js** (see below) to:

- Run capability factory for that repo (Step 1).
- Optionally run feature benchmark (Step 2) if index exists.
- Build one **gap record**: repo, sections (complete/incomplete), issues, next_actions, best_case_ref.
- Append to **reports/repo-completion-gap-rolling.json** and write **reports/repo-completion-gap-<repo>-<timestamp>.json**.

### Step 4: Close gaps for this repo

From the gap record:

- **Critical/high issues** → follow capability-factory **nextActions** (e.g. add webhook signature verify, migrate auth, add tenant baseline).
- **Missing sections** (email_setup, admin_setup, etc.) → implement using best-case source (see table above and `config/repo-completion-master-list.json` → best_case_sources).
- **Feature benchmark deltas** → improve implementation toward exemplar (see feature-benchmark-score exemplar list).

Re-run Step 1–3 for the same repo until **all sections are complete** and **no critical/high** remain (per capability factory and security sweep).

### Step 4.5: Professional completion & QA (tested as best possible)

Before considering a repo **done**, run quality gates so the build is tested and QA'd:

1. In the repo: `npm install` then run (when defined in package.json): **check** (or build), **lint**, **test** or **test:ci**, **test:e2e** or **test:e2e:smoke**. The **repo_autofix** task does this automatically when queued by builder-gap-pulse; fix any failing step before marking complete.
2. Re-run gap analysis (Step 3); only consider done when **incomplete_sections=0** and **issues=0**.
3. Optionally record in SHIP_LOG or a short note that quality gates were run and passed.

See **docs/BUILDER-PROFESSIONAL-COMPLETION.md** and **agent-state/agents/builder/SOUL.md** for the builder’s professional completion checklist.

### Step 5: Move to next repo

Use `--next` to pick the next repo from the master list, or pass `--repo <name>` explicitly. Repeat until the full list is done.

---

## 4. Script: repo-completion-gap-one.js

**Commands:**

```bash
# Run gap analysis for one repo
npm run repo:completion:gap -- --repo CookiesPass

# Run for next repo in master list (by order, or first without recent completion)
npm run repo:completion:gap -- --next

# Dry run (no writes)
npm run repo:completion:gap -- --repo CookiesPass --dry-run
```

**Output:**

- **reports/repo-completion-gap-<repo>-<timestamp>.json** — single-repo gap record.
- **reports/repo-completion-gap-rolling.json** — appended array of all runs (so you can resume and see progress).

**Gap record shape:**

- `repo` — repo name
- `sections` — object: section id → `{ status: "complete"|"incomplete"|"gap", detail }`
- `issues` — from capability factory (critical/high)
- `next_actions` — from capability factory deriveActions + section-level actions
- `best_case_ref` — which exemplar/benchmark to use per section
- `capability_score`, `feature_benchmark_run` (if run)

---

## 5. Global checks (run periodically)

These are system-wide, not per-repo; run once per cycle and use results when judging “complete”:

- **System gap analysis:** `npm run audit:gaps` — Credit, Skynpatch, RepoNormalization, GlobalE2E, Background, Security, EmailPlatform.
- **Security sweep:** `npm run security:sweep` — use report to ensure no critical open.
- **E2E launch matrix:** `npm run e2e:launch:matrix` — ensure blocking_failures = 0 for repos in matrix.
- **GitHub scan:** `npm run github:scan` — baseline violations; fix critical per repo.

---

## 6. Success criteria (full completion)

For **each** repo in the master list:

- [ ] Capability factory: **no critical issues**, high issues closed or documented.
- [ ] All **sections_to_complete** either **complete** or **N/A** (with reason).
- [ ] Email setup: provider + env + webhook documented and working where applicable.
- [ ] Admin setup: admin UI/routes present and wired where applicable.
- [ ] Auth: standardized (better-auth) or explicit N/A.
- [ ] Stripe/webhooks/Telnyx: signature verify and idempotency where used.
- [ ] Feature benchmark: scores vs exemplar acceptable or improved.
- [ ] E2E: repo in launch matrix and passing, or explicitly out of scope.
- [ ] Security sweep: no critical/high for this repo’s surface.

**Benchmarking truth:** Best case comes from **config/repo-completion-master-list.json** → best_case_sources, **scripts/feature-benchmark-score.js** EXEMPLAR_LIBRARY, **config/capabilities.yaml**, and **reports/oss-dashboard-benchmark-latest.json** / scout UI signals. No part, section, email setup, or admin setup is left incomplete or unperfected against that truth.
