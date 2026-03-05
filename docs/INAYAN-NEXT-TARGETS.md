# Inayan Builder — Next Targets to 100%

The **next repo to bring to 100%** using indexing and Inayan builder (index, Reddit/Git research, benchmarking, full cycle until no gaps) is:

## Next: HowtoWatchStream-SmartKB

**Repo:** HowtoWatchStream-SmartKB

**Process:**

1. Set focus in your environment: `INAYAN_NEXT_REPOS=HowtoWatchStream-SmartKB` (e.g. in `.env`).
2. **Index and run full cycle until HowtoWatchStream-SmartKB has no gaps:**
   ```bash
   npm run inayan:full-cycle -- --until-repo HowtoWatchStream-SmartKB
   npm run inayan:full-cycle -- --until-repo HowtoWatchStream-SmartKB --max-iterations 20
   ```
   With indexing (default): indexes workspace + this repo, then gap analysis → research agenda → queue fixes; repeats until the repo has no gaps.
3. Or focus pulse + research on this repo only:
   ```bash
   npm run builder:gap:pulse -- --repos HowtoWatchStream-SmartKB
   npm run builder:research:agenda -- --repo HowtoWatchStream-SmartKB
   ```
4. Benchmark and compare via gap reports (`reports/repo-completion-gap-rolling.json`, `reports/builder-research-agenda-latest.json`).
5. Fix, commit, and push to the **HowtoWatchStream-SmartKB** git; repeat until 100% complete.

No repo names are hardcoded in code; targets are set via `INAYAN_NEXT_REPOS` or `--repos` / `--until-repo` and the master list (`.local`). Ensure the repo is in `config/repo-completion-master-list.local.json` (or `REPO_COMPLETION_MASTER_LIST_PATH`) so it is included in gap analysis.
