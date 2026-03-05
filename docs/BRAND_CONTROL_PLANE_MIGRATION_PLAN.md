# Brand Control Plane Migration Plan (Phase 1)

## 1) Canonical API Contract

### `POST /v1/brands`
Creates/updates a brand and queues deterministic provisioning.

Request body:
```json
{
  "name": "SkyPatch",
  "primary_domain": "skynpatch.com",
  "sending_subdomain": "mail",
  "default_from_name": "SkyPatch Wholesale",
  "default_from_email": "wholesale@skynpatch.com",
  "timezone": "America/Phoenix",
  "dns": {
    "provider": "cloudflare",
    "zone_id": "cf-zone-id",
    "api_token": "optional-raw-token",
    "api_token_ref": "optional-ref"
  },
  "maileroo": {
    "api_key": "optional-raw-key",
    "account_ref": "optional-ref"
  },
  "stripe": {
    "webhook_secret": "optional-raw-secret",
    "webhook_ref": "optional-ref"
  }
}
```

Response:
```json
{
  "brand_id": "uuid",
  "status": "queued",
  "task": { "created": true, "id": "uuid" },
  "install": {
    "public_key": "pub_xxx",
    "script": "<script src=\".../brand-sdk.js\" data-brand-key=\"pub_xxx\" async></script>"
  }
}
```

### `GET /v1/brands/:id/status`
Returns control-plane status, queued/completed provisioning tasks, and step logs.

Response includes:
- `brand` (provisioning fields + domains + keys)
- `install` snippet payload
- `provisioning_tasks`
- `provisioning_runs`

## 2) First Shared Flow Pack (Welcome / Order / Ops)

Pack key: `core_v1_welcome_order_ops`

Flows:
1. `welcome_v1`
   - Trigger: `customer.created`
   - Steps: welcome email, intro CTA, preference capture follow-up.
2. `order_confirm_v1`
   - Trigger: `order.completed`
   - Steps: buyer confirmation message.
3. `ops_wholesale_notify_v1`
   - Trigger: `order.completed`
   - Steps: internal ops notification to `shop@skynpatch.com` style mailbox.

Execution model:
- Flow definitions live in `flows`.
- Runtime queue entries live in `flow_jobs`.
- Provider send outcomes live in `messages`.

Seed command:
```bash
npm run flow:seed:core -- --brand skynpatch
```

## 3) Repo-by-Repo Cutover Order (Top Launch Sites)

Priority order:
1. `CaptureInbound`
2. `CookiesPass`
3. `TempeCookiesPass`
4. `mytutor`
5. `3DGameArtAcademy`
6. `wmactealth`
7. `wmactealth-lc`

Cutover checklist per repo:
1. Add control-plane install snippet (`public_key` scoped).
2. Move transactional/lifecycle triggers to `events` (`brand_id` scoped).
3. Disable ad-hoc provider wiring in repo (Maileroo direct calls) after parity test.
4. Enable shared flow pack.
5. Verify:
   - `npm run -s build`
   - event ingestion
   - message dispatch and webhook loop
   - no regression failures in pulse

Definition of done for each repo:
- Regression pulse green.
- Control-plane status `ready`.
- At least one full welcome/order/ops flow roundtrip observed in DB logs.

## 4) Runtime Notes

Control plane process:
- PM2 app: `claw-brand-control-plane`
- Health: `GET /healthz`

Provisioning task:
- Task type: `brand_provision`
- Queue: `claw_tasks_io_heavy`
- Worker tags: `infra, deterministic, io_heavy`

## 5) Known Current Gap

Maileroo endpoint path varies by account/API version.
Set these env vars to match your account:
- `MAILEROO_BASE_URL`
- `MAILEROO_DOMAINS_PATH`
- `MAILEROO_SENDERS_PATH`
- `MAILEROO_WEBHOOKS_PATH`

Without correct paths, provisioning will fail fast with explicit `failed` status and reason.
