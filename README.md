# AICCreator

AICCreator is an automated content operations system that turns research into publish-ready short-form campaigns.

It provides:
- Research ingestion (YouTube transcript indexing + benchmark/research context)
- Campaign generation (template niche packs, scene plans, monetization packaging)
- Distribution operations (YouTube/TikTok/Instagram scheduling and publish adapters)
- Optimization loop (A/B scoring and winner promotion)

## Quick Start

1. Install dependencies:
```bash
npm install
```

2. Build a campaign from current research inputs:
```bash
npm run content-creator:pipeline
npm run aicc:campaign
```

3. Schedule distribution jobs:
```bash
npm run aicc:autopublish:schedule -- --video /absolute/path/to/final.mp4
```

4. Execute due scheduled posts:
```bash
npm run aicc:autopublish:run
```

5. Score variants and promote the winner:
```bash
npm run aicc:ab:score
```

One-command orchestration:
```bash
npm run aicc:system -- --topic "automated content creator" --niche ai-clone-news --variants 5 --video /absolute/path/to/final.mp4 --publish-due
```

## Core Commands

- `npm run content-creator:pipeline`
- `npm run aicc:campaign`
- `npm run aicc:autopublish:schedule`
- `npm run aicc:autopublish:run`
- `npm run aicc:ab:score`
- `npm run aicc:system`

## Canonical Documentation

- [docs/README.md](docs/README.md)
- [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md)
- [docs/AICC-ARCHITECTURE.md](docs/AICC-ARCHITECTURE.md)
- [docs/AUTOPUBLISH.md](docs/AUTOPUBLISH.md)
- [docs/AB-TESTING.md](docs/AB-TESTING.md)
- [docs/SECURITY-PUBLIC-REPO.md](docs/SECURITY-PUBLIC-REPO.md)

## Public Repo Safety

This repository is configured for public-safe defaults:
- No personal absolute paths in docs
- No personal hostnames in docs
- Runtime artifacts are excluded from git
- Distribution credentials are environment-variable driven
