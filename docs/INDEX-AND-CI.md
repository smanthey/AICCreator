# Index Everything and CI (Don’t Rebuild What’s Done)

## Index everything

1. **Run index from master list** (workspace + all repos from `config/repo-completion-master-list*.json` under `CLAW_REPOS`):
   ```bash
   npm run index:from-master
   ```
2. **Write index manifest** (paths + completed repos from rolling gap so downstream can skip work):
   ```bash
   npm run index:manifest
   ```
   Output: `reports/index-manifest.json` with `paths`, `path_count`, `completed_repos`, `generated_at`.

Use `reports/index-manifest.json` and `reports/repo-completion-gap-rolling.json` to see what’s already indexed and which repos have no gaps (no need to re-run gap analysis or queue builder work for them).

## Don’t rebuild what’s already complete

- **builder-gap-pulse**  
  Before running gap analysis it reads `repo-completion-gap-rolling.json`. For each repo, if there is a **recent** “no gaps” entry (default: last 24h), it **skips** gap analysis for that repo and does not re-run capability-factory or feature-benchmark.  
  Override: `BUILDER_SKIP_COMPLETE_MS` (ms) or `--force` to run gap analysis for all selected repos.

- **Queueing**  
  Only repos that **have** gaps (incomplete sections, next_actions, or issues) get `repo_autofix` / `opencode_controller` queued. Repos already complete are never queued for builder work.

## CI

- **`.github/workflows/ci.yml`**  
  On push/PR: `npm ci`, script parse check (index-paths-from-master, index-manifest, builder-gap-pulse, repo-completion-gap-one), run index-paths (stdout only; no Python index in CI), run `index:manifest`, upload `reports/index-manifest.json` as an artifact (7 days).

Indexing in CI does **not** run the full jCodeMunch pipeline (no Python env); it only checks that the Node scripts run and that a manifest can be generated when a rolling file exists.

## Suggested local flow

1. `npm run index:from-master` — index workspace + master-list repos.
2. `npm run index:manifest` — update manifest (paths + completed_repos).
3. `npm run builder:gap:pulse -- --repos-from-context` (or `--repos <name>`) — runs gap analysis only for repos that don’t already have a recent “no gaps” result; queues work only for repos with gaps.
