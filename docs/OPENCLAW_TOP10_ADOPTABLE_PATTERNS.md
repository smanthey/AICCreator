# OpenClaw Top 10 Adoptable Patterns -> Claw-Architect File Map

This extracts practical patterns from the OpenClaw ecosystem direction (skills-first execution, strict tool boundaries, evented orchestration, safety gating) and maps each to concrete files in this repo.

## 1) Skill/Instruction Layering with Precedence
- Pattern: Load instructions from multiple scopes with deterministic precedence (workspace > user > bundled).
- Current files:
  - `agents/registry.js`
  - `agents/orchestrator.js`
  - `context/TOOLS.md`
  - `config/task-routing.js`
- Adopt now:
  - Add explicit precedence resolver and conflict logging in `agents/registry.js`.
  - Emit selected source scope in task telemetry (`task_runs.metadata`).
- Status: Partial

## 2) Declarative Agent Contract per Capability
- Pattern: Every agent declares reads/writes/tools/events to prevent hidden behavior.
- Current files:
  - `agents/registry.js`
  - `schemas/task.js`
  - `schemas/payloads.js`
  - `scripts/task-contract-audit.js`
- Adopt now:
  - Add `reads`, `writes`, `emits`, `requires_policy` as required fields in registry entries.
  - Fail startup if registered agents lack contract fields.
- Status: Partial

## 3) Deterministic Policy Gate Before Any Mutation
- Pattern: AI can suggest; deterministic policy approves/blocks mutations.
- Current files:
  - `control/policy-engine.js`
  - `control/opa-client.js`
  - `policy/opa/claw-policy.rego`
  - `scripts/policy-gate-assert.js`
- Adopt now:
  - Require policy decision ID on all mutating task completions (`tasks`, `task_runs`).
  - Enforce deny-by-default for new mutating task types.
- Status: Strong

## 4) Idempotent Event Spine
- Pattern: Event handlers must be replay-safe with deterministic idempotency keys.
- Current files:
  - `control/idempotency.js`
  - `control/task-runs.js`
  - `scripts/webhook-server.js`
  - `migrations/033_task_runs_idempotency.sql`
- Adopt now:
  - Standardize key format: `source:type:entity:version`.
  - Add duplicate-hit metric and dashboard panel in `scripts/system-dashboard.js`.
- Status: Strong

## 5) Queue Segmentation by Work Class + Capability Tags
- Pattern: Separate queues and tag-aware workers to isolate heavy/sensitive workloads.
- Current files:
  - `workers/worker.js`
  - `control/dispatcher.js`
  - `ecosystem.background.config.js`
  - `scripts/verify-runtime-topology.js`
- Adopt now:
  - Add mandatory route matrix audit: task type -> allowed queues -> required tags.
  - Block enqueue when route matrix missing.
- Status: Strong

## 6) Fallback-Aware Model Routing with Budget Caps
- Pattern: Local-first routing, confidence gates, provider fallback, hard budget enforcement.
- Current files:
  - `infra/model-router.js`
  - `infra/confidence.js`
  - `config/model-routing-policy.json`
  - `control/budget.js`
  - `scripts/model-spend-report.js`
  - `scripts/model-routing-stats.js`
- Adopt now:
  - Add per-task emergency throttle behavior at 80/90/100% caps in router runtime (not only reports).
  - Persist escalation_reason taxonomy (`timeout|low_confidence|parse_error|policy|budget_blocked`) uniformly.
- Status: Strong

## 7) DLQ + Replay/Reconcile Loop (Not Manual-Only)
- Pattern: Dead letters are first-class with deterministic requeue/cancel policies.
- Current files:
  - `control/dlq.js`
  - `control/retry.js`
  - `scripts/dead-letter-reconcile.js`
  - `cli/dead-letters.js`
- Adopt now:
  - Add `retry_profile` per task type in config and enforce in dispatcher.
  - Auto-open operator alert when DLQ rate breaches threshold.
- Status: Strong

## 8) Schema-First Dispatch Guard
- Pattern: Validate payload contracts before tasks hit workers.
- Current files:
  - `schemas/payloads.js`
  - `scripts/schema-mismatch-audit.js`
  - `scripts/qa-fast.js`
  - `control/inserter.js`
- Adopt now:
  - Add compatibility versioning: `payload_schema_version` on tasks.
  - Refuse execution when payload version unsupported by agent.
- Status: Strong

## 9) Security-by-Default Skill/Tool Supply Chain
- Pattern: Treat third-party skills/tools as untrusted code; continuously scan secrets/deps/runtime.
- Current files:
  - `agents/security-agent.js`
  - `scripts/security-secrets-scan.js`
  - `scripts/security-deps-audit.js`
  - `scripts/security-runtime-audit.js`
  - `scripts/security-sweep.js`
- Adopt now:
  - Add allowlist gate for executable external scripts/skills before registration.
  - Store scan attestations in DB (`security_scan_runs`) for trend tracking.
- Status: Partial

## 10) Observable Control Plane (Explain Every Decision)
- Pattern: Every routing/policy/fallback decision is queryable by operators.
- Current files:
  - `control/metrics.js`
  - `gateway/telegram.js`
  - `scripts/platform-health-report.js`
  - `scripts/system-dashboard.js`
  - `migrations/055_model_usage_routing_telemetry.sql`
- Adopt now:
  - Add unified `decision_trace_id` across dispatcher -> router -> policy -> worker.
  - Expose single CLI report for any task ID: route, policy verdict, model spend, retries, DLQ state.
- Status: Partial

---

## Priority Execution Order (next)
1. Registry contract hardening (`agents/registry.js`, `scripts/task-contract-audit.js`).
2. Route matrix hard-blocking (`control/dispatcher.js`, `config/task-routing.js`).
3. Security allowlist + scan attestations (`agents/security-agent.js`, migrations + scripts).
4. Decision trace unification (`control/*`, `scripts/system-dashboard.js`).

