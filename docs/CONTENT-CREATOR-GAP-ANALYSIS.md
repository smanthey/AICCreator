# Content Creator — Thorough Gap Analysis

**Goal:** Make the system an **amazing, usable, automated content creator**: from video URLs and research to scripts, copy, and execution-ready content with minimal friction.

**Scope:** claw-architect + InayanBuilderBot + pipeline between them.

---

## 1. What Exists Today

### claw-architect

| Capability | Where | Status |
|------------|--------|--------|
| YouTube URL list | `data/youtube-urls.txt` | Done |
| YouTube transcript + visual index | `scripts/youtube-transcript-visual-index.js`, `npm run youtube:index:auto` | Done (transcript needs yt-dlp + disk) |
| Video index → builder brief | `scripts/youtube-index-to-brief.js`, `npm run youtube:index:to-brief` | Done |
| Reddit search | `scripts/reddit-search-research.js`, `npm run reddit:search` | Done |
| Builder research agenda | `scripts/builder-research-agenda.js`, `npm run builder:research:agenda -- --rolling` | Done |
| Copy generation | `agents/content-agent.js`: `generate_copy`, `aicreator`, `copy_lab_run`, `content_draft_generate` | Done (task-based) |
| Content brief intake | `content_brief_intake`, `content_draft_generate`, `content_draft_score` | Done |
| Mission Control / goal API | `POST /api/goal`, dashboard actions | Done |

### InayanBuilderBot

| Capability | Where | Status |
|------------|--------|--------|
| Reddit search API | `POST /api/v1/reddit/search` | Done |
| GitHub research API | `POST /api/v1/github/research` | Done |
| Research fusion | `POST /api/v1/research/fusion` | Done |
| Magic run (blueprint + execution tasks) | `POST /api/v1/masterpiece/magic-run` | Done |
| Scout, benchmark, pipeline | Various `/api/v1/masterpiece/*`, `/api/v1/scout/run`, `/api/v1/benchmark/run` | Done |
| Runbook + Mission Control contract | `docs/RUNBOOK.md` | Done |
| **Content-from-brief or content-from-video** | — | **Missing** |
| **One-click “video → content” pipeline** | — | **Missing** |

---

## 2. Gaps for “Amazing Usable Automated Content Creator”

### 2.1 Single pipeline (video → content)

- **Gap:** No single command or API that runs: **YouTube URLs → index → brief → research → generate scripts/copy**.
- **Today:** User must run 4–5 steps by hand (`youtube:index:auto`, `youtube:index:to-brief`, `reddit:search`, then trigger copy_lab_run or aicreator with a goal/brand).
- **Needed:** One script or dashboard action, e.g. `npm run content-creator:pipeline` (or `POST /api/content-creator/run`) that chains these and optionally queues copy generation from the brief.

### 2.2 InayanBuilderBot as content-origin

- **Gap:** InayanBuilderBot produces blueprints and research but does not “create content” (scripts, posts, email copy). Content creation lives only in claw-architect (tasks).
- **Needed:** Either (a) document the handoff (InayanBuilderBot brief → claw-architect goal/copy_lab_run), or (b) add a thin “content from brief” API in InayanBuilderBot that calls claw-architect or returns a payload for copy generation.

### 2.3 Usability and discoverability

- **Gap:** “Content creator” flow is not obvious from READMEs; no single “start here” for creators.
- **Needed:** Content-creator section in both repos: “How to go from 12 video URLs to scripts/copy in one flow,” with exact commands and optional one-click pipeline.

### 2.4 Export and reuse

- **Gap:** Generated brief (INAYAN-BUILDER-VIDEO-SPEC.md) and research outputs are files; no standard “export for content tools” (e.g. JSON for Notion, Airtable, or scheduler).
- **Needed:** Optional export step (e.g. brief + top_terms as JSON, or webhook) for downstream tools.

### 2.5 Robustness for content runs

- **Gap:** YouTube index can fail on disk or missing yt-dlp; copy generation requires brand_slug and DB.
- **Needed:** Document minimum env (yt-dlp, disk, brand in claw-architect), and optional `--keyshots 0` / dry-run for transcript-only.

---

## 3. Content-Creator Checklist (for gap runs)

Use this when re-running gap analysis focused on content creation:

