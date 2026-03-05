# Next Repo Recommendations (2026-03-03)

## Reindex Status
- Reindex completed for local Luau/keyword pipeline across:
  - `/Users/tatsheen/RobloxGitSync`
  - `/Users/tatsheen/claw-repos/oss-index/roblox/*`
  - `/Users/tatsheen/claw-repos/oss-index/puzzle-bench/*`
- Updated summaries:
  - `REINDEX_SUMMARY_2026-03-03.tsv`
  - `REINDEX_SUMMARY_2026-03-03.sorted.tsv`
  - `PUZZLE_BENCH_SUMMARY_2026-03-03.tsv`

## Newly Added Repos
- Roblox infra:
  - `MadStudioRoblox/ReplicaService`
  - `ffrostfall/BridgeNet2`
  - `1Axen/blink`
  - `evaera/Cmdr`
  - `rbxts-flamework/core`
- Puzzle benchmarks:
  - `a544jh/panel-pop`
  - `sharpobject/panel-attack`
  - `xaviershay/rust-puzzlefighter`

## Highest-Value Next Index Targets
1. `nullpomino`
- Why: strongest gameplay signal for chain/garbage pacing and versus pressure timing.
- Use for: `PuzzleMatch` garbage schedule + counter window tuning.

2. `puyoai`
- Why: strongest bot heuristic references for chain planning and risk/tempo tradeoffs.
- Use for: `SelfPlayLab` search objectives and `BotAI` eval function weights.

3. `NevermoreEngine`
- Why: largest Luau architecture set; good patterns for module boundaries and utility rigor.
- Use for: service/module boundaries and shared utility hardening.

4. `MockDataStoreService`
- Why: best datastore failure and budget behavior simulation references.
- Use for: rank/replay persistence tests, throttle/backoff and failure-mode coverage.

5. `rbx-net` + `BridgeNet2` + `blink`
- Why: server-authoritative networking and schema-first payload patterns.
- Use for: hardened authority checks and strict payload contracts in lobby/rank handlers.

6. `ReplicaService`
- Why: robust server->client state replication model.
- Use for: read-only client state mirrors for match/replay UI (avoid trust of client combat data).

7. `panel-attack` + `panel-pop` + `rust-puzzlefighter`
- Why: extra references for board pressure readability, combo tempo, and deterministic test style.
- Use for: chain readability UX and deterministic simulation tests.

## Concrete "What To Change" Mapping
- `PuzzleMatch`
  - Add garbage queue phases (`scheduled`, `counterable`, `committed`) and log phase transitions to replay events.
  - Introduce capped chain spike conversion and a minimum counter window floor.

- `SelfPlayLab` + `BotAI`
  - Add heuristic vectors for: immediate survival, short-chain setup value, cancel opportunity score, and risk penalty when receiving pending garbage.
  - Track blowout rate and reversal rate per config; auto-flag configs outside target bands.

- `LobbyServer`/`RankService`/network handlers
  - Enforce server-side event schema validation before processing.
  - Bind match outcome writes to server digest only; reject client-submitted combat deltas.
  - Add anti-boost guard rails tied to opponent-repeat windows.

## Notes / Limits
- jCodeMunch indexed TS/Rust repos successfully in this pass.
- jCodeMunch Luau indexing remains partial/limited in this environment (`No source files found` on several Luau-heavy repos), so Luau indexing is still handled by local grep-based symbol maps.
- `repo_mapper` CLI was not available in this environment.
