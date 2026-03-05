## Foreman Coordination & PayClaw Patterns

This document defines how agents should coordinate modernization work on `claw-architect` and related repos, and how they must capture PayClaw-relevant knowledge as they go. Treat this as the foreman playbook.

---

## 1. Roles and Queues

### 1.1 Coordinator (Foreman) Agent

- **Responsibilities**
  - Own the goal: keep `claw-architect` aligned with Week‑7 standards while building the PayClaw design.
  - Maintain four modernization queues:
    - `trigger_queue` – Trigger.dev tasks and background jobs.
    - `pm2_queue` – PM2/process management and uptime scripts.
    - `state_queue` – JSON state → Postgres/Redis (high‑risk flows first).
    - `email_queue` – Email provider cleanup and abstraction (Resend/Maileroo/MailerSend).
  - Maintain a separate **`payclaw_notes_queue`** for documentation tasks.
  - Ensure queues are never empty while MCP scans still show offenders.

- **Ground rules**
  - All work items must be **MCP-locatable**:
    - Include `repo`, `file`, and a brief description (`symbol` or `line` region).
  - Do not schedule work without a clear success condition (what must be true in the codebase when the task is done).
  - After each batch of changes, schedule a **follow‑up MCP scan** around the changed areas.

### 1.2 Research (Pattern Miner) Agents

- **Responsibilities**
  - Use MCP tools (`search_symbols`, `get_symbol`, `search_text`, `get_repo_outline`) across `local/*` repos to:
    - Find **canonical implementations** for:
      - Trigger.dev v4 tasks (`@trigger.dev/sdk`).
      - Async PM2 usage (non‑blocking `pm2 jlist` patterns).
      - DB/Redis-backed state machines (Postgres + Redis).
      - Email providers (Resend, Maileroo, MailerSend) and webhooks.
      - Monetization: Stripe checkout, webhooks, pricing tiers, lead → pay flows.
    - Tag each pattern as **PayClaw‑relevant** or not.
  - Produce short **pattern specs** that implementation agents can follow.

### 1.3 Implementation (Modernizer) Agents

- **Responsibilities**
  - Continuously pull from `trigger_queue`, `pm2_queue`, `state_queue`, and `email_queue`.
  - For each item:
    - Fetch only the required symbols/snippets using MCP (`get_symbol`, `get_file_outline`) instead of opening whole files.
    - Apply the relevant canonical pattern from the latest research spec.
    - Keep behavior equivalent wherever there is user‑visible or API‑visible behavior.
  - When finishing a task:
    - Emit a short **PayClaw note** if the change touches payments, webhooks, infra, state machines, or email sending (see section 3).
    - Notify QA/safety agents which files/symbols changed so they can rescan.

### 1.4 QA / Safety Agents

- **Responsibilities**
  - Run focused tests and health checks on changed surfaces:
    - Trigger.dev flows and background jobs.
    - PM2/uptime scripts and dashboards.
    - DB/Redis state access layers and migrations.
    - Email sending and webhooks.
  - Use MCP `search_text` and `search_symbols` to confirm landmines are gone:
    - No `client.defineJob` or other deprecated Trigger.dev v2 patterns.
    - No `execSync` on hot PM2/process paths (scripts that run frequently or via API).
    - No high‑risk JSON read‑modify‑write state in concurrent paths.
    - No unsafe token usage (e.g., UPDATE without cross‑checked plan/approval IDs).
  - When problems are detected:
    - Push precise fix tasks back into the relevant queue with enough MCP context to reproduce.

### 1.5 Documentation / PayClaw Agents

- **Responsibilities**
  - Maintain a living **PayClaw design and patterns doc** (can extend this file or point to a dedicated `docs/PAYCLAW-DESIGN.md`).
  - Continuously ingest **PayClaw notes** from implementation and research tasks.
  - Cross‑link each section to concrete examples via:
    - Repo: e.g., `local/claw-architect`, `local/v0-skyn-patch`, `local/BlackWallStreetopoly`.
    - File paths and symbol names, so future agents can jump straight to code using MCP.

