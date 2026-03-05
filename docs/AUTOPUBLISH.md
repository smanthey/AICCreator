# Auto-Publish and Scheduler

## Scheduler

Create queue entries:

```bash
node scripts/aicc-autopublish.js schedule \
  --campaign reports/aicc-campaign-latest.json \
  --platforms youtube,tiktok,instagram \
  --start-at 2026-03-05T18:00:00Z \
  --spacing-min 120 \
  --video /absolute/path/to/final.mp4
```

Run due jobs:

```bash
node scripts/aicc-autopublish.js run-due
```

Publish one variant immediately:

```bash
node scripts/aicc-autopublish.js publish-now \
  --campaign reports/aicc-campaign-latest.json \
  --variant-id <uuid> \
  --platform youtube \
  --video /absolute/path/to/final.mp4
```

## Adapter Support

- YouTube: webhook mode or OAuth upload mode
- Instagram: webhook mode or Graph API mode
- TikTok: webhook mode or Open API mode

## Queue and Results

- Queue: `data/aicc-publish-queue.json`
- Results: `reports/aicc-publish-results-latest.json`
