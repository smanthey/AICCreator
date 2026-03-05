# Release Triage (Indexed) — PayClaw, CookiesPass, Quant

Date: 2026-03-03 (America/Phoenix)

## Method
- Indexed repos with jCodeMunch (`index_folder`, `get_repo_outline`, `search_text`).
- Ran release checks/builds in each repo.
- Applied fastest unblockers only where checks failed.

## Indexed repo summary
- `local/payclaw`: 14 files, 29 symbols.
- `local/TempeCookiesPass`: 95 files, 530 symbols.
- `local/CookiesPass` (nirvaan path): 98 files, 551 symbols.
- `local/quantfusion`: 95 files, 1055 symbols.

## Priority and findings
1. PayClaw (highest)
- Root packaging path was broken for DMG flow.
- Duplicate server tree (`PayClaw-Lite/server`) had stale TS/import/API mismatches.
- Electron builder excluded runtime entry from app package.

Fixes applied:
- Added root scripts in `payclaw/package.json` to proxy server build/start/check/mac:dmg.
- Synced/fixed `PayClaw-Lite/server` so it compiles with current server runtime.
- Updated Electron packaging config to include compiled runtime files.
- Switched TS output from `dist` to `build` and updated main entry.
- Added `.gitignore` entries for `build/` outputs.

Verification:
- `cd /Users/tatsheen/claw-repos/payclaw && npm run -s check` ✅
- `cd /Users/tatsheen/claw-repos/payclaw && npm run -s mac:dmg` ✅
- DMG generated at `server/dist/PayClaw-1.0.0-arm64.dmg`.
- Note: signing/notarization still not configured (expected warning).

2. CookiesPass (Vercel/Replit)
- `TempeCookiesPass`: check/build/test all pass.
- `nirvaan/CookiesPass`: initially failed due missing node_modules/toolchain; after install, check/build/test pass.
- Tests are configured to skip live API if server is not running (`REQUIRE_LIVE_SERVER=true` to enforce).

3. Quant
- Initially failed due missing local dependencies.
- After install, `check` + `build` pass.
- Remaining TODOs are integration placeholders (whale/options/politician APIs), not release blockers for current build.

## Important operational note
- `repo_mapper` command/tool was not available in this environment during triage. jCodeMunch indexing was used for symbol-level analysis.

## Immediate next release actions
1. Commit and push PayClaw packaging/runtime fixes.
2. Add Apple Developer ID signing + notarization for production DMG trust flow.
3. Run CookiesPass live API tests with server up (`REQUIRE_LIVE_SERVER=true`).
4. Keep Quant API TODOs behind feature flags for production messaging.