---

## 2. MCP Usage Pattern

All agents should prefer MCP tools over raw file reads for discovery:

- **Index & outline**
  - `list_repos` – see all indexed repos.
  - `get_repo_outline` – high‑level structure and language breakdown for a repo.

- **Finding code**
  - `search_symbols` – locate functions/classes/methods by name or semantic query.
  - `search_text` – find string patterns (e.g., `execSync`, `.json`, `MailerSend`, `Maileroo`).

- **Reading code**
  - `get_symbol` – fetch implementation of a specific symbol plus optional context.
  - `get_file_outline` – understand structure of a large file and pick the relevant symbol ranges.

**Rule of thumb:** start with MCP to discover and scope, then only open full files locally when necessary for complex edits.

---

## 3. PayClaw Notes Protocol

Every task that touches **payments, queues, webhooks, state machines, model routing, or email** must emit a short **PayClaw note**. This keeps PayClaw design up to date as modernization proceeds.

### 3.1 PayClaw Note Template

For each relevant task, add a note with:

- **Context** – what was changed and in which repo/file/symbol.
- **Pattern** – what new or existing pattern it demonstrates (e.g., Stripe webhook idempotency, retry+DLQ, queue limits, unified email).
+- **Implication for PayClaw** – how this should influence PayClaw’s design (requirements, constraints, gotchas).

Keep notes concise (1–3 bullets per task) but concrete enough for other agents to reuse.

---

## 4. Initial Modernization Inventory (local/claw-architect)

This section captures the first MCP‑driven inventory of modernization targets in `local/claw-architect`. Treat it as a seed for the queues; do not assume it is exhaustive.

### 4.1 Trigger.dev

- **Findings**
  - MCP `search_text` for `client.defineJob` returned **no results** in `local/claw-architect`, which is good (no obvious v2 jobs).
  - Agents should still scan for:
    - `@trigger.dev/sdk` imports and usages.
    - Any `triggerAndWait` or `batchTriggerAndWait` usages wrapped in `Promise.all` or similar concurrency patterns (not supported).
  - Where Trigger.dev is used, verify:
    - `retry` blocks are present and sensible.
    - `queue` configuration matches the guidelines in `AGENTS.md` and Trigger.dev docs.
    - Idempotency is enforced on payment/critical tasks using `idempotencyKeys`.

- **Queue seeding**
  - Add tasks to audit all Trigger.dev usages for:
    - Retry/queue configuration.
    - Correct `triggerAndWait` semantics.
    - Missing `schemaTask` where validation is appropriate.

### 4.2 PM2 and Process Management

- **Findings**
  - MCP `search_text` for `execSync` in `local/claw-architect` found many usages, including:
    - `scripts/architect-api.js` – imports `execSync` along with `exec`, `spawnSync`, `spawn`.
    - `scripts/auto-recovery-pulse.js`, `scripts/auto-start-all.js`, `scripts/brand-control-plane.js` – use `execSync` with `pm2 jlist`, `pm2 restart`, `pm2 save`, and `pm2 startup`.
    - `control/entropy-monitor.js`, `scripts/agent-drift-audit.js`, `scripts/discord-health-check.js`, `control/dependency-health-check.js`, `scripts/agent-toolkit.js`, and various agents/scripts – use `execSync` for system introspection and utilities.
  - Some of these are acceptable one‑shot scripts; others are in recurring processes or health checks and should be moved to async patterns or isolated from hot paths.

- **Queue seeding**
  - Classify each `execSync` usage by:
    - **Frequency**: one‑shot CLI vs recurring watchdog vs on‑demand API.
    - **Impact**: whether it runs on the same Node process that serves HTTP or manages many agents.
  - Prioritize tasks to:
    - Create or extend an async PM2 helper that wraps `pm2 jlist` and `pm2 restart` without blocking the event loop.
    - Replace high‑impact `execSync` PM2 invocations with helper calls.

### 4.3 JSON and State Files

