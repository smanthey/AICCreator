# Veritap OSS Benchmark Pack (2026-03-03)

## Veritap feature surface detected
- Auth + sessions (`better-auth` in `veritap_2026`, Replit auth/session stack in `veritap`)
- Billing + Stripe + metered concepts
- Webhooks and API-key-oriented surfaces
- Queue/worker infrastructure present in dependency graph (`bullmq`, redis libs)
- Observability/logging (`winston`, monitoring hooks)

## External repos cloned for comparison
Workspace: `/Users/tatsheen/claw-repos/oss-saas-bench`

1. https://github.com/stripe-samples/subscription-use-cases
2. https://github.com/stripe-samples/checkout-single-subscription
3. https://github.com/openmeterio/openmeter
4. https://github.com/unkeyed/unkey
5. https://github.com/svix/svix-webhooks
6. https://github.com/boxyhq/saas-starter-kit
7. https://github.com/better-auth/examples
8. https://github.com/salvinoto/nextjs-better-auth-prisma
9. https://github.com/LinkStackOrg/LinkStack
10. https://github.com/CardMesh/rest-api

## Fast fit map for Veritap
- Auth/session hardening baseline: `better-auth/examples`, `nextjs-better-auth-prisma`, `saas-starter-kit`
- Stripe checkout + subscription/webhook truth source: `subscription-use-cases`, `checkout-single-subscription`
- Metered/usage billing model + entitlements: `openmeter`
- Webhook security + signature/idempotency model: `svix-webhooks`
- API key lifecycle/rate limiting patterns: `unkey`
- Link-centric product UX references: `LinkStack`

## Compare first (highest ROI)
1. Stripe webhook + subscription lifecycle
   - Veritap target: `/Users/tatsheen/claw-repos/veritap/server`
   - Compare: `subscription-use-cases`, `checkout-single-subscription`, `svix-webhooks`
2. Auth/session modernization and consistency
   - Veritap target: `/Users/tatsheen/claw-repos/veritap_2026/client/src/lib/auth-client.ts`, `/Users/tatsheen/claw-repos/veritap/server/replitAuth.ts`
   - Compare: `better-auth/examples`, `nextjs-better-auth-prisma`, `saas-starter-kit`
3. API key + rate limit + audit lane
   - Veritap target: `/Users/tatsheen/claw-repos/veritap/client/src/pages/api-keys.tsx`
   - Compare: `unkey`, `saas-starter-kit`
4. Metering/usage enforcement
   - Veritap target: `/Users/tatsheen/claw-repos/veritap/server/services/meteredBillingService*`
   - Compare: `openmeter`

## Index/compare commands (no jcode)
```bash
# 1) quick symbol grep across benchmark repos
cd /Users/tatsheen/claw-repos/oss-saas-bench
rg -n "webhook|signature|idempot|stripe|subscription|meter|auth|session|api key|ratelimit" -S \
  subscription-use-cases checkout-single-subscription openmeter unkey svix-webhooks saas-starter-kit examples nextjs-better-auth-prisma

# 2) map Veritap side
rg -n "webhook|stripe|subscription|meter|auth|session|api-key|rate limit|winston|bullmq|queue" -S \
  /Users/tatsheen/claw-repos/veritap/server /Users/tatsheen/claw-repos/veritap_2026/server

# 3) side-by-side file hunting for webhook handlers
rg --files /Users/tatsheen/claw-repos/veritap /Users/tatsheen/claw-repos/oss-saas-bench \
  | rg -n "webhook|stripe|billing|subscription|auth|session|api[-_]key" -S
```

## Notes
- `openmeter` and `unkey` are broad platforms; extract focused implementation slices only (don’t copy architecture wholesale).
- Stripe samples should be treated as canonical for webhook verification and billing event state transitions.
