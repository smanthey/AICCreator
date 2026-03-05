# Roblox Agent Status & Runbook

Status and operational notes for the Roblox game growth pipeline (mission `roblox_game_growth`, repo `RobloxGitSync`). See also [ROBLOX_GAME_GROWTH_TEAM.md](./ROBLOX_GAME_GROWTH_TEAM.md).

## Current priority: cleanup before features

**OpenClaw runs this pipeline on its own, automated and continuous (every 10 minutes).** Right now the game does not load or display properly in Roblox Studio—too many problems. So:

- **All work is steered toward cleanup first:** fix what prevents the place from loading or displaying (missing refs, script errors, Rojo sync, visibility/camera), remove dead code, stabilize. **No new features until the place loads and is viewable.**
- Pulse objectives (site_audit, both opencode_controller flows) explicitly say: cleanup and load/visibility first; only then gameplay or live-ops features.
- When cleanup is stable and the game loads in Studio, the same pipeline can shift toward adding/updating features; until then, automation stays focused on making the project loadable.

## Pipeline summary

- **Mission:** `claw-mission-roblox_game_growth` runs every 10 minutes.
- **Per run:** Queues 6 task types: `github_sync`, `github_repo_audit`, `github_observability_scan`, `site_audit`, and two `opencode_controller` flows (core gameplay, growth/live-ops).
- **Health gate:** `opencode_controller` reads `github_repo_stack_facts.stack_health_score` (from `github_observability_scan`). If score ≥ `quality_target` (95 for Roblox), it reports **quality_passed** and by default **does not** queue implementation tasks (`site_fix_plan`, `repo_autofix`).

## Why implementation wasn’t being queued (Mar 2026)

- Stack health for `RobloxGitSync` has been **100** (from completed `github_observability_scan` runs).
- With `quality_target: 95`, `quality_passed` was always true, so the controller never queued `site_fix_plan` or `repo_autofix`.
- Result: no `repo_autofix` or `site_fix_plan` for RobloxGitSync in the last 14+ days; no agent-originated commits from this pipeline. The commit `27acc1e` (“Improve visual presentation and add new character animations”) is from Oct 2025 and human-authored.

## Change: stretch implementation (force_implement)

To keep the growth track producing implementation work even when stack health is 100:

1. **`opencode_controller`** now supports **`force_implement: true`**. When set, it queues implementation (site_fix_plan + repo_autofix) and review tasks even when `quality_passed` is true.
2. **Roblox pulse** sets **`force_implement: true`** on the **growth** opencode_controller only (live-ops, onboarding, quests, rewards, cosmetics). The **core** opencode_controller is unchanged and still gates on health.

So every 10 minutes the growth flow will queue:

- `site_fix_plan` (fix/standardization plan for the repo)
- `repo_autofix` (deterministic checks and small fixes, e.g. package.json)
- `site_audit`, `github_repo_audit`, `github_observability_scan` (review)

Idempotency and existing routing still apply; follow-up iterations of opencode_controller do **not** receive `force_implement`, so we avoid unbounded iteration when health is already passing.

## Verifying behavior

- **Mission / queue:** Mission control shows `roblox_game_growth` completing; task query shows COMPLETED runs for the 6 types.
- **Implementation tasks:** Check that `site_fix_plan` and `repo_autofix` for repo `RobloxGitSync` and source `roblox_game_growth_pulse_growth` appear and complete:

```sql
SELECT type, status, payload->>'source' AS source, created_at
FROM tasks
WHERE type IN ('site_fix_plan', 'repo_autofix')
  AND payload->>'repo' = 'RobloxGitSync'
  AND created_at >= NOW() - INTERVAL '7 days'
ORDER BY created_at DESC
LIMIT 20;
```

- **Stack health:** Confirm score source if needed:

```sql
SELECT f.repo_name, f.stack_health_score, r.finished_at
FROM github_repo_stack_facts f
JOIN github_repo_scan_runs r ON r.id = f.run_id
WHERE f.repo_name = 'RobloxGitSync' AND r.status = 'completed'
ORDER BY r.finished_at DESC NULLS LAST
LIMIT 5;
```

## Optional: reduce or broaden stretch work

- To **stop** stretch implementation: in `scripts/roblox-game-growth-pulse.js`, remove `force_implement: true` from the growth opencode_controller payload.
- To **add** stretch to the core flow as well: set `force_implement: true` on the first opencode_controller (core gameplay) in the same file. Monitor task volume and repo churn.

## Testing and E2E

### Programmatic testing (CI, no Studio)

The Roblox repo can be **tested and validated without Roblox Studio**:

- **Lua unit tests:** The repo has a standalone Lua test suite under `tests/` (RNG, Board, PuzzleMatch, FloodFill, chain recursion, AI, analytics, lobby, monetization, etc.). Run from repo root:
  - `./run_tests.sh` or `lua tests/run_all_tests.lua`
  - Requires a Lua interpreter on the path (e.g. `brew install lua` on macOS).
- **package.json:** The repo includes a `package.json` with:
  - `npm run check` → runs the Lua test suite (same as `./run_tests.sh`).
  - `npm run build` → runs `build.sh` (BuildInfo + tests).
  - `npm run test:ci` → same as check, for CI.
- **repo_autofix:** When the pipeline runs `repo_autofix` for RobloxGitSync, it runs `npm install` and `npm run check`. If the Lua suite fails, autofix fails and queues `site_fix_plan` / follow-ups, so the agent loop can fix and re-test.
- **Rojo (optional):** If `rojo` is installed, `rojo build -o build/game.rbxlx` validates project structure and produces a place file. The repo’s `build.sh` does not require Rojo; Rojo is for sync/build validation when available.

### E2E matrix

- **launch-e2e-targets:** Roblox is included as target `roblox-puzzle-brawl` with `cmd: "npm run -s check"` and `blocking: false`. Running `npm run e2e:launch:matrix` will run the Lua test suite for the Roblox repo when the repo path exists; failures are reported in the matrix report. Non-blocking so missing Lua on a runner does not fail the whole matrix.

### Full in-Studio E2E (future)

- **In-Studio playtesting** (run the game inside Roblox Studio and assert on gameplay) is **not** automated today: there is no headless Roblox Studio API. Options if you want it later:
  - **Manual:** Run Studio, hit Play, verify manually.
  - **OpenClaw + Studio access:** If OpenClaw (or a dedicated runner) has Roblox Studio installed and can drive it (e.g. via UI automation or a Studio plugin that runs tests and reports results), that could be wired as a separate e2e step or target. That would require Studio to be installed on the agent host and a way to run and capture test results (e.g. a TestEZ-style run inside Studio, or a plugin that runs and exits with a code). Not implemented in claw-architect today.

## Files

- Mission / schedule: `config/mission-control-agents.json` (mission `roblox_game_growth`).
- Pulse script: `scripts/roblox-game-growth-pulse.js` (queues the 6 task types; growth opencode has `force_implement: true`).
- Controller logic: `agents/opencode-controller-agent.js` (`force_implement`, `shouldQueueImplement`).
- Payload schema: `schemas/payloads.js` (`opencode_controller.force_implement`).
- E2E target: `config/launch-e2e-targets.json` (entry `roblox-puzzle-brawl`).
- Roblox repo: `package.json` in the repo defines `check` / `build` / `test:ci` for CI and repo_autofix.
