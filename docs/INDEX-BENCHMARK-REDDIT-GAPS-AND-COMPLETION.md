# Index, Benchmark & Reddit — Gaps and Completion

**Learned from:** All reports and docs about indexing, benchmarking, Reddit research, swarm checklist, integration audits, and where exemplars/OSS feed into code.

**Completion status (2026-03-04):** Single exemplar source and code wiring are implemented. `data/exemplar-repos.json` is built by `scripts/exemplar-repos-from-reports.js` (run via `npm run exemplar:repos` after benchmark + scout + optional reddit). `daily-feature-rotation.js`, `feature-benchmark-score.js`, `symbolic-qa-hub.js`, and `control/symbol-context.js` load it with fallback to hardcoded lists. Reddit context (top 3–5 posts) is injected into rotation task objectives and payloads. `masterpiece:auto` runs benchmark → scout → exemplar:repos → reddit:search → exemplar:repos → youtube:index. When adding new repos from scout/benchmark, run `npm run index:all` or jCodeMunch `index_folder` for that path.

**Bottom line (before completion):** The codebase was not driven by benchmarked OSS and Reddit research. Reports are produced but **not consumed** by the pipelines that pick exemplars and task objectives. Below: what’s missing and what to do to close the gaps.

---

## 1. What exists today

| Asset | Purpose | Consumed by code? |
|-------|---------|--------------------|
| **jCodeMunch index** (42 repos) | Symbol search, outlines | Yes — feature-benchmark-score, symbolic-qa-hub, symbol-context (they need indexes on disk). |
| **oss-dashboard-benchmark-latest.json** | Ranked OSS dashboard/chat repos + scores | **No.** Only written; nothing reads it for exemplars. |
| **dashboard-chatbot-repo-scout-latest.json** | Scout-discovered repos (UI signals, stars) | **Partly.** Only `architect-api.js` `/api/masterpiece/summary` reads it for display. Not used for exemplar selection or task objectives. |
| **reddit-search-research-latest.json** | Ranked Reddit posts (query-driven) | **No.** Only written; no script or agent uses it for features, objectives, or exemplars. |
| **EXEMPLAR_LIBRARY** (daily-feature-rotation.js) | Repos used for “compare to top exemplar OSS” in task objectives | **Hardcoded** list (~20 entries). Does not merge in benchmark or scout results. |
| **EXEMPLAR_LIBRARY** (feature-benchmark-score.js) | Repos used to compute exemplar mean/top score | **Hardcoded** (~15 repos). Same — no benchmark/scout input. |
| **EXEMPLAR_REPOS** (symbolic-qa-hub.js, control/symbol-context.js) | QA/exemplar repos for hub and context pack | **Hardcoded.** No benchmark/scout/reddit. |
| **SWARM-MUST-COMPLETE-INDEXING.md** | “Required exemplar OSS comparison and best-case implementation” | Daily feature rotation is supposed to do this; exemplars are still static. |

So: **benchmark + scout + Reddit outputs are not the source of truth for “which OSS to compare against” or “what to build next.”**

---

## 2. Gaps (code not based on benchmarked OSS + Reddit)

1. **Exemplar selection is static**
   - **daily-feature-rotation.js** and **feature-benchmark-score.js** use fixed `EXEMPLAR_LIBRARY` arrays.
   - They do **not**:
     - Read `reports/oss-dashboard-benchmark-latest.json` (top_recommended / ranked).
     - Read `scripts/reports/dashboard-chatbot-repo-scout-latest.json` (top_selected).
     - So task objectives never say “compare to anything-llm, ragflow, dify” from the last scout/benchmark run.

2. **OSS benchmark and scout are not the exemplar source**
   - `oss-dashboard-benchmark.js` has its own hardcoded `CANDIDATES`; it doesn’t take scout output.
   - Even if we add scout repos to the benchmark, nothing feeds benchmark/scout **output** back into:
     - EXEMPLAR_LIBRARY,
     - or a shared `data/exemplar-repos.json` that rotation + benchmark-score + symbolic-qa-hub read.

