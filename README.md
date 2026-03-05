# Claw Architect

Claw Architect is a production automation workspace for discovery, indexing, media intelligence, benchmarks, and multi-agent operations.

Think of it as an operations cockpit: less "toy demo," more "ship it, monitor it, and fix it before coffee gets cold."

## What This Repository Is

- A task/worker architecture with deterministic and AI lanes
- Media indexing pipeline (detect -> enrich -> hash -> cluster -> visual catalog)
- OSS scouting/benchmark workflows
- Dashboard and API surfaces for runtime operations
- Agent orchestration and continuous maintenance scripts

## OpenClawless Mode (No OpenClaw Required)

If the user does **not** have OpenClaw installed, use the built-in automation flow:

1. `npm run openclawless:setup`
2. `npm run oss:dashboard:benchmark`
3. `npm run reddit:search`
4. `npm run youtube:index:auto`

macOS one-click launcher:

- `launch-openclawless.command`

This mode gives a practical baseline with no OpenClaw dependency:

- Curated OSS dashboard/chat benchmark report
- YouTube transcript + visual indexing report
- Repeatable automation outputs under `reports/`

## New Automation Commands

- `npm run openclawless:setup`
- `npm run oss:dashboard:benchmark`
- `npm run youtube:index`
- `npm run youtube:index:auto`
- `npm run reddit:search`
- `npm run reddit:research:auto`
- `npm run masterpiece:auto`

## Schema mismatch & DB audit

Check that migrations, database, and code stay in sync. Requires Postgres (set `CLAW_DB_*` or `POSTGRES_*`).

| Command | Purpose |
|--------|--------|
| `npm run schema:audit` | Fast check: migrations vs applied, required tables/columns, invalid constraints/indexes, status enums. |
| `npm run schema:audit:json` | Same as above, JSON output for automation (e.g. system-4h-checkfix). |
| `npm run schema:audit:strict` | Same as above, but exit 1 on warnings as well as failures. |
| `npm run schema:audit:comprehensive` | Deeper audit: code references vs DB, migration coverage, missing indexes, broken FKs, column mismatches. Writes `schema-audit-report.json`. |

**Details:** [docs/SCHEMA-MISMATCH-TOOLS.md](docs/SCHEMA-MISMATCH-TOOLS.md) — failure codes, env, and when to run each.

## Repo completion & builder research

Gap analysis and research targets for the builder (and InayanBuilderBot):

| Command | Purpose |
|--------|--------|
| `npm run repo:completion:gap` | Run gap analysis for one or all repos (capability factory + feature benchmark). |
| `npm run repo:benchmark:lookup` | Emit GitHub search URLs and best-case refs per incomplete section → `reports/repo-completion-benchmark-lookup-latest.md`. |
| `npm run builder:gap:pulse` | Run gap analysis for selected repos and queue repo_autofix + opencode_controller when gaps exist (passes `gap_context` with benchmark_lookup, issues). |
| `npm run builder:research:agenda` | Build prioritized research agenda from gap report → `reports/builder-research-agenda-latest.json` and `.md` (GitHub + Reddit search suggestions per section and issue). |
| `npm run convergence` | Archetype-based convergence: gap → completion contract per repo/archetype → pulse unsatisfied until all pass or max iterations. See [docs/CONVERGENCE-ARCHETYPE-CONTRACT.md](docs/CONVERGENCE-ARCHETYPE-CONTRACT.md). |
| `npm run convergence:no-index` | Same as `convergence` but skip indexing step. |

**Details:** [docs/INDEX-REDDIT-GITHUB-BENCHMARK-WORKFLOW.md](docs/INDEX-REDDIT-GITHUB-BENCHMARK-WORKFLOW.md) §10 (OpenClaw + InayanBuilderBot loop). [docs/CONVERGENCE-ARCHETYPE-CONTRACT.md](docs/CONVERGENCE-ARCHETYPE-CONTRACT.md) (archetype packs + completion contract + convergence runner).

## Input/Output Contracts

### YouTube Index Input

- File: `data/youtube-urls.txt`
- Format: one URL per line

### YouTube Index Output

- `reports/youtube-transcript-visual-index-latest.json`

Includes:

- per-video metadata
- transcript presence/segments
- visual keyshot signals (when tooling is available)
- quality benchmark score

### OSS Benchmark Output

- `reports/oss-dashboard-benchmark-latest.json`
- `reports/oss-dashboard-benchmark-latest.md`

Includes ranked candidates by:

- UI/chat/dashboard signal fit
- model/provider signal fit
- popularity + recency
- framework-only penalty gate

### Reddit Research Output

- `reports/reddit-search-research-latest.json`
- `reports/reddit-search-research-latest.md`

Includes:

- query-ranked posts by subreddit
- engagement/relevance scoring
- top recommendation shortlist for follow-up research

## Runtime Prerequisites

- Node.js 20+
- Optional but recommended for full media extraction:
  - `ffmpeg`
  - `yt-dlp`

If these binaries are missing, setup explains how to install them and the indexer still supports partial or dry-run operation.

## Engineering Notes

- Keep generated artifacts in `reports/` machine-readable first, human-readable second.
- Keep scripts deterministic where possible; AI is additive, not a dependency for baseline ops.
- Prefer small, composable scripts over giant god-scripts.

## Operational Tone

Professional, pragmatic, and slightly caffeinated.

If a script fails, it should fail loud, explain why, and leave enough breadcrumbs to recover quickly.
