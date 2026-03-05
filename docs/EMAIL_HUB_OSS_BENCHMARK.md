# Email Hub OSS Benchmark (Dashboard + Analytics + Flow Editing + Multi-Site)

## Goal
Build one email hub for all sites instead of repeated per-repo send/webhook logic.

## OSS References Used
- [Novu](https://github.com/novuhq/novu): multi-channel notification infrastructure and workflow UX patterns.
- [n8n](https://github.com/n8n-io/n8n): production-grade visual flow editing and trigger/action ergonomics.
- [Resend Node SDK](https://github.com/resend/resend-node): typed provider primitives and webhook surface.
- [Trigger.dev](https://github.com/triggerdotdev/trigger.dev): durable task/execution model, retries, and event orchestration patterns.
- [Metabase](https://github.com/metabase/metabase): dashboard/analytics layout patterns and operational visibility standards.
- [Apache Superset](https://github.com/apache/superset): mature OSS BI dashboard and semantic metrics layer patterns.
- [Grafana](https://github.com/grafana/grafana): operational telemetry dashboards and alerting UX standards.
- [Appsmith](https://github.com/appsmithorg/appsmith): internal tool/dashboard builder patterns for rapid admin UIs.

## What We Already Had in `claw-architect`
- Email provider abstraction in [`core/email.js`](/Users/tatsheen/claw-architect/core/email.js) and [`infra/send-email.js`](/Users/tatsheen/claw-architect/infra/send-email.js).
- Webhook intake and signature verification patterns in [`scripts/webhook-server.js`](/Users/tatsheen/claw-architect/scripts/webhook-server.js).
- Existing repo mapping/indexing infrastructure to keep architecture visibility current.

## Gaps Identified vs OSS Patterns
1. No dedicated email-hub API for multi-site usage.
2. No unified dashboard for send/webhook/flow status.
3. No centralized flow authoring endpoint.
4. No unified event stream for per-site analytics across repos.

## Implemented in This Pass
- New hub service: [`scripts/email-hub-server.js`](/Users/tatsheen/claw-architect/scripts/email-hub-server.js)
  - `POST /api/email-hub/v1/send`
  - `POST /api/email-hub/v1/webhooks/maileroo`
  - `POST /api/email-hub/v1/webhooks/resend`
  - `POST /api/email-hub/v1/trigger`
  - `GET /api/email-hub/v1/events`
  - `GET /api/email-hub/v1/flows`
  - `POST /api/email-hub/v1/flows`
  - `GET /api/email-hub/health`
- New dashboard UI: [`dashboard/email-hub/index.html`](/Users/tatsheen/claw-architect/dashboard/email-hub/index.html)
  - live metrics cards
  - quick-send form
  - flow editor (JSON action model)
  - event table filters
  - health + flows JSON inspectors
- New npm entry: `npm run email:hub:server`

## Benchmark Criteria and Current Status
- API unification across sites: **Implemented**
- Provider signature verification: **Implemented** (Maileroo/Resend routes)
- Flow editing and trigger execution: **Implemented** (v1 JSON model)
- Multi-site event analytics: **Implemented** (site-tagged JSONL stream + dashboard)
- Durable queue/execution guarantees: **Partial** (core retries present; full durable queue for flow actions can be phase 2)
- Rich visual flow builder: **Partial** (JSON editor now; graph UI can be phase 2)

## Next Upgrade Steps (OSS-parity path)
1. Add BullMQ-backed durable action queue for flow execution and retries.
2. Add per-flow run history table with replay endpoint.
3. Add drag/drop graph flow editor (n8n-style) backed by current JSON model.
4. Add per-site conversion analytics panels (Metabase-like KPI blocks) from event stream.
5. Add optional Trigger.dev task handoff for long-running flow actions.

## Internal Repo Gap Scan (Dashboard/Feature Surfaces)
- `infinitedata`: strongest strategic dashboard footprint (executive + strategic API surfaces), good source for KPI aggregation UX patterns.
- `CookiesPass` / `TempeCookiesPass`: strong admin analytics/reporting pages and tested admin dashboard API.
- `quantfusion`: strongest real-time websocket dashboard update patterns and trading telemetry cards.
- `autopay_ui`: legacy dashboard patterns exist but fragmented; useful only as low-priority reference.
- `payclaw`: minimal backend-first implementation currently; dashboard surface still to be built.