3. **Reddit research is display-only**
   - Reddit search produces `reports/reddit-search-research-latest.json` and `.md`.
   - No script:
     - Injects “Reddit-suggested” features or links into task payloads.
     - Updates exemplar lists or objectives from Reddit findings.
   - So “what Reddit says to build” never drives implementation.

4. **Single source of truth for “best OSS to use” is missing**
   - There is no generated file that says: “For dashboard/chat, use these repos (from benchmark + scout); for payment/Stripe, use these (from benchmark + internal).”
   - Each script keeps its own list; they drift.

5. **Symbolic QA hub and symbol-context don’t use benchmark/scout**
   - `symbolic-qa-hub.js` and `control/symbol-context.js` have hardcoded `EXEMPLAR_REPOS`.
   - They don’t pull in dashboard/chat OSS from scout or benchmark for “best-of-best” or context packs.

---

## 3. What you need to complete (checklist)

### A. One exemplar source (recommended)

- **Add a small script** that runs after benchmark + scout (and optionally reddit):
  - **Inputs:**  
    `reports/oss-dashboard-benchmark-latest.json`,  
    `scripts/reports/dashboard-chatbot-repo-scout-latest.json`,  
    (optional) `reports/reddit-search-research-latest.json` for “suggested features” or links.
  - **Output:**  
    `data/exemplar-repos.json` with:
    - `dashboard_chat`: top N from benchmark + scout (e.g. full_name, repo_key if cloned, stars, score).
    - `by_feature_tags`: map of tags (e.g. stripe, auth, qa) to list of repo identifiers (from benchmark/scout + current internal list).
  - **Schedule:** Run after `npm run oss:dashboard:benchmark` and `npm run dashboard:repo:scout` (e.g. same cron or “masterpiece:auto” flow).

### B. Wire exemplar source into code

- **daily-feature-rotation.js**
  - **Change:** `pickExemplars(feature, limit)` should:
    - Read `data/exemplar-repos.json` (or fallback to current EXEMPLAR_LIBRARY).
    - For each feature, merge: tag-matched exemplars from the file + dashboard_chat when feature is UI/chat/dashboard-related.
  - So task objectives and “Top exemplar repos” bullets are driven by last benchmark + scout run.

- **feature-benchmark-score.js**
  - **Change:** `pickTopExemplars(feature, topN)` should:
    - Prefer repos from `data/exemplar-repos.json` (by_feature_tags + dashboard_chat) when present.
    - Fall back to current EXEMPLAR_LIBRARY if file missing or empty.
  - So “compared_repo_keys” and exemplar mean/top scores are based on benchmarked OSS.

- **symbolic-qa-hub.js** (optional but useful)
  - **Change:** When building the “best-of-best” table, merge in dashboard/chat repos from `data/exemplar-repos.json` (e.g. dashboard_chat) so QA exemplars include top scout/benchmark repos, not only current hardcoded list.

- **control/symbol-context.js** (optional)
  - **Change:** If you use exemplar repos for context packs, load from `data/exemplar-repos.json` with fallback to current EXEMPLAR_REPOS.

### C. Reddit → tasks or objectives (optional)

- **Option 1 (light):** In **daily-feature-rotation.js** or a separate “research injector”:
  - Read `reports/reddit-search-research-latest.json`.
  - Take top 3–5 posts (by rank) and add a short “Reddit context” line to task payload (e.g. `reddit_context: "Post X suggests Y; consider Z"`). No schema change required if you put it in `payload.metadata` or `objective` suffix.

- **Option 2 (stronger):** A small **reddit-to-features** step that:
  - Maps Reddit post titles/summaries to feature keys or new “suggested_feature” entries.
  - Appends suggested features to the rotation or to a “backlog” that the rotation can pull from.