- **Findings**
  - MCP `search_text` for `.json` shows extensive usage across agents and control scripts:
    - `.stripe-products.json` – Stripe product configs, used by `agents/leadgen-agent.js` and `config/products.js`.
    - `.google-tokens.json` – auth tokens in `agents/google-workspace-agent.js`.
    - `status-review-*-latest.json` and other report JSON files in `agents/*` and `scripts/reports/` – used for dashboards and status history.
    - Various schema and manifest JSON files in repo sync agents.
  - Many of these are **reports, manifests, or local tokens**, not shared state; the high‑risk cases are where JSON is used as a **concurrent action history/state store**, which should be migrated to Postgres.

- **Queue seeding**
  - Identify and prioritize:
    - Any JSON file that is:
      - Written by multiple agents or processes.
      - Read/modified frequently as part of action history or dashboard state.
    - Plan migrations to:
      - Postgres tables for durable history and state machines.
      - Redis for ephemeral counters and rate limits.

### 4.4 Email Providers

- **Findings**
  - MCP searches for `MailerSend` and `Maileroo` show:
    - `MailerSend` mostly appears in search/config patterns and site‑audit hints.
    - `Maileroo` is heavily used in `agents/brand-provision-agent.js` for:
      - Domain creation and verification.
      - Sender identity creation.
      - Webhook registration.
      - API key handling and error logging.
  - In `claw-architect` itself, there is already a **unified `sendEmail()` abstraction** in `infra/send-email.js` (per separate survey outputs), but some satellite repos still import or use raw Maileroo behavior.

- **Queue seeding**
  - For `local/claw-architect`:
    - Ensure all new email sending behavior goes through a provider abstraction (Resend/Maileroo) instead of direct API clients.
    - Where Maileroo is still used directly, consider adding a small wrapper that mirrors the unified pattern.
  - For site repos:
    - Use the separate survey reports (see section 5) to define per‑site migration tasks from MailerSend/Maileroo to Resend once credentials are ready.

---

## 5. PayClaw‑Relevant Canonical Patterns (from Surveys)

This section ingests key findings from three completed local_agent survey tasks and translates them into PayClaw design inputs.

### 5.1 Email Infrastructure and Provider Migration

**Canonical patterns**

- `infra/send-email.js` in `claw-architect`:
  - Unified `sendEmail(opts)` entrypoint that selects provider (Resend vs Maileroo) based on:
    - Explicit `provider` param, then config, then environment variables.
  - Supports fallback when both API keys exist and `EMAIL_FALLBACK_ENABLED !== "false"`.
- Site‑level patterns:
  - `v0-skyn-patch`:
    - Mixed environment with MailerSend, Resend, and Maileroo, each having webhook routes.
    - Uses Svix for Resend webhook signature verification and comprehensive event tracking for MailerSend.
  - `BlackWallStreetopoly`:
    - Mature MailerSend integration with admin UIs and analytics routes.

**Implications for PayClaw**

- PayClaw should use a **unified email provider abstraction** that:
  - Chooses the active provider(s) per site via config/env.
  - Integrates Resend as the default provider once credentials are present.
  - Optionally supports fallback or dual delivery where both providers are configured.
- Webhook handlers must:
  - Verify signatures using provider‑specific mechanisms (e.g., Svix for Resend).
  - Write to structured tables like `email_logs`, `webhook_events`, `email_suppressions`.

### 5.2 Model Routing and LLM Budgets

**Canonical patterns**

- `infra/model-router.js` in `claw-architect`:
  - Central model registry with explicit per‑model cost metadata.
  - Budget tracking per provider using Redis with 24‑hour TTLs.
  - Enforced policy file `config/model-routing-policy.json` and env flags:
    - `ROUTER_POLICY_ENFORCE`, `ROUTER_BUDGET_HARD_BLOCK`, `MODEL_CONFIDENCE_THRESHOLD`, `*_DAILY_BUDGET_USD`.

**Implications for PayClaw**

- Any LLM‑driven PayClaw features (e.g., risk scoring, fraud heuristics, smart notifications) should:
  - Use the existing router instead of raw SDK calls.
  - Respect budget constraints and fallbacks.
  - Record LLM cost usage in a way that can be reconciled with Stripe revenue.

