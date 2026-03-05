# OpenClaw Creator Package System

This adds a queueable generator for a done-for-you OpenClaw setup product targeted at content creators.

## What it generates

For each run, output folder under `artifacts/openclaw-creator-pack/<timestamp>-<slug>/` contains:

- `README.md` (offer summary + outcome)
- `INSTALLATION_CHECKLIST.md`
- `templates/creator.env.template`
- `agents/youtube-research-agent.md`
- `agents/tiktok-idea-generator.md`
- `agents/comment-analyzer.md`
- `agents/content-repurposing-workflow.md`
- `ONBOARDING_VIDEO_SCRIPT.md`
- `handoff/HANDOFF_DOCUMENTATION.md`
- `scripts/install-openclaw-macos.sh`
- `macos-app/OpenClawSetupApp.swift`
- `landing-page-offer.md`
- `manifest.json`

## Task type

- `openclaw_creator_pack_generate`
- Routing: `claw_tasks_io_heavy`
- Required tags: `infra, deterministic, io_heavy`

## Run direct

```bash
cd $HOME/claw-architect
npm run openclaw:creator:pack -- --name "OpenClaw Creator Pack" --client "Creator Client" --complexity standard
```

## Queue run (system lane)

```bash
cd $HOME/claw-architect
npm run openclaw:creator:pack:queue -- --name "OpenClaw Creator Pack" --client "Creator Client" --complexity premium
```

## API + dashboard

- UI: `/openclaw-creator-studio`
- API:
  - `GET /api/openclaw/creator-pack/topics`
  - `POST /api/openclaw/creator-pack/generate` (supports `{ queue: true }`)

## Pricing guidance

Built-in tiering in generator:

- simple: $500
- standard: $900
- premium: $1500

Positioning: time savings, less setup friction, faster publishing throughput.
