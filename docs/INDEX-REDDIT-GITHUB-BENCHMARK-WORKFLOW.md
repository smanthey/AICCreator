# Index, Reddit, GitHub Search, Benchmarking & MCP Setup

This doc ties together: **symbol indexing**, **Reddit/GitHub research**, **benchmarking**, **repo updates**, and **Cursor MCP setup** using the tools in this repo.

---

## 1. Symbol index (jCodeMunch)

**Goal:** So Cursor and agents can use symbol-level search and outlines instead of opening whole files.

- **Paths to index:** Run `./scripts/mcp-index-everything.sh` — each line is a path.
- **How:** In Cursor, use the **jcodemunch** MCP server and call **index_folder** for each path (e.g. `index_folder: { "path": "$HOME/claw-architect" }`). Use `use_ai_summaries: false` for faster runs.
- **Docs:** `docs/MCP-INDEX-TARGETS.md`, `docs/jcodemunch.md`.

---

## 2. Reddit search & research

| Command | Script | Purpose |
|--------|--------|---------|
| `npm run reddit:search` | `scripts/reddit-search-research.js` | Query-driven Reddit research; produces ranked reports. |
| `npm run reddit:digest` | `scripts/reddit-digest.js` | Build Reddit digest. |
| `npm run reddit:research:auto` | (uses reddit-search-research) | Run with default query (dashboard/chat UI/open source LLM). |

**Env (optional):** `REDDIT_USER_AGENT`, `REDDIT_DEFAULT_SUBREDDITS`, `REDDIT_REQUEST_TIMEOUT_MS`; optional auth via `REDDIT_AUTH_PROFILES` or `REDDIT_USER_AGENTS` / `REDDIT_ACCESS_TOKENS`.

---

## 3. GitHub search & repo scout

| Command | Script | Purpose |
|--------|--------|---------|
| `npm run dashboard:repo:scout` | `scripts/dashboard-chatbot-repo-scout.js` | Scout dashboard/chatbot repos (GitHub + keywords). |
| `npm run dashboard:repo:scout:apply` | same | Scout + apply, clone, queue. |
| `npm run github:scan` | `scripts/github-observability-scan.js` | GitHub observability scan. |
| `npm run github:baseline:gate` | `scripts/github-baseline-gate.js` | Baseline gate. |
| `npm run discover:bots:github` | `scripts/bot-discovery-advanced.js github` | Bot discovery via GitHub. |

**Env:** `GITHUB_TOKEN` or `GITHUB_PERSONAL_ACCESS_TOKEN` for API access.

---

## 4. Benchmarking

| Command | Script | Purpose |
|--------|--------|---------|
| `npm run oss:dashboard:benchmark` | `scripts/oss-dashboard-benchmark.js` | OSS dashboard benchmark. |
| `npm run benchmark:score` | `scripts/feature-benchmark-score.js` | Feature benchmark score. |
| `npm run benchmark:gate` | `scripts/feature-benchmark-gate.js` | Feature benchmark gate. |
| `npm run mcp:benchmark:pack` | `scripts/mcp-benchmark-pack.js` | MCP benchmark pack. |

---

## 5. Repo updates (priority & daily)

| Command | Script | Purpose |
|--------|--------|---------|
| `npm run repo:priority:major:daily` | `scripts/priority-repo-major-update-daily.js` | Daily major-update lane for priority repos (queues tasks, pulls, etc.). |

Uses `REPOS_BASE_PATH` or `$HOME/claw-repos`; targets are defined in the script (CookiesPass, TempeCookiesPass, payclaw, CaptureInbound, capture, InayanBuilderBot, etc.).

---

## 6. MCP maintenance & Cursor setup

| Command | Script | Purpose |
|--------|--------|---------|
| `npm run mcp:health` | `scripts/mcp-health-check.js` | Verify all MCP server scripts (trigger, postgres, filesystem, github, jcodemunch, context7). |
| `npm run mcp:sync` | `scripts/mcp-sync-config.js` | Sync `.cursor/mcp.json` from shared config; injects `cwd` and normalizes command/args so Cursor can start servers. |