### 5.3 Retry, DLQ, and Dispatcher

**Canonical patterns**

- `control/retry.js` and related modules:
  - Exponential backoff with jitter, capped backoff, and retry limits.
  - Dead‑letter queue and cascade skip behavior for dependent tasks.
- `control/dispatcher.js`:
  - BullMQ queues backed by Redis.
  - PostgreSQL task state machine (`CREATED → DISPATCHED → RUNNING → COMPLETED/DEAD_LETTER`).
  - `FOR UPDATE SKIP LOCKED` to safely acquire work.
  - Audit logging on each state transition.

**Implications for PayClaw**

- PayClaw background jobs (billing, invoicing, reconciliation, refunds) should:
  - Reuse the existing dispatcher and retry/DLQ patterns.
  - Ensure every critical task has:
    - A clear max retry count and backoff policy.
    - Dead‑letter handling that surfaces issues to operators.

### 5.4 Monetization and Stripe Patterns

**Canonical patterns**

- `BlackWallStreetopoly`:
  - Full‑featured Stripe integration:
    - Checkout session creation with promotion codes, email capture, and dynamic product catalog.
    - Webhooks with idempotency keys, signature verification, and deduplication.
    - Admin endpoints for resends, analytics, and emergency processing.
  - Shippo integration and full audit trails.
- `v0-skyn-patch`:
  - Advanced checkout with multi‑item cart, shipping thresholds, rate limiting, and multiple tracking pixels.
  - Recovery and test routes for Stripe orders.
- `claw-architect`:
  - `scripts/payment-router.js` and `scripts/bot-commerce.js` implement:
    - Multi‑rail payments (Stripe, crypto) and bot‑driven flows (Discord, WhatsApp, Telegram).
    - Pending charge stores and JSONL audit logs.

**Implications for PayClaw**

- PayClaw should:
  - Adopt webhook idempotency and signature verification as non‑negotiable.
  - Use database‑backed ledgers for payments, not just logs.
  - Provide admin tooling for:
    - Resending receipts/notifications.
    - Recovering orders.
    - Inspecting Stripe event history.

---

## 6. How to “Finish Tasks” as an Agent

When an agent picks up work under this framework, a task is only considered **finished** when:

1. The code or configuration change is complete and passes relevant tests/health checks.
2. MCP scans in the affected area confirm the targeted pattern has been modernized (or is explicitly accepted as‑is).
3. If the work is PayClaw‑relevant, a **PayClaw note** was produced and ingested by documentation agents.
4. Any follow‑up items (migrations, additional refactors) are pushed back into the appropriate queue with clear MCP context.

Following this playbook keeps modernization continuous and ensures PayClaw’s design gets richer over time without requiring separate discovery sprints.

---

## 7. Queue Backlogs and No‑Dependency Work

This section over‑provisions the work queues with concrete, MCP‑addressable tasks. Idle agents should pull from here whenever they have capacity. Most items are deliberately **low‑dependency** so they can be executed in parallel without blocking.

### 7.1 `trigger_queue` (Trigger.dev / background jobs)

Repo: `local/claw-architect`

- **Audit Trigger.dev usage**
  - Scan for all imports from `@trigger.dev/sdk` and:
    - Ensure each `task`/`schemaTask` has a `retry` block appropriate to its external dependencies.
    - Ensure any `triggerAndWait` / `batchTriggerAndWait` calls:
      - Are **not** wrapped inside `Promise.all` / `Promise.allSettled`.
      - Correctly check `result.ok` before reading `result.output`.
  - Output: list of symbols where patterns were fixed or confirmed.
- **Standardize queue configuration**
  - For each Trigger.dev task:
    - Confirm queue configuration follows the patterns in `AGENTS.md` (e.g., rate limits for email/Stripe/webhooks).
    - Where missing, add or align `queue` config so high‑volume tasks do not overload external services.
