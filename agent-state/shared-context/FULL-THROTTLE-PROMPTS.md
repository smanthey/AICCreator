# Full-Throttle Prompt Pack (Senior Dev)

Use these prompts for high-signal execution with minimal drift.

## 1) Senior Gap Closure (Primary)
"Run a senior-engineer deep audit on this repo/system. Find concrete failures and risky gaps in runtime, queues, schema, workflows, and monetization paths. Prioritize by business impact and failure probability. For each finding: include exact file/line, failing command/query, root cause, patch plan, and verification command. Apply fixes directly, rerun gates, and iterate until no blocking failures remain."

## 2) Queue Completion Without Breaks
"Treat this as a queue-drain mission. Inspect all active queues, dead letters, retries, stuck/dispatched tasks, and stale workers. Classify causes into: transient, deterministic bug, bad payload, infra bottleneck. Auto-requeue only transient cases; quarantine deterministic failures with reason tags; patch root causes in code/config; re-run dispatcher/workers; verify queue depth trend is down and no new dead-letter burst occurs."

## 3) Monetization-First SaaS Completion
"Focus only on SaaS completion and revenue acceleration first. Run capability rollout, launch E2E, human QA, service-listing generation, pricing package refresh, and proposal/audit-pack generation. Ship artifacts with timestamps and report: what was completed, what still blocks launch, and exact next 3 actions with ETA. Keep non-monetization work as background maintenance only."

## 4) No-Skip Workflow Walkthrough
"Walk every intended flow step-by-step as a user and as an operator. Verify prerequisites, branch conditions, retries, idempotency, and error paths. Mark each step as pass/fail with evidence. If a step is skipped or weakly validated, add a deterministic test and fix the implementation."

## 5) Audit Noise vs Real Failure Filter
"Differentiate actionable failures from expected/known states. Do not ignore true failures. Convert static brittle checks into policy-backed checks with strict mode and default mode, with explicit thresholds in env vars."

## 6) Continuous Improvement Loop
"After each run: append learnings to agent memory, promote recurring fixes into config defaults, and schedule recurring jobs. Output only measurable deltas: failures reduced, queue latency reduced, launch readiness increased, and revenue artifacts produced."

## Operating Rules
- Do not ask for input when code/config can answer it.
- Prefer codebase-first decisions with file references.
- Never leave a failing gate untriaged.
- End every run with verification commands and artifact paths.
