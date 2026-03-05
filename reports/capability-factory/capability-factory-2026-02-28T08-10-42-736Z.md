# Capability Factory Report

Generated: 2026-02-28T08:10:42.735Z
Repos scanned: 6

## Top Risk Repos

- 3ddesignafterschool: score=14, critical=0, high=1
- 3dgamestake2: score=14, critical=0, high=1
- BlackWallStreetopoly: score=51, critical=0, high=1
- 3DGameArtAcademy: score=54, critical=0, high=1
- BakTokingcom: score=57, critical=0, high=1
- autopay_ui: score=72, critical=0, high=0

## Canonical Candidates

- billing.stripe.checkout: autopay_ui (rank=100, score=100, files=16)
- billing.stripe.webhooks: autopay_ui (rank=100, score=100, files=20)
- comms.telnyx.sms: autopay_ui (rank=100, score=100, files=14)
- webhooks.signature_verify: autopay_ui (rank=100, score=100, files=7)
- tenancy.multitenant: autopay_ui (rank=95, score=95, files=5)
- auth.better_auth: BakTokingcom (rank=92, score=100, files=1)
- auth.supabase_auth: BakTokingcom (rank=92, score=100, files=95)

## Rollout Plan

- [P1] 3ddesignafterschool: add tenant resolver and organization_id guardrails
- [P1] 3dgamestake2: add tenant resolver and organization_id guardrails
- [P1] BlackWallStreetopoly: add tenant resolver and organization_id guardrails; remove placeholder/fake patterns and replace with deterministic real data paths
- [P1] 3DGameArtAcademy: add tenant resolver and organization_id guardrails; remove placeholder/fake patterns and replace with deterministic real data paths
- [P1] BakTokingcom: add tenant resolver and organization_id guardrails; remove placeholder/fake patterns and replace with deterministic real data paths

