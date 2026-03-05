# Roblox Game Growth Team (Top Priority)

## Primary target

- Repo: `RobloxGitSync`
- Goal: super puzzle fighter-style Roblox game with best-in-class retention, monetization, and live-ops cadence.
- **Game mechanics + monetization reference:** [ROBLOX-PUZZLE-FIGHTER-RESEARCH.md](./ROBLOX-PUZZLE-FIGHTER-RESEARCH.md) — canonical Super Puzzle Fighter II Turbo mechanics (gems, crash, power, chains, counter gems, defense, drop alley), why it’s hyper-addicting, and **monetization research that fits** (cosmetic-only, no pay-to-win; game passes, battle pass, Roblox best practices). Use it so implementation and audits get mechanics and monetization right.
- **Current phase:** Cleanup first. The game does not load or display properly in Studio. OpenClaw runs **automated and continuous**; all queued work is steered toward fixing load/visibility, Rojo sync, and script errors before adding or updating features.

## Continuous agent lane (automated, every 10 min)

- Mission ID: `roblox_game_growth`
- Command: `npm run roblox:game:growth:pulse`
- Schedule: every 10 minutes (`*/10 * * * *`)
- PM2 process: `claw-mission-roblox_game_growth`

## What gets queued automatically

Per pulse, for `RobloxGitSync`:

1. `github_sync` to keep local code current.
2. `github_repo_audit` to surface failing checks and risk gaps.
3. `github_observability_scan` to refresh capability/security/readiness facts.
4. `site_audit` scoped to **load/visibility blockers first**, then retention and monetization.
5. `opencode_controller` (core): **cleanup first**—fix load/display in Studio, Rojo sync, script errors; then core gameplay.
6. `opencode_controller` (growth, **force_implement**): **cleanup and stability**—dead code, script errors, load order, Rojo tree; then incremental live-ops.

All queue inserts are idempotent-keyed to avoid duplicate active runs. For why implementation was previously not queued and how stretch work is enabled, see [ROBLOX-AGENT-STATUS.md](./ROBLOX-AGENT-STATUS.md).

**Testing and fixing:** The repo has a `package.json` with `npm run check` (Lua unit tests). `repo_autofix` runs that check; failures queue `site_fix_plan` so the pipeline can fix and re-test. Programmatic e2e: [ROBLOX-AGENT-STATUS.md#testing-and-e2e](./ROBLOX-AGENT-STATUS.md#testing-and-e2e). Full in-Studio e2e would require Studio access (e.g. OpenClaw with Studio).

## Growth outcomes tracked

- Core gameplay stability: input latency, combo correctness, match integrity.
- Retention: D1/D7 session return uplift via onboarding + progression systems.
- Monetization: ARPDAU and conversion using ethical cosmetic + battlepass style loops.
- Live-ops: repeatable event cadence with measurable KPI deltas.

## Commands

Run one pulse now:

```bash
npm run roblox:game:growth:pulse
```

Dry-run preview only:

```bash
npm run roblox:game:growth:pulse -- --dry-run
```

Start/reload mission group including this lane:

```bash
npm run pm2:mission:start
npm run pm2:mission:reload
```
