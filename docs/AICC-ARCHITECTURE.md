# AICC Architecture

## Pipeline

1. Research ingestion
- `scripts/content-creator-pipeline.js`
- YouTube transcript index + brief + benchmark context

2. Campaign generation
- `scripts/aicc-campaign-engine.js`
- Produces 3-5 variants with niche templates and scene plans

3. Distribution scheduling
- `scripts/aicc-autopublish.js schedule`
- Queues jobs for YouTube/TikTok/Instagram

4. Publish execution
- `scripts/aicc-autopublish.js run-due`
- Executes due jobs through platform adapters

5. Feedback and optimization
- `scripts/aicc-ab-loop.js`
- Scores retention/CTR/watch-time and promotes winner

## Niche Packs

- `ai-clone-news`
- `viral-faceless`
- `product-ads`

Each pack includes hook templates, CTA templates, and affiliate packaging defaults.

## Scene Quality Engine

Generated per variant:
- Hook/body/CTA segmentation
- Beat timing
- Transition plan
- B-roll cue keywords

## Distribution Adapter Modes

- Native API mode via platform credentials
- Webhook mode for external publishing systems
