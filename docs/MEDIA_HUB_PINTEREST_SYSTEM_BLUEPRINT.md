# Media Hub + Pinterest System Blueprint

Date: 2026-03-04

## Goal
Build a single dashboard hub that:
- Indexes and visually categorizes image assets from all indexed devices.
- Supports multi-business, multi-account Pinterest operations.
- Starts human-in-the-loop (manual posting) and graduates to automation.
- Generates high-quality captions from visual + brand context.

## Stack Decision
Keep existing `claw-architect` indexing/classification pipeline and add a Pinterest operations layer.

### Why
This repo already has:
- Multi-device file index (`file_index` + `hostname`)
- Visual labeling (`media_visual_catalog`)
- Perceptual hashes (`media_hashes`)
- Clustering (`shoot_groups`)
- Existing dashboard + API runtime

Adding a focused media ops surface is faster and lower-risk than replacing the full media stack.

## Benchmark: Open Source Photo Review / DAM Options
Scoring key: 1 (low) to 5 (high)

| Option | Visual Search | Tagging / Metadata | Multi-user Ops | Lightweight Setup | Fit for This System |
|---|---:|---:|---:|---:|---:|
| Immich | 5 | 4 | 4 | 3 | 5 |
| PhotoPrism | 5 | 5 | 4 | 3 | 5 |
| LibrePhotos | 4 | 4 | 3 | 4 | 4 |
| TagSpaces | 2 | 5 | 3 | 5 | 3 |
| FiftyOne (review/QA layer) | 5 | 4 | 4 | 2 | 4 |

### Notes
- **Immich** is strong for CLIP-backed contextual search and face/search workflows.
- **PhotoPrism** is strong for advanced filtering, labels, places, and privacy-friendly self-hosting.
- **LibrePhotos** is strong for quick self-hosted adoption with built-in ML features.
- **TagSpaces** is strongest for offline/local tagging governance and filename/sidecar metadata portability.
- **FiftyOne** is strongest for advanced visual QA, embeddings, and curation workflows.

## Recommended Target Architecture
1. **Source of truth (existing):** `file_index`, `media_metadata`, `media_hashes`, `media_visual_catalog`, `shoot_groups`.
2. **Ops hub (new):** `/media-hub` dashboard + `/api/media-hub/*` endpoints.
3. **Manual-first posting queue (new):** `pinterest_publish_queue`.
4. **Caption generation (new):** model-routed caption endpoint with deterministic fallback.
5. **Automation later:** scheduled poster worker that reads `status='approved'` rows and posts via Pinterest API.

## Pinterest Integration Guidance
Use Pinterest API v5 OpenAPI as contract source for:
- boards endpoints
- pins endpoints
- scopes and rate-limit metadata

Start with:
- queue validation
- dry-run payload verification
- manual post + writeback (`external_pin_id`, `posted_at`, raw response)

Then automate with strict guardrails:
- idempotency key per queue row
- retries with backoff
- dead-letter status for failures

## In-Repo Deliverables Added
- `dashboard/media-hub.html`
- `scripts/architect-api.js` updates:
  - `GET /media-hub`
  - `GET /api/media-hub/summary`
  - `GET /api/media-hub/assets`
  - `GET /api/media-hub/assets/:id/image`
  - `POST /api/media-hub/assets/:id/review`
  - `POST /api/media-hub/caption/generate`
  - `GET /api/media-hub/queue`
  - `POST /api/media-hub/queue`
- `migrations/087_pinterest_publish_queue.sql`

## Rollout Plan
1. Run migration `087`.
2. Launch API + open `/media-hub`.
3. Curate first 100-300 assets by brand + review status.
4. Generate captions, queue pins, manually post, collect performance data.
5. Add automated poster for approved queue rows only.

## Primary Sources
- Pinterest API OpenAPI repo: https://github.com/pinterest/api-description
- Pinterest OpenAPI v5 spec: https://raw.githubusercontent.com/pinterest/api-description/main/v5/openapi.yaml
- Immich docs (searching/ML): https://docs.immich.app/features/searching/
- Immich docs (tags): https://docs.immich.app/features/tags/
- PhotoPrism repository + feature overview: https://github.com/photoprism/photoprism
- PhotoPrism docs (search/navigation): https://docs.photoprism.app/user-guide/search/
- LibrePhotos repository + feature list: https://github.com/LibrePhotos/librephotos
- TagSpaces repository: https://github.com/tagspaces/tagspaces
- TagSpaces docs (tagging): https://docs.tagspaces.org/tagging
- FiftyOne docs (in-app annotation): https://docs.voxel51.com/user_guide/annotation.html
- FiftyOne docs (vector similarity/search integration): https://docs.voxel51.com/integrations/elasticsearch.html
