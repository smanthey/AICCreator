# Automated Content Creator — One Flow

**Goal:** Go from **video URLs** to **research and a content brief** in one command, then use that to generate copy or scripts (via Mission Control or tasks).

## One command

```bash
npm run content-creator:pipeline
```

This runs in order:

1. **YouTube index** — Reads `data/youtube-urls.txt`, fetches transcript + metadata (no video download by default: `--keyshots 0`). Writes `reports/youtube-transcript-visual-index-latest.json`.
2. **Brief** — Generates `docs/INAYAN-BUILDER-VIDEO-SPEC.md` (goal, steps, source video IDs, features).
3. **Reddit search** — Runs `reddit:search`; writes `reports/reddit-search-research-latest.json` and `.md`.
4. **Builder research agenda** — Runs `builder:research:agenda --rolling` from the rolling gap report; writes `reports/builder-research-agenda-latest.json` and `.md`.

## Full AICC system (hands-off mode)

Builds and operates a full campaign loop:

1. `npm run aicc:campaign`
2. `npm run aicc:autopublish:schedule -- --video /absolute/path/to/final.mp4`
3. `npm run aicc:autopublish:run`
4. `npm run aicc:ab:score`

Orchestrated:

```bash
npm run aicc:system -- --topic "automated content creator" --niche ai-clone-news --variants 5 --video /absolute/path/to/final.mp4 --publish-due
```

What this adds:

- Auto-publish adapters for YouTube/TikTok/Instagram (`scripts/aicc-autopublish.js`)
- Template-driven niche packs (`scripts/aicc-campaign-engine.js`)
- Scene quality engine (hook/body/CTA structure, beat timing, transitions, b-roll cues)
- Voice + avatar provider config in generated variants
- A/B winner selection from retention/CTR/watch-time (`scripts/aicc-ab-loop.js`)
- Monetization packaging (title/description/hashtags/thumbnail prompt + affiliate CTA)

## Options

- **With keyshots (needs disk + ffmpeg):**  
  `node scripts/content-creator-pipeline.js` (no `--keyshots 0`; default in npm script is `--keyshots 0`).
- **Skip Reddit:** `node scripts/content-creator-pipeline.js --keyshots 0 --no-reddit`
- **Skip research agenda:** `node scripts/content-creator-pipeline.js --keyshots 0 --no-research`

## After the pipeline

- **Critique (improve from feedback):** Run `npm run content-creator:critique` to score the brief and get suggestions; output: `reports/content-creator-critique-latest.json`. See docs/AMAZING-CONTENT-CREATOR.md.
- **Brief:** Use `docs/INAYAN-BUILDER-VIDEO-SPEC.md` as input for copy or script generation.
- **Mission Control:** Submit a goal that references the brief, e.g. “Generate email and social copy from docs/INAYAN-BUILDER-VIDEO-SPEC.md for brand X.”
- **Tasks:** Queue `aicreator` or `copy_lab_run` with a goal/brief derived from the spec (see planner task catalog in `agents/planner.js`).
- **InayanBuilderBot:** Use `POST /api/v1/reddit/search` and `POST /api/v1/research/fusion` for more research; use magic-run for blueprints. Content generation (copy, scripts) is done via claw-architect tasks or goal API.

## Input

- **URLs:** `data/youtube-urls.txt` — one YouTube URL per line (comments with `#` are ignored).

## Outputs

| Output | Path |
|--------|------|
| YouTube index | `reports/youtube-transcript-visual-index-latest.json` |
| Video spec / brief | `docs/INAYAN-BUILDER-VIDEO-SPEC.md` |
| Reddit research | `reports/reddit-search-research-latest.json`, `.md` |
| Builder research agenda | `reports/builder-research-agenda-latest.json`, `.md` |

## Thorough gap analysis

See **docs/CONTENT-CREATOR-GAP-ANALYSIS.md** for a full checklist and gaps (single pipeline, InayanBuilderBot content handoff, export, usability).
