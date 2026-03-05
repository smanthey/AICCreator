# Roblox OSS Index Jumpstart (Puzzle Brawl)

This is the fast-start pack for mining open-source Roblox code and monetization patterns for `RobloxGitSync`.

## What this adds

- Curated repo pack cloned into `$HOME/claw-repos/oss-index/roblox`
- Gameplay benchmark pack cloned into `$HOME/claw-repos/oss-index/puzzle-bench`
- Repo maps per OSS repo under `reports/repomaps/roblox-*-repomap.md`
- Keyword scan report for monetization/economy under:
  - `reports/roblox-oss-monetization-seeds-latest.md`

## Run it

```bash
bash $HOME/claw-architect/scripts/roblox-oss-jumpstart.sh
```

## Curated repos

- `Roblox/creator-docs` (official monetization + analytics docs)
- `Sleitnick/Knit` (framework/service pattern)
- `Sleitnick/AeroGameFramework` (older but useful service/controller architecture)
- `Quenty/NevermoreEngine` (module architecture + reusable packages)
- `evaera/roblox-lua-promise` (async flow reliability)
- `buildthomas/MockDataStoreService` (offline persistence testing)
- `dphfox/Fusion` (modern UI approach)
- `roblox-aurora/rbx-net` (remote/network contract patterns)
- `ffrostfall/ByteNet` (efficient networking)
- `MonzterDev/Roblox-Game-Template` (practical template stack)
- `synzahrh/knit-starter` (Rojo + Knit starter baseline)
- `Roblox/roact`, `Roblox/rodux`, `Roblox/roact-rodux` (UI/state patterns)
- `littensy/reflex`, `evaera/matter`, `Ukendio/jecs` (state + ECS patterns)
- `1ForeverHD/TopbarPlus`, `1ForeverHD/ZonePlus`, `SirMallard/Iris` (UI/runtime tooling)
- `osyrisrblx/t` (runtime type checking patterns)
- `jaipack17/Nature2D` (2D mechanics patterns)

## Gameplay benchmark repos

- `puyoai/puyoai` (chain-oriented puzzle AI benchmark)
- `nullpomino/nullpomino` (versus garbage and scoring benchmark)

## Immediate implementation priorities for RobloxGitSync

1. Fairness hardening for PvP
- Keep paid offers cosmetic/convenience only in competitive modes.
- Avoid paid revive/boost effects that directly influence match outcomes.

2. Product ID hardening
- Replace placeholder IDs with real environment/project config binding before release.
- Add startup validation to fail fast when IDs are missing.

3. Receipt handling single-source-of-truth
- Keep `MarketplaceService.ProcessReceipt` ownership in one service only.
- Route all grants through one audited economy path.

4. Analytics instrumentation for monetization
- Add funnel events around prompt shown -> purchase success/fail -> reward grant.
- Track conversion by offer type (pass, product, season pass, cosmetic).

5. Live-ops cadence
- Ship weekly events and limited cosmetics without gameplay stat advantage.
- Tie quests and battle pass progression to play volume and match quality.

## Current game health snapshot

On 2026-03-03, local `RobloxGitSync` test run passed (`npm run check`):
- 541 passed
- 0 failed

This means the core is stable enough to layer monetization and retention work without blocking on unit test failures.
