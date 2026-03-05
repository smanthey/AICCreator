# Capability Factory Report

Generated: 2026-02-28T14:49:31.366Z
Repos scanned: 24

## Top Risk Repos

- 3ddesignafterschool: score=14, critical=0, high=1
- 3dgamestake2: score=14, critical=0, high=1
- Cookies_Pass: score=14, critical=0, high=1
- crave: score=14, critical=0, high=1
- Leadgen: score=14, critical=0, high=1
- glitch-app: score=21, critical=0, high=1
- LeadGenAi: score=24, critical=0, high=1
- cookies-tempe: score=36, critical=0, high=1
- HowtoWatchStream-SmartKB: score=37, critical=0, high=1
- LeadGen3: score=38, critical=1, high=1
- Coinstbl: score=42, critical=0, high=1
- CookiesPass: score=49, critical=0, high=1

## Canonical Candidates

- billing.stripe.checkout: autopay_ui (rank=100, score=100, files=16)
- billing.stripe.webhooks: autopay_ui (rank=100, score=100, files=20)
- comms.telnyx.sms: autopay_ui (rank=100, score=100, files=14)
- webhooks.signature_verify: autopay_ui (rank=100, score=100, files=7)
- tenancy.multitenant: claw-architect (rank=100, score=100, files=6)
- auth.better_auth: CaptureInbound (rank=100, score=100, files=7)
- auth.supabase_auth: claw-architect (rank=100, score=100, files=36)
- email.maileroo: capture (rank=100, score=100, files=11)
- auth.legacy_nextauth: claw-architect (rank=100, score=100, files=1)

## Rollout Plan

- [P1] 3ddesignafterschool: add tenant resolver and organization_id guardrails
- [P1] 3dgamestake2: add tenant resolver and organization_id guardrails
- [P1] Cookies_Pass: add tenant resolver and organization_id guardrails
- [P1] crave: add tenant resolver and organization_id guardrails
- [P1] Leadgen: add tenant resolver and organization_id guardrails
- [P1] glitch-app: add tenant resolver and organization_id guardrails; remove placeholder/fake patterns and replace with deterministic real data paths
- [P1] LeadGenAi: add tenant resolver and organization_id guardrails
- [P1] cookies-tempe: add tenant resolver and organization_id guardrails; remove placeholder/fake patterns and replace with deterministic real data paths
- [P1] HowtoWatchStream-SmartKB: add tenant resolver and organization_id guardrails; remove placeholder/fake patterns and replace with deterministic real data paths
- [P0] LeadGen3: migrate runtime auth handlers to better-auth and remove legacy auth imports; add tenant resolver and organization_id guardrails; remove placeholder/fake patterns and replace with deterministic real data paths
- [P1] Coinstbl: add tenant resolver and organization_id guardrails; remove placeholder/fake patterns and replace with deterministic real data paths
- [P1] CookiesPass: add tenant resolver and organization_id guardrails; remove placeholder/fake patterns and replace with deterministic real data paths
- [P1] FoodTruckPass: add tenant resolver and organization_id guardrails; remove placeholder/fake patterns and replace with deterministic real data paths
- [P1] 3DGameArtAcademy: add tenant resolver and organization_id guardrails; remove placeholder/fake patterns and replace with deterministic real data paths
- [P1] BakTokingcom: add tenant resolver and organization_id guardrails; remove placeholder/fake patterns and replace with deterministic real data paths
- [P1] booked: add tenant resolver and organization_id guardrails; remove placeholder/fake patterns and replace with deterministic real data paths

