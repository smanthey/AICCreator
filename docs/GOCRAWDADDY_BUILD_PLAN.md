# GoCrawdaddy Build Plan

Generated: 2026-02-28

## Product
GoCrawdaddy is the first net-new SaaS build lane: OpenClaw VPS hosting + operations.

## Why now
- Existing system has strong repair/QA loops across many repos.
- Next leverage step is a single flagship product built from those learned capabilities.
- GoCrawdaddy converts internal operational know-how into a sellable service.

## Core value proposition
1. Deploy OpenClaw on VPS quickly with safe defaults.
2. Operate and monitor queues/workers/models from one dashboard.
3. Keep systems healthy with auto-maintenance, backups, and incident visibility.

## MVP scope
1. Guided VPS setup (provider checklist + install script generation).
2. Runtime controls (worker status, queue depth, restart/scaling controls).
3. Observability (red/green, launch E2E, repo scan, cost and model routing stats).
4. Backup and recovery (snapshot verification + runbook).

## Build orchestration
Use `npm run gocrawdaddy:launch` to:
1. Ensure `$HOME/claw-repos/GoCrawdaddy` scaffold exists.
2. Register GoCrawdaddy in `managed_repos`.
3. Queue research + signals + affiliate research tasks.
4. Queue OpenCode implementation tasks for MVP build and landing conversion.

## Near-term milestones
1. Day 1: Scaffold + repo registration + implementation tasks queued.
2. Day 2: Core dashboard and setup flow skeleton merged.
3. Day 3: Deploy script and health checks passing in dry-run.
4. Day 4-5: E2E smoke for onboarding and deployment.
5. Day 6-7: Pricing page, checkout wiring, and beta onboarding kit.

## Success criteria
- Functional local demo + VPS install dry-run with no blocking errors.
- Dashboard shows actionable runtime health and cost snapshots.
- At least one end-to-end setup path validated on target VPS provider.
