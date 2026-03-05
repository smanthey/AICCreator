# Clawbuilder Platform Contract (v1)

This repository now enforces a deterministic platform profile for reusable site building.

## Locked Stack
- Framework: Next.js App Router
- Runtime: Node
- Database: Postgres (Neon-compatible)
- Auth baseline: BetterAuth
- QA baseline: Playwright packs

## Deterministic Compile Loop
1. Requirements captured in manifest(s)
2. `claw:scan` validates module contracts and sidecars
3. Migrations + env checks run
4. QA packs run (`qa_pack` / `qa_spec`)
5. Promotion only after deterministic checks pass

LLMs are optional for drafting and summaries; they do not own structure or compliance decisions.

## Trust Architecture
- Mode: `A_PLUS_B`
  - `A`: alert and report changes
  - `B`: produce PR-ready recommendations
- Explicitly disabled:
  - auto-apply code changes after tests
  - autonomous schema/security/interface mutations
- Scope: internal SMAT infrastructure first (`internal_only`)

## Platform Brain (Three Systems)
1. Clawbuilder compiler (`claw:scan`, manifests, module contracts)
2. GitHub observability (`github:scan`, violations, stack facts)
3. Research monitor (`research:sync`, `research:signals`, `platform:health`)

## Module Contract
Each module/blueprint manifest must pass `schemas/module-manifest.schema.json` and include:
- `env.schema.json`
- `runbook.md`
- `decision.md`
- declared Playwright packs under `tests/playwright/packs/`

## Commands
- Validate module contracts:
  - `npm run claw:scan`
- Run QA packs:
  - task type `qa_pack` with payload `{ "pack": "<pack-name>" }`
- Repo compliance audit (managed repos):
  - task type `github_repo_audit`

## IDM Ingestion
Server-side scrape mode:
- `npm run ip:kb:ingest:idm`

Playwright browser mode for JS-rendered IDM:
- `npm run ip:kb:ingest:idm:pw`
