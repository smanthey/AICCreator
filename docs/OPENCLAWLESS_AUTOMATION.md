# OpenClawless Automation Guide

This guide is for environments where OpenClaw is **not** installed.

Goal: still provide a complete, professional indexing + benchmark workflow with minimal terminal overhead.

## Fastest Path

### macOS one-click

Double-click:

- `launch-openclawless.command`

This runs:

1. `npm run openclawless:setup`
2. `npm run oss:dashboard:benchmark`
3. `npm run reddit:search`
4. `npm run youtube:index:auto`

### CLI path

```bash
npm run openclawless:setup
npm run oss:dashboard:benchmark
npm run reddit:search
npm run youtube:index:auto
```

## What Each Step Does

### `openclawless:setup`

- Ensures `.env` exists (bootstraps from `.env.example` if needed)
- Enables `OPENCLAWLESS_MODE=true`
- Creates `data/youtube-urls.txt` template
- Checks presence of `ffmpeg` and `yt-dlp`
- Prepares output directories

### `oss:dashboard:benchmark`

- Pulls current metadata for curated open-source dashboard/chat stacks
- Scores them by product signal, model/provider compatibility, recency, and popularity
- Penalizes framework-only repos with low UI signal
- Produces ranked JSON + markdown reports

### `youtube:index:auto`

- Reads URLs from `data/youtube-urls.txt`
- Extracts transcript data and visual keyshot signals
- Computes quality benchmark score per video
- Produces a structured index report

### `reddit:search`

- Executes query-based Reddit search across configured subreddits
- Ranks results by relevance + engagement + freshness
- Produces JSON + markdown research outputs for downstream planning

## Input Contract

- File: `data/youtube-urls.txt`
- One YouTube URL per line
- `#` comments are allowed

## Output Contract

- OSS benchmark JSON: `reports/oss-dashboard-benchmark-latest.json`
- OSS benchmark markdown: `reports/oss-dashboard-benchmark-latest.md`
- Reddit search research JSON: `reports/reddit-search-research-latest.json`
- Reddit search research markdown: `reports/reddit-search-research-latest.md`
- YouTube transcript+visual index JSON: `reports/youtube-transcript-visual-index-latest.json`

## Tooling Notes

For full transcript+keyshot capability, install both:

- `ffmpeg`
- `yt-dlp`

If missing, setup reports the gap clearly.
No mystery failures, no silent shrug.

## Professional Defaults

- Deterministic baseline first, optional enrichments second
- Explicit input/output files for reproducibility
- Reports formatted for both automation and human review

## Troubleshooting

- If YouTube results are sparse: verify URLs and install `yt-dlp`
- If visuals are missing: verify `ffmpeg`
- If Reddit results are sparse: tighten/expand `--query` and subreddit list (`--subs`)
- If GitHub benchmark fails: provide `GITHUB_TOKEN` to avoid rate limits

## Why This Exists

Because “it works on my machine” is not a deployment strategy.
This mode gives a clean, repeatable path for real users without requiring your full OpenClaw runtime stack.