### D. Benchmark and scout as input to benchmark script (optional)

- **oss-dashboard-benchmark.js** could optionally:
  - Read `scripts/reports/dashboard-chatbot-repo-scout-latest.json` and add `top_selected` repos to the candidate set (deduped with CANDIDATES), so the benchmark stays aligned with scout discoveries.

### E. Indexing and freshness

- **Already done:** 42 repos indexed via jCodeMunch; `npm run index:all` and `scripts/jcodemunch-index-paths.py` exist.
- **Recommendation:** Run `index:all` (or index_folder for new repos) whenever you add a repo from scout/benchmark to `data/exemplar-repos.json`, so feature-benchmark-score can read its index and include it in exemplar comparison.

---

## 4. Minimal “complete” slice (if you do nothing else)

1. **Create `scripts/exemplar-repos-from-reports.js`**  
   - Reads: `reports/oss-dashboard-benchmark-latest.json`, `scripts/reports/dashboard-chatbot-repo-scout-latest.json`.  
   - Writes: `data/exemplar-repos.json` with at least:
     - `dashboard_chat`: array of `{ full_name, stars, benchmark_score or rank_score }` from both reports (merged, deduped, top 10–15).
     - `by_feature_tags`: copy of current tag → repo mapping from daily-feature-rotation’s EXEMPLAR_LIBRARY (so you don’t break existing behavior).
   - Run it after scout and benchmark (e.g. in `masterpiece:auto` or a cron).

2. **In daily-feature-rotation.js**  
   - In `pickExemplars()`, if `data/exemplar-repos.json` exists and has `dashboard_chat`, append those repos (with a `name`/`url` derived from full_name) to the list you return for features that have tags like `chat`, `dashboard`, `ui`, or a new tag `dashboard_chat`.  
   - So “Top exemplar repos” in task objectives includes benchmark/scout repos.

3. **In feature-benchmark-score.js**  
   - In `pickTopExemplars()`, if `data/exemplar-repos.json` exists, prefer repos from `by_feature_tags` and `dashboard_chat` for the given feature (with fallback to EXEMPLAR_LIBRARY).  
   - So scoring is “vs last benchmark/scout” not only vs hardcoded list.

After that, the code **is** based on benchmarked OSS (and scout). Reddit can stay human-only until you add Option 1 or 2 above.

---

## 5. References (indexed for this doc)

- **docs/INDEX-REDDIT-GITHUB-BENCHMARK-WORKFLOW.md** — Commands and workflow.
- **docs/MCP-INDEX-TARGETS.md** — What to index; jCodeMunch usage.
- **docs/SWARM-MUST-COMPLETE-INDEXING.md** — “Required exemplar OSS comparison”; item 11 = daily feature rotation with exemplar comparison.
- **docs/INTEGRATION-GAPS-AUDIT-2026-03-03.md** — PayClaw/CookiesPass/Quant gaps (no benchmark/reddit wiring).
- **reports/clawpay-openbot-index-gap-benchmark-latest.md** — Index + gap + benchmark run; feature-benchmark-gate and score referenced.
- **reports/site-improvement-intel-2026-03-04.md** — Reddit + scout + benchmark summary for site improvements.
- **scripts/daily-feature-rotation.js** — EXEMPLAR_LIBRARY, pickExemplars(), objectiveFor() (“Compare to top exemplar OSS”).
- **scripts/feature-benchmark-score.js** — EXEMPLAR_LIBRARY, pickTopExemplars(), exemplar mean/top.
- **scripts/symbolic-qa-hub.js** — EXEMPLAR_REPOS.
- **scripts/oss-dashboard-benchmark.js** — Writes reports; CANDIDATES hardcoded.
- **scripts/dashboard-chatbot-repo-scout.js** — Writes top_selected; only architect-api reads for masterpiece summary.
- **scripts/reddit-search-research.js** — Writes reports; nothing consumes for exemplars or tasks.