**MCP maintenance loop (plan only):** `node scripts/mcp-maintenance-loop.js [hourly|daily|weekly]` — outputs a plan (mission, detectors, targets) for an MCP-capable agent to run index_folder/search_text/search_symbols and refactors. It does not call MCP itself.

**Cursor MCP setup:**

1. Run `npm run mcp:sync` so `.cursor/mcp.json` has `command`, `args`, and `cwd` for each server.
2. Run `npm run mcp:health`; fix any failing check.
3. Open the workspace at the repo root; quit and reopen Cursor so it reloads MCP config.
4. Use **jcodemunch** to index paths from `./scripts/mcp-index-everything.sh`.

See `docs/MCP-SERVERS.md` and `docs/MCP-INDEX-TARGETS.md`.

---

## 7. One-shot “index + Reddit + GitHub + benchmark” style run

- **Masterpiece-style (InayanBuilderBot):** If InayanBuilderBot is running, use its pipeline (scout → benchmark → Reddit research → GitHub research → blueprint).
- **From this repo:**
  `npm run masterpiece:auto` runs: openclawless setup, oss dashboard benchmark, dashboard:repo:scout, exemplar:repos (builds data/exemplar-repos.json), reddit search, exemplar:repos again (adds reddit_context), youtube index.
  For Reddit-only: `npm run reddit:search` (optionally with `--query "..."`).
  For repo scout: `npm run dashboard:repo:scout`. After scout/benchmark run `npm run exemplar:repos`. When you add a new repo from scout/benchmark (e.g. clone it), run `npm run index:all` or jCodeMunch index_folder for that path so benchmark scoring and QA hub can use its symbols.

---

## 8. Index a scout repo (e.g. anything-llm, ragflow) and re-run research

When the **dashboard repo scout** surfaces a repo you want to work on (e.g. **Mintplex-Labs/anything-llm**, **infiniflow/ragflow**), index it so symbol search and research use it.

### Step 1: Clone the repo

```bash
REPOS="${CLAW_REPOS:-$HOME/claw-repos}"
mkdir -p "$REPOS"
cd "$REPOS"
git clone --depth 1 https://github.com/Mintplex-Labs/anything-llm.git   # or infiniflow/ragflow, etc.
```

(Or use `npm run dashboard:repo:scout:apply` to clone + queue; then the repo will be under `REPOS/<name>`.)

### Step 2: Add path to index list (optional)

If you want this repo included when you run `./scripts/mcp-index-everything.sh`, either:

- Add it to the script’s list (see `scripts/mcp-index-everything.sh` — add the repo name to one of the `for name in ...` loops and ensure `REPOS` is set), or  
- Manually index only this path in Step 3 (no script change).

### Step 3: Index with jCodeMunch

In Cursor, call the **jcodemunch** MCP server:

- **index_folder:** `{ "path": "/Users/<you>/claw-repos/anything-llm", "use_ai_summaries": false }`

Or from the repo root: `index_folder` with path `$REPOS/anything-llm`. After indexing, the repo appears as `local/anything-llm` (or the folder name) in **list_repos**; use **search_symbols** / **get_repo_outline** with that repo id.

### Step 4: Re-run research

- **Reddit:** `npm run reddit:search -- --query "anything llm RAG agents MCP"` (tune query to the repo’s topics). Reports go to `reports/reddit-search-research-latest.json` and `.md`.
- **GitHub scout:** Already done by `npm run dashboard:repo:scout`; if you added a new clone, run scout again to include it in “managed” or run benchmark: `npm run oss:dashboard:benchmark` (if the scout script uses that).
- **Symbol-level research:** Use jCodeMunch **search_symbols** on `local/anything-llm` (or the repo id) to find entry points, APIs, and patterns before implementing or comparing.

### Quick reference (one scout repo)