- **Schema validation pass**
  - Identify tasks with complex payloads and no validation.
  - Convert suitable ones to `schemaTask` with a minimal `zod` schema, following patterns from Trigger‑heavy repos.

These tasks can be tackled per‑symbol without cross‑team coordination.

### 7.2 `pm2_queue` (PM2 / process management)

Repo: `local/claw-architect`

- **Classify `execSync` usages (already discovered via MCP)**
  - Files to examine:
    - `scripts/architect-api.js`
    - `scripts/auto-recovery-pulse.js`
    - `scripts/auto-start-all.js`
    - `scripts/brand-control-plane.js`
    - `control/entropy-monitor.js`
    - `scripts/agent-drift-audit.js`
    - `scripts/discord-health-check.js`
    - `control/dependency-health-check.js`
    - `scripts/agent-toolkit.js`
  - For each call:
    - Tag as **one‑shot CLI**, **recurring watchdog**, or **API‑adjacent**.
- **Refactor high‑impact PM2 calls**
  - For recurring or API‑adjacent usage of:
    - `pm2 jlist`
    - `pm2 restart ...`
    - `pm2 save`
  - Introduce or extend a shared async helper that wraps these calls and refactor callers to use it, avoiding event‑loop blocking on hot paths.
- **Document safe `execSync` pockets**
  - Where `execSync` is acceptable (e.g., rare local CLI tools), annotate in code or docs so future agents know the call is intentionally left as is.

Each `execSync` call site can be modernized independently, making this ideal no‑dependency work.

### 7.3 `state_queue` (JSON → Postgres/Redis)

Repo: `local/claw-architect`

- **Map JSON state usage**
  - Confirm how the following are used:
    - `.stripe-products.json` (via `config/products.js` and `agents/leadgen-agent.js`).
    - `.google-tokens.json` (via `agents/google-workspace-agent.js`).
    - `status-review-*-latest.json` and other `*-latest.json` report files under `scripts/reports/` and `agents/*`.
  - Classify each as:
    - **Report/manifest** (low risk).
    - **Local secret/token** (single‑writer).
    - **Shared state** (high risk; concurrent read/modify/write).
- **Design DB/Redis replacements for high‑risk cases**
  - For any shared state JSON:
    - Propose a Postgres table or Redis key structure.
    - Sketch minimal migration steps (one‑time import script, then cutover).
- **Introduce access layers**
  - Add small modules that:
    - Read/write state via Postgres/Redis.
    - Optionally provide a one‑time import from existing JSON files.
  - Update a first wave of callers to use the access layer instead of direct file reads/writes.

Agents can execute these tasks per JSON domain (Stripe products, tokens, status reports) without waiting on global migrations.

### 7.4 `email_queue` (Email infra and providers)

Repos: `local/claw-architect`, `local/v0-skyn-patch`, `local/BlackWallStreetopoly`, other site repos as needed.

- **Unify sending through abstractions**
  - In `claw-architect`:
    - Confirm all new sending code goes through `infra/send-email.js` or a similar abstraction.
    - Where Maileroo is still called directly (e.g., `agents/brand-provision-agent.js`), introduce thin wrapper functions that match the abstraction semantics.
  - In site repos:
    - Identify direct MailerSend/Maileroo usage and plan to route it through a provider abstraction once Resend credentials exist.
