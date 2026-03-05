# Getting Started

## Prerequisites

- Node.js 20+
- npm
- Optional for media workflows: `ffmpeg`, `yt-dlp`

## Install

```bash
npm install
```

## Minimal End-to-End Run

```bash
npm run content-creator:pipeline
npm run aicc:campaign
npm run aicc:autopublish:schedule -- --video /absolute/path/to/final.mp4
npm run aicc:autopublish:run
npm run aicc:ab:score
```

## Single Command

```bash
npm run aicc:system -- --topic "automated content creator" --niche ai-clone-news --variants 5 --video /absolute/path/to/final.mp4 --publish-due
```

## Outputs

- `reports/youtube-transcript-visual-index-latest.json`
- `reports/content-creator-brief-latest.json`
- `reports/aicc-campaign-latest.json`
- `data/aicc-publish-queue.json`
- `reports/aicc-publish-results-latest.json`
- `reports/aicc-ab-results-latest.json`