| Step | Action |
|------|--------|
| 1 | `cd $REPOS && git clone --depth 1 https://github.com/Mintplex-Labs/anything-llm.git` |
| 2 | (Optional) Add `anything-llm` to `scripts/mcp-index-everything.sh` |
| 3 | jCodeMunch **index_folder** with path `$REPOS/anything-llm`, `use_ai_summaries: false` |
| 4 | `npm run reddit:search -- --query "..."`; use **search_symbols** on `local/anything-llm` for code research |

---

## 9. Summary checklist

- [ ] `npm run mcp:health` — all green
- [ ] `npm run mcp:sync` — then restart Cursor
- [ ] Index: run `./scripts/mcp-index-everything.sh` and call jCodeMunch **index_folder** for each path
- [ ] Reddit: `npm run reddit:search` (set Reddit env if needed)
- [ ] GitHub/scout: `npm run dashboard:repo:scout` (set GITHUB_TOKEN if needed)
- [ ] Benchmark: `npm run oss:dashboard:benchmark` and/or `npm run benchmark:score`
- [ ] Repo updates: `npm run repo:priority:major:daily` (uses queue/DB; ensure env and infra are set)
- [ ] Index a scout repo: clone → index_folder → re-run Reddit/search_symbols (see §8)

---

## 10. OpenClaw + InayanBuilderBot improvement loop (coordinated)

When improving **OpenClaw (claw-architect)** and **InayanBuilderBot** together, run from claw-architect so both benefit from indexing, builder gap, research, and benchmarks. **Coordinate with other agents:** use `git pull --rebase` before pushing; keep commits focused and notes detailed so merges stay clean.

### Steps (from claw-architect root)

1. **Index both:** jCodeMunch **index_folder** for `claw-architect` and `claw-repos/InayanBuilderBot` (use `use_ai_summaries: false` for speed).
2. **Builder gap pulse:** `npm run builder:gap:pulse -- --repos InayanBuilderBot` (optionally `--dry-run` first). Runs `repo-completion-gap-one.js` and queues repo_autofix when gaps exist.
3. **Benchmark lookup:** `npm run repo:benchmark:lookup -- --repo InayanBuilderBot`. Writes `reports/repo-completion-benchmark-lookup-latest.md` with GitHub search links and best-case refs per capability section.
4. **Builder research agenda:** `npm run builder:research:agenda -- --rolling` or `--repo InayanBuilderBot`. Writes `reports/builder-research-agenda-latest.json` and `.md` with **prioritized research targets** for the builder: per-repo incomplete sections (GitHub + Reddit search suggestions), issues-to-research (code → suggested query), and next_actions. Use this so the builder (and InayanBuilderBot) can find better ways to discover incomplete/gaps/issues: run gap analysis → run research agenda → consume the JSON or MD to drive Reddit/GitHub research stages and filter candidates by section_id. When `builder:gap:pulse` queues repo_autofix or opencode_controller, it now attaches **gap_context** (incomplete_sections, benchmark_lookup, issues, next_actions) so agents can use GitHub links and issue codes directly.
5. **Reddit research:** `npm run reddit:search` (or `--query "open source AI builder agent MCP deterministic"`). Output: `reports/reddit-search-research-latest.json` / `.md`.
6. **Capability factory:** `npm run capability:factory` (or phase1/phase2/phase3) for risk and rollout plan; see `reports/capability-factory/latest.md`.

### Updating InayanBuilderBot after the run

- In **InayanBuilderBot** repo: refresh `docs/GAP_ANALYSIS.md` with latest section status and next actions; add an entry to `docs/UPDATE_NOTES.md` describing the run (indexing, builder pulse, benchmark lookup, builder research agenda, Reddit). This keeps InayanBuilderBot’s docs the single place for “what we ran and what we’re doing next.”
- Commit and push InayanBuilderBot with a clear message (e.g. “docs: sync gap analysis and update notes from OpenClaw indexing + builder pulse + research run”).
- In **claw-architect**: commit any doc or report updates (e.g. this section, or updates to MCP-INDEX-TARGETS) with a message that references the coordinated run so other agents can rebase on top.