- **Per‑site Resend readiness checks**
  - For `v0-skyn-patch`:
    - Verify presence of `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, and `EMAIL_PROVIDER=resend` (or add TODOs if missing).
    - Document the steps to switch primary sending from MailerSend to Resend once credentials are confirmed.
  - For `BlackWallStreetopoly` and others:
    - Record current MailerSend‑only patterns and preparation steps needed for Resend migration.

Most of this work is note‑driven and adapter‑driven; it can progress without immediate provider cutovers.

### 7.5 `payclaw_notes_queue` (Design & documentation)

Repos: `local/claw-architect`, `local/*` (for examples)

- **Expand PayClaw sections**
  - For each canonical pattern already identified (email, model router, retry/DLQ, dispatcher, Stripe flows), add:
    - A short, copy‑pasteable code reference via MCP symbol IDs.
    - Clear “do/don’t” bullets for PayClaw implementation.
- **Backfill notes from modernization work**
  - As agents execute tasks from the other queues:
    - Summarize any PayClaw‑relevant insight (e.g., a specific way `FOR UPDATE SKIP LOCKED` avoided a race, or how webhook idempotency is enforced) into the PayClaw design doc.
  - Ensure each note links back to:
    - The repo and file.
    - The symbol name or approximate MCP location.

These documentation tasks are intentionally parallelizable and can be picked up by any agent familiar with the code samples.

---

## 8. MCP Daily Sweep & Fix Loop

This section defines a repeatable **daily sweep** that uses the MCP symbol index to detect regressions and auto‑feed the modernization queues. Treat it as a checklist for a dedicated `mcp_sweep_agent` or as a human‑run playbook.

### 8.1 Repos to Include

At minimum:

- `local/claw-architect` (platform + agents)
- `local/BlackWallStreetopoly` (Stripe + MailerSend patterns)
- `local/v0-skyn-patch` (cart/checkout + mixed providers)
- `local/LeadGen3`, `local/Madirectory`, `local/SmartKB` (leadgen + infra)
- `local/quantfusion` (trading frontend) and trading‑related code in `claw-architect`

Additional repos can be added as needed.

### 8.2 Landmine Sweep (search_text)

For each repo above, run MCP `search_text` with these patterns and record matches:

- **Process / blocking patterns**
  - `execSync`
- **State / concurrency patterns**
  - `.json`
  - `dashboard-action-history.json`
- **Legacy provider or API patterns**
  - `client.defineJob`
  - `MailerSend`
  - `Maileroo`
  - raw `stripe.` SDK usage (outside shared helpers)
- **Other repo‑specific landmines**
  - Any additional strings listed in `CLAUDE.md` or discovered via incidents.

Each match becomes a candidate item in one of: `pm2_queue`, `state_queue`, or `email_queue`, depending on context.

### 8.3 Domain Drift Sweep (search_symbols)

For each repo, run MCP `search_symbols` for key domains and compare implementations:

- **Stripe / monetization**
  - Queries: `"stripe"`, `"webhook"`, `"create-checkout-session"`, `"payment_intent"`.
  - Goal: identify canonical webhook handlers, checkout creators, and admin tools (BWS, SkynPatch) and spot simpler or divergent patterns elsewhere.
- **Email**
  - Queries: `"sendEmail"`, `"MailerSend"`, `"Resend"`, `"Maileroo"`.
  - Goal: ensure sending flows trend toward unified abstractions and that webhooks follow best patterns.
- **Trigger.dev / background jobs**
  - Queries: `"task({ id:"`, `"schemaTask("`, `"triggerAndWait("`, `"batchTriggerAndWait("`.
  - Goal: confirm v4 patterns and safe `Result` handling are used consistently.
- **PM2 / health checks**
  - Queries: `"pm2 jlist"`, `"status_check"`, `"health"`, `"watchdog"`.
  - Goal: track where PM2 integration lives and whether it uses async patterns.
- **Trading**
  - In `claw-architect` and `quantfusion` repos:
    - Queries: `"trading_orders"`, `"trading_signals"`, `"trading_events"`, `"trading_daily_metrics"`.
  - Goal: find all writers and readers of trading tables to align them with audit fields and FK semantics.

The sweep should note where a domain’s pattern differs from the canonical implementation and turn those into modernization tasks.

### 8.4 Turning Sweep Results into Queue Items

After each sweep:

- **Classify each finding**
  - Landmine (must fix soon) vs. minor drift (can be scheduled later).
- **Create queue tasks**
  - For each landmine:
    - Add a work item to `pm2_queue`, `state_queue`, `email_queue`, or `trigger_queue` with:
      - Repo, file path, and a short description (what needs to change, e.g. “replace direct Maileroo call with sendEmail wrapper”).
  - For each domain drift:
    - Either schedule a refactor to match the canonical pattern or explicitly document why divergence is acceptable.

This ensures the modernization queues stay full without anyone manually scanning code line by line.

### 8.5 PayClaw Integration

During the sweep, any findings relevant to PayClaw (payments, Stripe, ledgers, risk, webhooks, trading) should:

- Be summarized as **PayClaw notes** (see section 3) and added to `payclaw_notes_queue`.
- Link back to specific symbols (via MCP) in:
  - `local/BlackWallStreetopoly` (webhooks, admin tools).
  - `local/v0-skyn-patch` (checkout, cart, rate limiting).
  - `local/claw-architect` (payment router, trading tables).

Over time, this daily MCP‑driven sweep builds both a cleaner codebase and a richer, live PayClaw design without separate discovery phases.

---

## 9. PayClaw (macOS) vs ClawPay (bot‑to‑bot rail)

To avoid confusion, treat **PayClaw** and **ClawPay** as two distinct but related systems:

- **PayClaw (macOS app / repo)**:
  - Native macOS app and backend focused on:
    - Full payment OS (Stripe integration, ledgers, invoices, reconciliations, admin tools).
    - Compliance, reporting, and operator workflows.
  - Lives in its own repo (e.g. `local/payclaw`), overseen by the PayClaw overseer rules.

- **ClawPay (bot‑to‑bot payment rail in `claw-architect`)**:
  - Messaging‑first payment rail used by **other bots** (Discord, Telegram, WhatsApp, API clients).
  - Lives inside `local/claw-architect`, primarily in:
    - `scripts/bot-commerce-api.js` – HTTP API for bots to purchase prompts.
    - `scripts/bot-commerce.js` – session manager and payment rail orchestrator.
    - `scripts/whatsapp-payment-setup.js` – WhatsApp + Stripe setup and verification.
    - `scripts/payment-router.js` – current payment rails (credits, Stripe, etc.).
  - Today ClawPay speaks “downward” directly to Stripe via `payment-router`. In the future it can also speak to PayClaw (macOS) as a backend, once PayClaw exposes a small HTTP/queue API.

**Key rule:** When you see “ClawPay agent” or “ClawPay rail” in this doc, think **bot‑to‑bot payment layer in `claw-architect`**. When you see “PayClaw” alone, think **macOS payment OS app/repo**.

---

## 10. ClawPay Agent – Bot‑to‑Bot Payments

This section summarizes the existing bot‑commerce implementation and defines a concrete ClawPay rail contract that agents should converge on.

### 10.1 Existing bot‑commerce surfaces

- `scripts/bot-commerce-api.js`
  - `handleBotPurchase(payload)`:
    - Payload:
      - `botId` (required)
      - `platform = "api"` (discord/telegram/etc)
      - `protocolType = "agent-intro"` (must exist in `PROMPT_CATALOG`)
      - `context = { botPlatform, botPurpose, targetBots }`
      - `paymentMethod = "credits" | "stripe" | "crypto"` (default `"credits"`)
      - `operatorName`
    - Behavior:
      - `credits`:
        - `deductCredit(botId)` via `payment-router`.
        - On success: synth `chargeId`, `rail="credits"`, `immediately_paid=true`, call `generateBotPrompt`, return `{ success: true, prompt, payment: { method: "credits", charge_id, paid: true }, credits }`.
        - On insufficient credits: `{ success: false, error: "insufficient_credits", credits }`.
      - `stripe`:
        - `createCharge({ rail: "stripe", userId: botId, platform, protocolType, operatorName, context })`.
        - Returns `{ success: true, requires_payment: true, payment_url, charge_id, expires_at }`.
      - `crypto`: currently `{ success: false, error: "not_implemented" }`.
  - HTTP endpoints:
    - `POST /api/bot/purchase` → `handleBotPurchase` (optional Bearer `BOT_COMMERCE_API_KEY`).
    - `GET /api/bot/credits?botId=...` → `getCredits`.
    - `POST /api/bot/credits/add` → `addCredits` (admin, API key).
    - `GET /api/bot/protocols` → list `PROMPT_CATALOG`.

- `scripts/bot-commerce.js`
  - Session machine: `DISCOVER → SELECT_TYPE → PROVIDE_CONTEXT → SELECT_PAYMENT → AWAIT_PAYMENT → DELIVER`.
  - Stores sessions in `agent-state/commerce/sessions/<platform>_<userId>.json`.
  - Uses `payment-router.createCharge({ rail, userId, platform, protocolType, operatorName, context })`.
    - `rail="stripe"`: get `payment_url`, go to `AWAIT_PAYMENT`.
    - `rail="credits"`: `immediately_paid=true`, call `deliverPrompt` immediately.
  - `setDeliveryHandler` (from `payment-router`) is wired to:
    - On payment confirmation, call `deliverPrompt({ userId, platform, chargeId })`.
  - `deliverPrompt`:
    - Reloads session, calls `generateBotPrompt` with stored `protocolType`, `botPlatform`, `botPurpose`, `targetBots`.
    - Sends via per‑platform delivery (`registerDeliveryRoute` / `routeDelivery`) or given `replyFn`.
    - `markDelivered(chargeId)` and clears session.
  - Integrates Telegram (polling) and WhatsApp (webhook) by passing messages into `handleCommerceMessage` and registering delivery routes per platform.

- `scripts/whatsapp-payment-setup.js`
  - Verifies env for ClawPay on WhatsApp + Stripe:
    - WhatsApp: `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`.
    - Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `COMMERCE_PUBLIC_URL`.
  - Prints expected webhook URLs:
    - `${COMMERCE_PUBLIC_URL}/webhooks/whatsapp`
    - `${COMMERCE_PUBLIC_URL}/webhooks/stripe`
  - Provides operator steps to run end‑to‑end WhatsApp payment tests.

### 10.2 Target ClawPay rail contract

ClawPay should be treated as a named rail that plugs into the existing `payment-router` interface and bot‑commerce flow:

- **Input from bot‑commerce / bot‑commerce-api:**

```json
{
  "rail": "clawpay",
  "userId": "<bot_or_operator_id>",
  "platform": "discord|telegram|whatsapp|api",
  "protocolType": "<prompt_protocol_id>",
  "operatorName": "<display_name>",
  "context": {
    "botPlatform": "<platform_string>",
    "botPurpose": "<purpose>",
    "targetBots": "<targets>"
  },
  "amount": 1.0,
  "currency": "USD",
  "metadata": {
    "source": "clawpay",
    "flow": "prompt_oracle",
    "bot_id": "<botId>"
  }
}
```

**Charge creation**

Implement a `rail="clawpay"` branch inside `payment-router.createCharge` that:

- Uses Stripe or an HTTP/queue API exposed by the PayClaw macOS app to create a charge.
- Returns an object shaped like the existing non‑credits rails:

```json
{
  "chargeId": "<string>",
  "rail": "clawpay",
  "payment_url": "<https_or_deeplink_url>",
  "immediately_paid": false,
  "expires_at": "<ISO8601_optional>"
}
```

**Webhook + confirmation**

- Backend (Stripe or PayClaw) delivers webhooks into `payment-router` as it does today.
- `payment-router` calls `setDeliveryHandler` with:

```json
{
  "chargeId": "<string>",
  "rail": "clawpay",
  "userId": "<bot_or_operator_id>",
  "platform": "discord|telegram|whatsapp|api"
}
```

- `bot-commerce`’s existing handler then calls `deliverPrompt(...)` and routes the message using the registered delivery routes.

### 10.3 Constraints

- All Stripe‑specific code for ClawPay must live in `payment-router` and/or the PayClaw macOS backend, not in `bot-commerce` or `bot-commerce-api`.
- Existing rails (`"credits"`, `"stripe"`) must keep working; `"clawpay"` is an additive rail.

This design gives OpenClaw a concrete contract for implementing ClawPay as a bot‑to‑bot payment rail, while keeping PayClaw (macOS) as an optional backend that can be plugged in behind `payment-router` later.
