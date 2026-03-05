# Capability Factory Report

Generated: 2026-02-28T04:49:54.386Z
Repos scanned: 18

## Top Risk Repos

- nfcverify: score=14, critical=0, high=1
- usipeorg: score=14, critical=0, high=1
- LeadGenAi: score=24, critical=0, high=1
- quantfusion: score=24, critical=0, high=1
- patentpal: score=28, critical=0, high=1
- PdfEzFill: score=47, critical=1, high=0
- CookiesPass: score=49, critical=0, high=1
- FoodTruckPass: score=50, critical=0, high=1
- pingmyself: score=50, critical=0, high=1
- mytutor: score=51, critical=0, high=1
- BakTokingcom: score=57, critical=0, high=1
- Coinstbl: score=60, critical=0, high=0

## Canonical Candidates

- billing.stripe.checkout: CaptureInbound (rank=100, score=100, files=22)
- billing.stripe.webhooks: CaptureInbound (rank=100, score=100, files=29)
- comms.telnyx.sms: CaptureInbound (rank=100, score=100, files=46)
- auth.better_auth: CaptureInbound (rank=100, score=100, files=7)
- email.maileroo: CaptureInbound (rank=100, score=100, files=4)
- webhooks.signature_verify: CaptureInbound (rank=100, score=100, files=15)
- auth.supabase_auth: v0-morningops (rank=100, score=100, files=35)
- auth.legacy_nextauth: v0-morningops (rank=100, score=100, files=3)
- tenancy.multitenant: CaptureInbound (rank=95, score=95, files=53)

## Rollout Plan

- [P1] nfcverify: add tenant resolver and organization_id guardrails
- [P1] usipeorg: add tenant resolver and organization_id guardrails
- [P1] LeadGenAi: add tenant resolver and organization_id guardrails
- [P1] quantfusion: add tenant resolver and organization_id guardrails; remove placeholder/fake patterns and replace with deterministic real data paths
- [P1] patentpal: add tenant resolver and organization_id guardrails; remove placeholder/fake patterns and replace with deterministic real data paths
- [P0] PdfEzFill: enforce stripe webhook signature verification + replay/idempotency guard; remove placeholder/fake patterns and replace with deterministic real data paths
- [P1] CookiesPass: add tenant resolver and organization_id guardrails; remove placeholder/fake patterns and replace with deterministic real data paths
- [P1] FoodTruckPass: add tenant resolver and organization_id guardrails; remove placeholder/fake patterns and replace with deterministic real data paths
- [P1] pingmyself: add tenant resolver and organization_id guardrails; remove placeholder/fake patterns and replace with deterministic real data paths
- [P1] mytutor: add tenant resolver and organization_id guardrails; remove placeholder/fake patterns and replace with deterministic real data paths
- [P1] BakTokingcom: add tenant resolver and organization_id guardrails; remove placeholder/fake patterns and replace with deterministic real data paths
- [P1] booked: add tenant resolver and organization_id guardrails; remove placeholder/fake patterns and replace with deterministic real data paths

