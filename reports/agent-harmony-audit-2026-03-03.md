# Claw Architect Harmony Audit

Date: 2026-03-03
Scope: Whole-repo indexability, duplication/overlap, and agent/swarm management efficiency.

## Executive Findings

1. **Critical blocker: unresolved merge conflicts are preventing reliable indexing and runtime checks.**
2. **Agent orchestration is oversized and schedule-heavy (107 PM2 apps, many periodic lanes), creating coordination overhead.**
3. **Mission agent config includes dry-run primaries in production lanes, causing apparent work with no artifact outputs.**
4. **Cron collisions exist across mission lanes, increasing simultaneous runs and noisy queue state.**
5. **Index knowledge is present but incomplete/stale for all repos, so agents do not share a consistently fresh symbol context.**

## Hard Blockers (Must Fix First)

Conflict markers found in core execution/config files:

- `package.json` lines 92/95/96
- `config/mission-control-agents.json` lines 57/60/63
- `infra/model-router.js` lines 41/45/49
- `scripts/mission-control-agent-runner.js` lines 10/14/16, 168/174/175, 290/325/330
- `scripts/status-review-agent-runner.js` lines 10/13/15, 277/312/317

Impact:

- Invalid JSON prevents `npm run` script resolution reliability.
- Node syntax checks fail for mission/status runners and model router.
- Any index/audit task that touches these paths can fail or produce partial/false negatives.

## Complexity + Duplication Signals

Repo counts:

- `scripts/`: 335 files (300 JS)
- `agents/`: 64 JS files
- `control/`: 78 JS files

Operational footprint:

- `ecosystem.background.config.js` app names: 107 unique apps

Mission cron duplication (`config/mission-control-agents.json`):

- `*/30 * * * *` appears 3 times
- `10 */2 * * *` appears 2 times

Dry-run primaries in mission config:

- `copy:lab ... --dry-run`
- `research:proactive -- --dry-run`
- `backlog:orchestrator -- --dry-run`

Interpretation:

- Too many similarly scoped lanes plus periodic overlap drives “busy but low-net-progress” behavior.
- Dry-run primaries are useful for safety but should not be the default in progress-counted production lanes.

## Why Swarms Feel Unharmonious

1. **No strict preflight contract** before research/implementation runs.
2. **Status semantics are too permissive** (tasks can appear complete without hard evidence artifacts).
3. **Schedule-first architecture** instead of queue/priority-first causes clustered execution and duplicate analyses.
4. **Shared context not enforced** as mandatory input for all providers/models.

## Target Operating Model (Practical)

## 1) Stabilize Core Runtime (Day 0)

- Resolve all conflict markers in the 5 critical files.
- Add a CI/heartbeat gate: fail if `rg -n "^(<<<<<<<|=======|>>>>>>>)"` matches tracked files.
- Run `node --check` on runner/router files on each heartbeat before queue dequeue.

## 2) Single Index Plane (Day 0-1)

- Canonical index artifact: `reports/index-knowledge-latest.json`.
- All agent prompts must include the same extracted context block from canonical artifact.
- Add freshness SLO: index age <= 6h for implementation lanes, <= 24h for research lanes.

## 3) Lane Reduction + Clear Ownership (Day 1)

Collapse to these lane classes:

- `INTAKE`: triage, dedupe, route
- `RESEARCH`: emits ranked candidates + exact symbols/files + apply criteria
- `IMPLEMENT`: code changes + tests + artifacts
- `VERIFY`: runs checks, validates evidence
- `REPORT`: synthesizes progress and blockers

Rules:

- One primary owner lane per task.
- Cross-lane handoff only via explicit artifact references.
- No direct RESEARCH -> COMPLETED transitions.

## 4) Evidence-Gated Completion (Day 1)

Require at least one for COMPLETED:

- commit SHA
- changed files + diffstat
- passing test output
- artifact path

Else: `INCOMPLETE` or `BLOCKED` only.

## 5) Loop + Retry Controls (Day 1)

- Near-duplicate output twice for same `{task_type, repo}` => `BLOCKED_LOOP`.
- Retry budget per lane (max 3).
- On exceed: quarantine queue entry with required human action.

## 6) Scheduling Hygiene (Day 1-2)

- Move non-critical agents from strict cron to queue-triggered or wider windows.
- Stagger heavy lanes; avoid `*/30` clustering.
- Keep only watchdog/escalation on fixed cron.

## 7) Definition of Done Per Lane (Day 2)

Implement checklists for:

- CookiesPass
- PayClaw
- GoCrawdaddy

Only checklist closure counts as lane progress.

## 8) Research Relevance Scoring (Day 2)

- Every research output must map to downstream code tasks within 24h.
- No downstream linkage => score decay, reduce future priority for that pattern.

## 9) Unified Integrity Audit (Day 2)

Single report merges:

- queue state
- evidence state
- symbol usage state
- pretend-work signals

Output target:

- `reports/progress-integrity-latest.json`

## 10) Fail-Closed Status Policy (Immediate)

If uncertain:

- mark `BLOCKED`
- include explicit reason + unblock action
- never mark `COMPLETED` silently

## Immediate Action Backlog

1. Resolve merge conflicts in critical runner/config files.
2. Enforce conflict-marker and syntax preflight in heartbeat.
3. Remove/segregate dry-run primaries from production mission lanes.
4. Add lane retry budget + quarantine queue wiring.
5. Require index freshness and symbol IDs before task execution.

## Notes on Indexing Tooling

`jcodemunch` MCP server is not currently exposed in this runtime (no MCP resources/templates detected), so this audit used local static analysis and existing report artifacts. If `jcodemunch` is enabled, re-run with symbol-level coverage enforcement and include symbol IDs per task output.