- [ ] **YouTube ingestion:** `data/youtube-urls.txt` populated; `youtube:index:auto` (or `--keyshots 0`) runs; `youtube-transcript-visual-index-latest.json` has at least one row with transcript or metadata.
- [ ] **Brief generation:** `npm run youtube:index:to-brief` produces `docs/INAYAN-BUILDER-VIDEO-SPEC.md` with goal, steps, and source video IDs.
- [ ] **Research:** `reddit:search` and `builder:research:agenda --rolling` produce reports; InayanBuilderBot `POST /api/v1/reddit/search` and `POST /api/v1/research/fusion` callable.
- [ ] **Unified pipeline:** One command or documented flow runs: URLs → index → brief → research → (optional) queue copy/script generation.
- [ ] **Copy generation:** claw-architect can run `copy_lab_run` or `aicreator` with a goal derived from the brief (e.g. from VIDEO-SPEC or API goal).
- [ ] **Docs:** README or RUNBOOK in both repos describes “Automated content creator” flow and links to each other.
- [ ] **Export (optional):** Brief or research can be exported as JSON for downstream tools.

---

## 4. Recommended Next Steps

1. **Add `content-creator:pipeline` script in claw-architect** that runs: youtube:index:auto (or with `--keyshots 0`) → youtube:index:to-brief → reddit:search → builder:research:agenda; optionally accept a “goal” or “brand_slug” and queue aicreator/copy_lab_run from the generated brief.
2. **Add “Automated content creator” section** to InayanBuilderBot README and RUNBOOK: how to use InayanBuilderBot research + claw-architect pipeline to go from videos to content.
3. **Add “Content creator” section** to claw-architect docs (e.g. OPENCLAWLESS_AUTOMATION.md or new CONTENT-CREATOR.md) with the one-command flow and env requirements.
4. **Optional:** InayanBuilderBot endpoint `POST /api/v1/content/from-brief` that accepts a brief text or video IDs, runs research fusion, and returns a payload suitable for claw-architect copy generation (or calls Mission Control API if configured).

---

## 5. Thorough Gap Analysis (Deep Pass)

Use this when re-indexing, re-running Inayan builder, and aiming for “amazing usable automated content creator” with full e2e and critique loop.

### 5.1 Coverage and quality

| Area | Check | Tool / Command |
|------|--------|----------------|
| **Index** | Workspace + InayanBuilderBot + master-list repos indexed | `npm run index:from-master` → `npm run index:manifest` |
| **Inayan target** | Target repo (e.g. InayanBuilderBot) at 100% (no gaps) | `npm run inayan:full-cycle -- --until-repo InayanBuilderBot --no-index` |
| **Content pipeline** | YouTube → brief → research in one command | `npm run content-creator:pipeline` (optionally `--no-reddit`) |
| **Brief quality** | Brief has goal, steps, source video IDs | `npm run content-creator:critique` (see below) |
| **E2E** | Key repos pass smoke e2e | `npm run e2e:launch:matrix`; fix failures and retest until clean |
| **Errors / bugs** | Lint, test, and script parse checks pass | `node --check` key scripts; `npm run greptile:scan`; fix and retest |

### 5.2 Critique and improve loop

- **Content-creator critique:** Run `npm run content-creator:critique` after the pipeline. It reads the latest brief (VIDEO-SPEC or `reports/content-creator-brief-latest.json`), runs a checklist (goal present, steps, sources, clarity), and writes `reports/content-creator-critique-latest.json` with scores and suggested improvements. Use that to adjust the pipeline or brief template.
- **Dogfood:** Run the pipeline to produce a brief, run critique, then use the suggested improvements to update docs/scripts and re-run. Repeat until critique passes and output is “amazing usable” quality.

### 5.3 E2E and fix–retest

- Run `npm run e2e:launch:matrix`. For any failure: fix the repo or test, then re-run the matrix. Continue until no failures (or only known skips). Document any permanent skips in `config/launch-e2e-targets.json` or env.

### 5.4 Amazing content creator checklist (full)

- [ ] Index: `index:from-master` + `index:manifest`; InayanBuilderBot (and content-creator target) indexed.
- [ ] Inayan: `inayan:full-cycle --until-repo InayanBuilderBot`; target repo at 100%.
- [ ] Pipeline: `content-creator:pipeline` runs end-to-end (YouTube → brief → research); brief and JSON outputs exist.
- [ ] Critique: `content-creator:critique` runs and reports; improvements applied and re-run until satisfactory.
- [ ] E2E: `e2e:launch:matrix` passes (or failures fixed and retested until clean).
- [ ] Bugs: Key scripts pass `node --check`; no known regressions; Greptile/gates as required.
- [ ] Docs: CONTENT-CREATOR.md and CONTENT-CREATOR-GAP-ANALYSIS.md (and InayanBuilderBot RUNBOOK) describe the full flow and critique loop.
