# Distributed Runbook (NAS Spine + AI Nodes)

## Shared DB/Queue Targets
All machines must point to the same endpoints:
- `POSTGRES_HOST=192.168.1.164`
- `REDIS_HOST=192.168.1.164`

## Worker Profiles
- NAS deterministic worker:
  - `npm run worker:nas`
- M3 AI worker:
  - `npm run worker:ai`
- Dispatcher:
  - `npm run dispatcher`

## Queue/Tag Canonical Taxonomy
- `infra`, `deterministic`, `ai`, `qa`, `cpu_heavy`, `io_heavy`
- Routing source of truth: `config/task-routing.js`

## Execution Order (No Re-index)
1. `media_enrich` (NAS)
2. `media_hash` (NAS)
3. `cluster_media` (NAS)
4. selective `classify` (M3 AI)
5. `dedupe` only after classification stabilizes

## Safety/Collision Rules
- Exclusive lock enforced for: `classify`, `dedupe`, `cluster_media`, `migrate`, `media_hash`, `media_enrich`
- Dispatcher blocks tasks when no eligible online workers match `required_tags`
- Tasks are dead-lettered with explicit reasons (`INVALID_SCHEMA`, `POLICY_BLOCKED`, etc.)

## NAS Compose (optional)
- Copy `env.nas.example` to `.env`
- Run: `docker compose -f docker-compose.nas.yml up -d`
