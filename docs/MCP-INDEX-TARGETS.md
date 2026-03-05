# MCP Symbol Index Targets — Index Everything

**Policy:** Always use MCP tools; symbol-index every repo you work in before deep code exploration or implementation. See `AGENTS.md` → "Code Exploration Standard".

## jCodeMunch (jcodemunch) — paths to index

Run **index_folder** (or **index_repo** where noted) for each path so symbol search and outlines are available—**indexing speeds everything up**. Use `scripts/mcp-index-everything.sh` for the main list.

### External skills (when installed)

If you install the five external skill repos (Anthropic skills, Superpowers, planning-with-files, skill-prompt-generator, awesome-claude-code-subagents), **index each one after install** so `get_repo_outline` / `search_symbols` stay fast. Paths are typically under `~/.openclaw/workspace/skills/` or `$OPENCLAW_WORKSPACE_SKILLS`.

- **Install:** `npm run skills:install` (runs `scripts/skills-external-install.sh`).
- **Index:** Run `./scripts/mcp-index-everything.sh` — it prints the skills subdirs when present. Call jCodeMunch **index_folder** for each path (use `use_ai_summaries: false` for speed).
- **Best-of repo ids:** After indexing, use `config/external-skills-index.json` for jCodeMunch repo ids (`local/skills-anthropics`, `local/superpowers`, `local/planning-with-files`, `local/skill-prompt-generator`) and recommended entry points for `search_symbols` / `get_symbol`.
- Full per-repo details: `docs/EXTERNAL-SKILLS-OPENCLAW.md`.

| Path (under `$HOME/claw-repos` or `$CLAW_REPOS`) | Notes |
|--------------------------------------------------|--------|
| **Workspace** `claw-architect` | Mission control, scripts, config, agents. |
| InayanBuilderBot | Builder bot API + UI; Reddit/GitHub research, masterpiece pipeline. |
| CookiesPass | Priority P0 product. |
| cookies-tempe, TempeCookiesPass | Tempe cookies flow. |
| payclaw, autopay_ui | PayClaw / Autopay. |
| CaptureInbound, capture | Capture products. |
| v0-skyn-patch | Skyn Patch site. |
| infinitedata, Inbound-cookies, LeadGen3 | Data/lead gen. |
| quantfusion, booked, gbusupdate | Trading, booking, updates. |
| veritap, veritap_2026 | VeriTap. |
| 3DGameArtAcademy, BlackWallStreetopoly, Coinstbl, FoodTruckPass, Madirectory, mytutor, patentpal, PdfEzFill, SmartKB, SocialAiPilot, SomaveaChaser, syrup-internal-line-sheet, tap2, wmactealth, wmactealth-lc, BakTokingcom, RobloxGitSync, nirvaan, and others | Additional repos; see script output. |

## Example MCP calls (conceptual)

- `index_folder: { "path": "$HOME/claw-architect" }`
- `index_folder: { "path": "$HOME/claw-repos/InayanBuilderBot" }`
- … one per path from `./scripts/mcp-index-everything.sh`

Use `use_ai_summaries: false` for faster indexing when you don't need AI-generated symbol summaries.

## After indexing

- Use **get_repo_outline**, **search_symbols**, **get_symbol** / **get_symbols**, **get_file_outline** for targeted code lookup.
- Use **search_text** for string literals, comments, or config values.
- See `docs/jcodemunch.md` for the full playbook.

## Script

`scripts/mcp-index-everything.sh` prints all paths (one per line). **It is not an MCP server** — do not add it to `.cursor/mcp.json`; use the **jcodemunch** MCP server and call `index_folder` for each path.

---

## Cursor MCP setup (quick reference)

1. **Verify servers:** `npm run mcp:health` (trigger, postgres, filesystem, github, jcodemunch, context7).
2. **Sync config:** `npm run mcp:sync` — writes `.cursor/mcp.json` with `command`/`args`/`cwd` so Cursor starts each server correctly.
3. **Open workspace at repo root** so `cwd` and `./scripts` resolve. If the repo is not at `$HOME/claw-architect`, run `npm run mcp:sync` from your repo root (it injects the current path) or edit `cwd` in `.cursor/mcp.json`.
4. **Index before deep work:** Use jCodeMunch MCP and run `index_folder` for each path from `./scripts/mcp-index-everything.sh`.

See `docs/MCP-SERVERS.md` for per-server details and `docs/INDEX-REDDIT-GITHUB-BENCHMARK-WORKFLOW.md` for Reddit/GitHub search and benchmarking.
