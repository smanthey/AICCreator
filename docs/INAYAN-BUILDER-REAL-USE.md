# Updating InayanBuilderBot from Real Use

InayanBuilderBot is the builder component in the workforce. To improve it from **real use** of the system:

1. **Run the builder regularly** so it executes gap analysis and queues fixes for indexed repos (including InayanBuilderBot itself).
2. **Capture bugs and fixes** that occur when the builder pulse and repo_autofix/opencode_controller run on your repos.
3. **Apply learnings back to the InayanBuilderBot git repo** (under CLAW_REPOS/InayanBuilderBot).

## Flow

1. **Builder run** (cron or manual): `npm run agent:team:run -- --agent builder --refresh`  
   - Runs `brief:weekly` (writes to `~/notes/briefs/weekly/`; it does not write SHIP_LOG.md).  
   - Runs `builder:gap:pulse --repos InayanBuilderBot`: gap analysis for InayanBuilderBot, then queues `repo_autofix` and `opencode_controller` if the repo has incomplete sections or next_actions.  
   - Agent-team-cycle then appends a run summary (outcomes, blockers, next_focus) to **SHIP_LOG.md**.

2. **Workers** execute `repo_autofix` (npm install + checks) and `opencode_controller` (implementation + audit). Failures and fixes are visible in task history and worker logs.

3. **Capture learnings:**  
   - From task output: which checks failed, which patches were applied, which objectives were completed.  
   - From repo-completion-gap reports: `reports/repo-completion-gap-InayanBuilderBot-*.json` and `reports/repo-completion-gap-rolling.json` (next_actions, sections, issues).  
   - From opencode/site_fix_plan: code changes and audit notes.

4. **Update InayanBuilderBot repo:**  
   - Document recurring failure modes and fixes in InayanBuilderBot (e.g. README, docs/RUNBOOK.md, or issue templates).  
   - If the builder’s own logic (e.g. `scripts/builder-gap-pulse.js`, or scripts it invokes) should change based on real runs, implement those changes in **claw-architect** and/or in InayanBuilderBot (if that repo owns part of the builder behavior).  
   - Commit and push to the InayanBuilderBot git remote so the “builder” product improves from production use.

## Video-to-InayanBuilderBot pipeline

To drive InayanBuilderBot from tutorial videos: add URLs to `data/youtube-urls.txt`, run `npm run youtube:index:auto`, then `npm run youtube:index:to-brief` (produces `docs/INAYAN-BUILDER-VIDEO-SPEC.md`). Run Reddit search, builder research agenda, and `repo:completion:gap --repo InayanBuilderBot`; then `inayan:full-cycle --until-repo InayanBuilderBot`. Full pipeline is documented in **InayanBuilderBot** repo: `docs/RUNBOOK.md`.

## Automated content creator (one command)

**`npm run content-creator:pipeline`** runs: YouTube index (transcript + metadata, `--keyshots 0`) → brief → Reddit search → builder research agenda. Outputs: `docs/INAYAN-BUILDER-VIDEO-SPEC.md`, `reports/content-creator-brief-latest.json`, and research reports. See [docs/CONTENT-CREATOR.md](CONTENT-CREATOR.md) and [docs/CONTENT-CREATOR-GAP-ANALYSIS.md](CONTENT-CREATOR-GAP-ANALYSIS.md).

## Full cycle: index → Reddit/Git research → benchmark → update until no gaps

Single run (index app, gap analysis, research agenda, queue fixes):

```bash
npm run inayan:full-cycle
```

Skip indexing (use existing symbol index):

```bash
npm run inayan:full-cycle -- --no-index
```

**Don't stop until it's all done:** repeat gap → research → update until **every** repo has no gaps (sections + issues + next_actions clear). No iteration cap:

```bash
npm run inayan:full-cycle:until-all-done
```

With a cap (e.g. 5 or 20 iterations):

```bash
npm run inayan:full-cycle:until-done
npm run inayan:full-cycle:until-done -- --max-iterations 5
```

Run until a single repo has no gaps (e.g. **HowtoWatchStream-SmartKB**):

```bash
npm run inayan:full-cycle -- --until-repo HowtoWatchStream-SmartKB
npm run inayan:full-cycle -- --until-repo HowtoWatchStream-SmartKB --no-index --max-iterations 20
```

Or for capture: `npm run inayan:full-cycle:until-capture`. For any other repo: `npm run inayan:full-cycle -- --until-repo <name>`.

Steps: (1) Index workspace + repos from master list (jCodeMunch). (2) Gap analysis for all repos (capability factory + feature benchmark). (3) Research agenda from rolling report (GitHub/Reddit search targets). (4) Queue repo_autofix + opencode_controller for repos with gaps. Research report: `reports/builder-research-agenda-latest.json` and `.md`.

Index from master list only (no hardcoded repo names):

```bash
npm run index:from-master
```

**Next to 100% with indexing and Inayan builder:** **HowtoWatchStream-SmartKB**. Set `INAYAN_NEXT_REPOS=HowtoWatchStream-SmartKB` (or use `--repos HowtoWatchStream-SmartKB` / `--until-repo HowtoWatchStream-SmartKB`), then run full cycle / research / benchmarking until done. See `docs/INAYAN-NEXT-TARGETS.md`.

## Commands

```bash
# Run builder (weekly brief + gap pulse for targets from master list)
npm run agent:team:run -- --agent builder --refresh

# Gap analysis for one repo or all
npm run repo:completion:gap -- --repo <name>
npm run repo:completion:gap -- --repo all

# Builder gap pulse (targets from config; or --repos <name>[,name2] or --next)
npm run builder:gap:pulse -- --repos-from-context
npm run builder:gap:pulse -- --repos <name> --dry-run

# Reddit/Git research targets from gaps
npm run builder:research:agenda -- --rolling
```

## Files

- **claw-architect:** `scripts/builder-gap-pulse.js`, `scripts/repo-completion-gap-one.js`, `config/agent-team.json` (builder refresh_command), `agent-state/handoffs/GOALS.md` (P0 InayanBuilderBot).
- **InayanBuilderBot repo:** Under CLAW_REPOS (e.g. `~/claw-repos/InayanBuilderBot`). Update docs and code there based on real run data from the builder pulse and task results.

## See also

- **Canonical context (JS):** `config/inayan-builder-context.js` — ground truth, hierarchy, handoff, data flow for tooling and agents.
- **Architecture:** `docs/INAYAN-BUILDER-ARCHITECTURE.md`
- **Audit:** `docs/INAYAN-BUILDER-AUDIT.md`
