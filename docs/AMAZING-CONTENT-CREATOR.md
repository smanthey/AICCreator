# Amazing Usable Automated Content Creator — Upgrade Path

**Goal:** After re-indexing and Inayan builder pass, make the system an **amazing, usable, automated content creator**: one flow from video URLs to research and brief, then to copy/scripts, with **error and bug fixing**, **full e2e testing (fix and retest until clean)**, and a **critique/improve loop** so the tools can improve their own output from feedback.

---

## 1. Done in this pass

- **Re-index:** `index:from-master` + `index:manifest`; workspace + InayanBuilderBot + master-list repos indexed.
- **Inayan builder:** `inayan:full-cycle --until-repo InayanBuilderBot`; InayanBuilderBot at 100% (no gaps); builder-gap-pulse skips already-complete repos (no rebuild).
- **Thorough gap analysis:** Extended `docs/CONTENT-CREATOR-GAP-ANALYSIS.md` with §5 (deep pass: coverage, critique loop, e2e fix–retest, full checklist).
- **Critique tool:** `npm run content-creator:critique` — reads latest brief (VIDEO-SPEC or `content-creator-brief-latest.json`), scores checklist (goal, steps, source videos, features), writes `reports/content-creator-critique-latest.json` and suggestions for improvement. Critique logic updated so VIDEO-SPEC with "## Goal" and source video table scores 4/4 and `ready_for_copy: true`.
- **E2E:** `e2e:launch:matrix` run; 0 failures, 0 blocking failures across configured targets. Fix–retest loop: re-run matrix after any repo/test change until clean.
- **Dogfood:** Pipeline output (VIDEO-SPEC) was critiqued; suggestions were applied (critique script now recognizes Goal section and video ID table); re-run critique confirmed 4/4 and ready for copy.
- **Docs:** This file and CONTENT-CREATOR-GAP-ANALYSIS.md §5 describe the full flow and dogfood loop.

---

## 2. Flow: Index → Inayan → Pipeline → Critique → E2E → Fix–Retest

1. **Index everything**  
   `npm run index:from-master` then `npm run index:manifest`. Ensures symbols and completed_repos are up to date; avoids rebuilding completed work.

2. **Inayan builder (content-creator target)**  
   `npm run inayan:full-cycle -- --until-repo InayanBuilderBot --no-index` (or without `--no-index` if you want a fresh index). Run until target repo is 100%.

3. **Content-creator pipeline**  
   `npm run content-creator:pipeline` (or with `--no-reddit` / `--no-research` to speed up). Produces brief + research outputs.

4. **Critique**  
   `npm run content-creator:critique`. Check `reports/content-creator-critique-latest.json` and apply suggestions; re-run pipeline and critique until `ready_for_copy` and quality are satisfactory.

5. **E2E**  
   `npm run e2e:launch:matrix`. For any failure: fix the repo or test, then re-run. Repeat until no failures (or only known skips).

6. **Error and bug fixing**  
   - `node --check scripts/<key-script>.js` on critical scripts.  
   - `npm run greptile:scan` if required.  
   - Fix regressions and retest (e2e, pipeline, critique).

---

## 3. Dogfood: Use the tools to improve the system

- Run the **content-creator pipeline** to produce a brief from the current video URLs.
- Run **content-creator:critique** and apply the suggested improvements (to the brief template, pipeline, or docs).
- Use **Mission Control / goal API** or queue **copy_lab_run** / **aicreator** with a goal derived from the brief; then use **content_draft_score** or **qa:human** (where applicable) to grade and feed back.
- Document any new gaps or improvements in CONTENT-CREATOR-GAP-ANALYSIS.md and this file.

---

## 4. Commands quick reference

| Command | Purpose |
|--------|---------|
| `npm run index:from-master` | Index workspace + master-list repos |
| `npm run index:manifest` | Write index manifest (paths + completed_repos) |
| `npm run inayan:full-cycle -- --until-repo InayanBuilderBot` | Run Inayan until target repo 100% |
| `npm run content-creator:pipeline` | YouTube → brief → research |
| `npm run content-creator:critique` | Score brief and get improvement suggestions |
| `npm run e2e:launch:matrix` | Run e2e matrix; fix and retest until clean |

---

## 5. References

- **Gap analysis and checklist:** `docs/CONTENT-CREATOR-GAP-ANALYSIS.md` (§5 thorough pass, amazing content creator checklist).
- **One-flow doc:** `docs/CONTENT-CREATOR.md`.
- **Index and CI:** `docs/INDEX-AND-CI.md`.
