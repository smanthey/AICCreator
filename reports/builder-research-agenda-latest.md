# Builder research agenda

Prioritized list of incomplete sections, issues, and next actions with suggested GitHub and Reddit searches for the builder (and InayanBuilderBot) to research.

Generated: 2026-03-05T04:22:31.507Z | Repos with gaps: 30

---

## cookies-tempe (score=32)

### Incomplete sections → research targets

- **email_setup** (incomplete)
  - GitHub: [`resend email verification webhook OR maileroo`](https://github.com/search?type=repositories&q=resend%20email%20verification%20webhook%20OR%20maileroo)
  - Reddit/search: `resend maileroo email verification webhook setup`
  - Best-case ref: local/CaptureInbound, docs/EMAIL_RESEND_MIGRATION.md

- **admin_setup** (incomplete)
  - GitHub: [`multitenant organization_id nextjs OR tenant resolver`](https://github.com/search?type=repositories&q=multitenant%20organization_id%20nextjs%20OR%20tenant%20resolver)
  - Reddit/search: `multitenant nextjs tenant resolver organization_id`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **stripe_checkout** (gap)
  - GitHub: [`stripe checkout session`](https://github.com/search?type=repositories&q=stripe%20checkout%20session)
  - Reddit/search: `stripe checkout session nextjs`
  - Best-case ref: local/autopay_ui, local/CaptureInbound, local/payclaw (feature-benchmark exemplars)

- **stripe_webhooks** (gap)
  - GitHub: [`stripe webhook signature verification idempotency`](https://github.com/search?type=repositories&q=stripe%20webhook%20signature%20verification%20idempotency)
  - Reddit/search: `stripe webhook signature verification idempotency`
  - Best-case ref: local/autopay_ui, local/CaptureInbound, local/payclaw (feature-benchmark exemplars)

- **telnyx_sms** (incomplete)
  - GitHub: [`telnyx sms webhook`](https://github.com/search?type=repositories&q=telnyx%20sms%20webhook)
  - Reddit/search: `telnyx sms webhook verification`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **webhooks_signature_verify** (incomplete)
  - GitHub: [`webhook signature verification`](https://github.com/search?type=repositories&q=webhook%20signature%20verification)
  - Reddit/search: `webhook signature verification best practices`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **queue_retry** (incomplete)
  - GitHub: [`bullmq retry queue worker`](https://github.com/search?type=repositories&q=bullmq%20retry%20queue%20worker)
  - Reddit/search: `bullmq retry queue worker node`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **observability** (incomplete)
  - GitHub: [`observability logging metrics audit`](https://github.com/search?type=repositories&q=observability%20logging%20metrics%20audit)
  - Reddit/search: `observability logging metrics node express`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **e2e** (incomplete)
  - GitHub: [`playwright e2e test OR cypress`](https://github.com/search?type=repositories&q=playwright%20e2e%20test%20OR%20cypress)
  - Reddit/search: `playwright cypress e2e testing`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **security_sweep** (incomplete)
  - GitHub: [`security audit dependency`](https://github.com/search?type=repositories&q=security%20audit%20dependency)
  - Reddit/search: `npm audit security dependency`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **capability_factory_health** (gap)
  - GitHub: [`stripe webhook auth capability`](https://github.com/search?type=repositories&q=stripe%20webhook%20auth%20capability)
  - Reddit/search: `stripe webhook auth capability patterns`
  - Best-case ref: config/capabilities.yaml, scripts/capability-factory.js pickCanonicalCandidates

### Issues to research

- **MULTITENANT_BASELINE_MISSING** (high): no tenant/org/workspace signals detected
  - Research: `multitenant tenant resolver nextjs`

- **FORBIDDEN_PATTERN** (medium): example.com in 1 file(s)
  - Research: `remove placeholder example.com fake patterns`

### Next actions

- Add tenant resolver and organization_id guardrails
- Remove placeholder/fake patterns

---

## capture (score=85)

### Incomplete sections → research targets

### Issues to research

- **FORBIDDEN_PATTERN** (medium): fake in 3 file(s)
  - Research: `remove placeholder example.com fake patterns`

- **FORBIDDEN_PATTERN** (medium): example.com in 7 file(s)
  - Research: `remove placeholder example.com fake patterns`

### Next actions

- Remove placeholder/fake patterns

---

## Inbound-cookies (score=83)

### Incomplete sections → research targets

### Issues to research

- **FORBIDDEN_PATTERN** (medium): TODO: in 2 file(s)
  - Research: `remove placeholder example.com fake patterns`

- **FORBIDDEN_PATTERN** (medium): fake in 1 file(s)
  - Research: `remove placeholder example.com fake patterns`

- **FORBIDDEN_PATTERN** (medium): example.com in 10 file(s)
  - Research: `remove placeholder example.com fake patterns`

### Next actions

- Remove placeholder/fake patterns

---

## LeadGen3 (score=35)

### Incomplete sections → research targets

- **admin_setup** (incomplete)
  - GitHub: [`multitenant organization_id nextjs OR tenant resolver`](https://github.com/search?type=repositories&q=multitenant%20organization_id%20nextjs%20OR%20tenant%20resolver)
  - Reddit/search: `multitenant nextjs tenant resolver organization_id`
  - Best-case ref: oss-dashboard-benchmark top repos

- **email_setup** (incomplete)
  - GitHub: [`resend email verification webhook OR maileroo`](https://github.com/search?type=repositories&q=resend%20email%20verification%20webhook%20OR%20maileroo)
  - Reddit/search: `resend maileroo email verification webhook setup`
  - Best-case ref: local/CaptureInbound, docs/EMAIL_RESEND_MIGRATION.md

- **queue_retry** (incomplete)
  - GitHub: [`bullmq retry queue worker`](https://github.com/search?type=repositories&q=bullmq%20retry%20queue%20worker)
  - Reddit/search: `bullmq retry queue worker node`
  - Best-case ref: oss-dashboard-benchmark top repos

- **e2e** (incomplete)
  - GitHub: [`playwright e2e test OR cypress`](https://github.com/search?type=repositories&q=playwright%20e2e%20test%20OR%20cypress)
  - Reddit/search: `playwright cypress e2e testing`
  - Best-case ref: oss-dashboard-benchmark top repos

- **capability_factory_health** (gap)
  - GitHub: [`stripe webhook auth capability`](https://github.com/search?type=repositories&q=stripe%20webhook%20auth%20capability)
  - Reddit/search: `stripe webhook auth capability patterns`
  - Best-case ref: config/capabilities.yaml, scripts/capability-factory.js pickCanonicalCandidates

### Issues to research

- **AUTH_NOT_STANDARDIZED** (critical): legacy auth detected without better-auth baseline
  - Research: `better-auth migration from next-auth`

- **MULTITENANT_BASELINE_MISSING** (high): no tenant/org/workspace signals detected
  - Research: `multitenant tenant resolver nextjs`

- **FORBIDDEN_PATTERN** (medium): TODO: in 1 file(s)
  - Research: `remove placeholder example.com fake patterns`

- **FORBIDDEN_PATTERN** (medium): fake in 3 file(s)
  - Research: `remove placeholder example.com fake patterns`

- **FORBIDDEN_PATTERN** (medium): example.com in 10 file(s)
  - Research: `remove placeholder example.com fake patterns`

### Next actions

- Migrate auth to better-auth; remove legacy auth
- Add tenant resolver and organization_id guardrails
- Remove placeholder/fake patterns

---

## gbusupdate (score=79)

### Incomplete sections → research targets

- **e2e** (incomplete)
  - GitHub: [`playwright e2e test OR cypress`](https://github.com/search?type=repositories&q=playwright%20e2e%20test%20OR%20cypress)
  - Reddit/search: `playwright cypress e2e testing`
  - Best-case ref: oss-dashboard-benchmark top repos

### Issues to research

- **FORBIDDEN_PATTERN** (medium): fake in 1 file(s)
  - Research: `remove placeholder example.com fake patterns`

### Next actions

- Remove placeholder/fake patterns

---

## nirvaan (score=51)

### Incomplete sections → research targets

- **admin_setup** (incomplete)
  - GitHub: [`multitenant organization_id nextjs OR tenant resolver`](https://github.com/search?type=repositories&q=multitenant%20organization_id%20nextjs%20OR%20tenant%20resolver)
  - Reddit/search: `multitenant nextjs tenant resolver organization_id`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **auth** (incomplete)
  - GitHub: [`better-auth`](https://github.com/search?type=repositories&q=better-auth)
  - Reddit/search: `better-auth nextjs authentication`
  - Best-case ref: local/veritap_2026, config/capabilities.yaml auth.better_auth

- **stripe_checkout** (gap)
  - GitHub: [`stripe checkout session`](https://github.com/search?type=repositories&q=stripe%20checkout%20session)
  - Reddit/search: `stripe checkout session nextjs`
  - Best-case ref: local/autopay_ui, local/CaptureInbound, local/payclaw (feature-benchmark exemplars)

- **queue_retry** (incomplete)
  - GitHub: [`bullmq retry queue worker`](https://github.com/search?type=repositories&q=bullmq%20retry%20queue%20worker)
  - Reddit/search: `bullmq retry queue worker node`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **e2e** (incomplete)
  - GitHub: [`playwright e2e test OR cypress`](https://github.com/search?type=repositories&q=playwright%20e2e%20test%20OR%20cypress)
  - Reddit/search: `playwright cypress e2e testing`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **capability_factory_health** (gap)
  - GitHub: [`stripe webhook auth capability`](https://github.com/search?type=repositories&q=stripe%20webhook%20auth%20capability)
  - Reddit/search: `stripe webhook auth capability patterns`
  - Best-case ref: config/capabilities.yaml, scripts/capability-factory.js pickCanonicalCandidates

### Issues to research

- **MULTITENANT_BASELINE_MISSING** (high): no tenant/org/workspace signals detected
  - Research: `multitenant tenant resolver nextjs`

- **FORBIDDEN_PATTERN** (medium): example.com in 1 file(s)
  - Research: `remove placeholder example.com fake patterns`

### Next actions

- Add tenant resolver and organization_id guardrails
- Remove placeholder/fake patterns

---

## 3DGameArtAcademy (score=58)

### Incomplete sections → research targets

- **admin_setup** (incomplete)
  - GitHub: [`multitenant organization_id nextjs OR tenant resolver`](https://github.com/search?type=repositories&q=multitenant%20organization_id%20nextjs%20OR%20tenant%20resolver)
  - Reddit/search: `multitenant nextjs tenant resolver organization_id`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **auth** (incomplete)
  - GitHub: [`better-auth`](https://github.com/search?type=repositories&q=better-auth)
  - Reddit/search: `better-auth nextjs authentication`
  - Best-case ref: local/veritap_2026, config/capabilities.yaml auth.better_auth

- **queue_retry** (incomplete)
  - GitHub: [`bullmq retry queue worker`](https://github.com/search?type=repositories&q=bullmq%20retry%20queue%20worker)
  - Reddit/search: `bullmq retry queue worker node`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **observability** (incomplete)
  - GitHub: [`observability logging metrics audit`](https://github.com/search?type=repositories&q=observability%20logging%20metrics%20audit)
  - Reddit/search: `observability logging metrics node express`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **capability_factory_health** (gap)
  - GitHub: [`stripe webhook auth capability`](https://github.com/search?type=repositories&q=stripe%20webhook%20auth%20capability)
  - Reddit/search: `stripe webhook auth capability patterns`
  - Best-case ref: config/capabilities.yaml, scripts/capability-factory.js pickCanonicalCandidates

### Issues to research

- **MULTITENANT_BASELINE_MISSING** (high): no tenant/org/workspace signals detected
  - Research: `multitenant tenant resolver nextjs`

- **FORBIDDEN_PATTERN** (medium): TODO: in 2 file(s)
  - Research: `remove placeholder example.com fake patterns`

- **FORBIDDEN_PATTERN** (medium): fake in 4 file(s)
  - Research: `remove placeholder example.com fake patterns`

- **FORBIDDEN_PATTERN** (medium): example.com in 10 file(s)
  - Research: `remove placeholder example.com fake patterns`

### Next actions

- Add tenant resolver and organization_id guardrails
- Remove placeholder/fake patterns

---

## BlackWallStreetopoly (score=65)

### Incomplete sections → research targets

- **auth** (incomplete)
  - GitHub: [`better-auth`](https://github.com/search?type=repositories&q=better-auth)
  - Reddit/search: `better-auth nextjs authentication`
  - Best-case ref: local/veritap_2026, config/capabilities.yaml auth.better_auth

- **telnyx_sms** (incomplete)
  - GitHub: [`telnyx sms webhook`](https://github.com/search?type=repositories&q=telnyx%20sms%20webhook)
  - Reddit/search: `telnyx sms webhook verification`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **queue_retry** (incomplete)
  - GitHub: [`bullmq retry queue worker`](https://github.com/search?type=repositories&q=bullmq%20retry%20queue%20worker)
  - Reddit/search: `bullmq retry queue worker node`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **observability** (incomplete)
  - GitHub: [`observability logging metrics audit`](https://github.com/search?type=repositories&q=observability%20logging%20metrics%20audit)
  - Reddit/search: `observability logging metrics node express`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **e2e** (incomplete)
  - GitHub: [`playwright e2e test OR cypress`](https://github.com/search?type=repositories&q=playwright%20e2e%20test%20OR%20cypress)
  - Reddit/search: `playwright cypress e2e testing`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **security_sweep** (incomplete)
  - GitHub: [`security audit dependency`](https://github.com/search?type=repositories&q=security%20audit%20dependency)
  - Reddit/search: `npm audit security dependency`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

### Issues to research

- **FORBIDDEN_PATTERN** (medium): TODO: in 3 file(s)
  - Research: `remove placeholder example.com fake patterns`

- **FORBIDDEN_PATTERN** (medium): fake in 3 file(s)
  - Research: `remove placeholder example.com fake patterns`

- **FORBIDDEN_PATTERN** (medium): example.com in 6 file(s)
  - Research: `remove placeholder example.com fake patterns`

### Next actions

- Remove placeholder/fake patterns

---

## FoodTruckPass (score=45)

### Incomplete sections → research targets

- **email_setup** (incomplete)
  - GitHub: [`resend email verification webhook OR maileroo`](https://github.com/search?type=repositories&q=resend%20email%20verification%20webhook%20OR%20maileroo)
  - Reddit/search: `resend maileroo email verification webhook setup`
  - Best-case ref: local/CaptureInbound, docs/EMAIL_RESEND_MIGRATION.md

- **admin_setup** (incomplete)
  - GitHub: [`multitenant organization_id nextjs OR tenant resolver`](https://github.com/search?type=repositories&q=multitenant%20organization_id%20nextjs%20OR%20tenant%20resolver)
  - Reddit/search: `multitenant nextjs tenant resolver organization_id`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **telnyx_sms** (incomplete)
  - GitHub: [`telnyx sms webhook`](https://github.com/search?type=repositories&q=telnyx%20sms%20webhook)
  - Reddit/search: `telnyx sms webhook verification`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **queue_retry** (incomplete)
  - GitHub: [`bullmq retry queue worker`](https://github.com/search?type=repositories&q=bullmq%20retry%20queue%20worker)
  - Reddit/search: `bullmq retry queue worker node`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **observability** (incomplete)
  - GitHub: [`observability logging metrics audit`](https://github.com/search?type=repositories&q=observability%20logging%20metrics%20audit)
  - Reddit/search: `observability logging metrics node express`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **security_sweep** (incomplete)
  - GitHub: [`security audit dependency`](https://github.com/search?type=repositories&q=security%20audit%20dependency)
  - Reddit/search: `npm audit security dependency`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **capability_factory_health** (gap)
  - GitHub: [`stripe webhook auth capability`](https://github.com/search?type=repositories&q=stripe%20webhook%20auth%20capability)
  - Reddit/search: `stripe webhook auth capability patterns`
  - Best-case ref: config/capabilities.yaml, scripts/capability-factory.js pickCanonicalCandidates

### Issues to research

- **MULTITENANT_BASELINE_MISSING** (high): no tenant/org/workspace signals detected
  - Research: `multitenant tenant resolver nextjs`

- **FORBIDDEN_PATTERN** (medium): example.com in 4 file(s)
  - Research: `remove placeholder example.com fake patterns`

### Next actions

- Add tenant resolver and organization_id guardrails
- Remove placeholder/fake patterns

---

## HowtoWatchStream-SmartKB (score=45)

### Incomplete sections → research targets

- **stripe_checkout** (gap)
  - GitHub: [`stripe checkout session`](https://github.com/search?type=repositories&q=stripe%20checkout%20session)
  - Reddit/search: `stripe checkout session nextjs`
  - Best-case ref: local/autopay_ui, local/CaptureInbound, local/payclaw

- **stripe_webhooks** (gap)
  - GitHub: [`stripe webhook signature verification idempotency`](https://github.com/search?type=repositories&q=stripe%20webhook%20signature%20verification%20idempotency)
  - Reddit/search: `stripe webhook signature verification idempotency`
  - Best-case ref: local/autopay_ui, local/CaptureInbound, local/payclaw

- **telnyx_sms** (incomplete)
  - GitHub: [`telnyx sms webhook`](https://github.com/search?type=repositories&q=telnyx%20sms%20webhook)
  - Reddit/search: `telnyx sms webhook verification`
  - Best-case ref: oss-dashboard-benchmark top repos

- **auth** (incomplete)
  - GitHub: [`better-auth`](https://github.com/search?type=repositories&q=better-auth)
  - Reddit/search: `better-auth nextjs authentication`
  - Best-case ref: local/veritap_2026, config/capabilities.yaml auth.better_auth

- **email_setup** (incomplete)
  - GitHub: [`resend email verification webhook OR maileroo`](https://github.com/search?type=repositories&q=resend%20email%20verification%20webhook%20OR%20maileroo)
  - Reddit/search: `resend maileroo email verification webhook setup`
  - Best-case ref: local/CaptureInbound, docs/EMAIL_RESEND_MIGRATION.md

- **queue_retry** (incomplete)
  - GitHub: [`bullmq retry queue worker`](https://github.com/search?type=repositories&q=bullmq%20retry%20queue%20worker)
  - Reddit/search: `bullmq retry queue worker node`
  - Best-case ref: oss-dashboard-benchmark top repos

- **observability** (incomplete)
  - GitHub: [`observability logging metrics audit`](https://github.com/search?type=repositories&q=observability%20logging%20metrics%20audit)
  - Reddit/search: `observability logging metrics node express`
  - Best-case ref: oss-dashboard-benchmark top repos

- **e2e** (incomplete)
  - GitHub: [`playwright e2e test OR cypress`](https://github.com/search?type=repositories&q=playwright%20e2e%20test%20OR%20cypress)
  - Reddit/search: `playwright cypress e2e testing`
  - Best-case ref: oss-dashboard-benchmark top repos

- **security_sweep** (incomplete)
  - GitHub: [`security audit dependency`](https://github.com/search?type=repositories&q=security%20audit%20dependency)
  - Reddit/search: `npm audit security dependency`
  - Best-case ref: oss-dashboard-benchmark top repos

---

## Madirectory (score=35)

### Incomplete sections → research targets

- **email_setup** (incomplete)
  - GitHub: [`resend email verification webhook OR maileroo`](https://github.com/search?type=repositories&q=resend%20email%20verification%20webhook%20OR%20maileroo)
  - Reddit/search: `resend maileroo email verification webhook setup`
  - Best-case ref: local/CaptureInbound, docs/EMAIL_RESEND_MIGRATION.md

- **admin_setup** (incomplete)
  - GitHub: [`multitenant organization_id nextjs OR tenant resolver`](https://github.com/search?type=repositories&q=multitenant%20organization_id%20nextjs%20OR%20tenant%20resolver)
  - Reddit/search: `multitenant nextjs tenant resolver organization_id`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **queue_retry** (incomplete)
  - GitHub: [`bullmq retry queue worker`](https://github.com/search?type=repositories&q=bullmq%20retry%20queue%20worker)
  - Reddit/search: `bullmq retry queue worker node`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **e2e** (incomplete)
  - GitHub: [`playwright e2e test OR cypress`](https://github.com/search?type=repositories&q=playwright%20e2e%20test%20OR%20cypress)
  - Reddit/search: `playwright cypress e2e testing`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **capability_factory_health** (gap)
  - GitHub: [`stripe webhook auth capability`](https://github.com/search?type=repositories&q=stripe%20webhook%20auth%20capability)
  - Reddit/search: `stripe webhook auth capability patterns`
  - Best-case ref: config/capabilities.yaml, scripts/capability-factory.js pickCanonicalCandidates

### Issues to research

- **AUTH_NOT_STANDARDIZED** (critical): legacy auth detected without better-auth baseline
  - Research: `better-auth migration from next-auth`

- **MULTITENANT_BASELINE_MISSING** (high): no tenant/org/workspace signals detected
  - Research: `multitenant tenant resolver nextjs`

- **FORBIDDEN_PATTERN** (medium): TODO: in 2 file(s)
  - Research: `remove placeholder example.com fake patterns`

- **FORBIDDEN_PATTERN** (medium): fake in 10 file(s)
  - Research: `remove placeholder example.com fake patterns`

- **FORBIDDEN_PATTERN** (medium): example.com in 10 file(s)
  - Research: `remove placeholder example.com fake patterns`

### Next actions

- Migrate auth to better-auth; remove legacy auth
- Add tenant resolver and organization_id guardrails
- Remove placeholder/fake patterns

---

## patentpal (score=29)

### Incomplete sections → research targets

- **email_setup** (incomplete)
  - GitHub: [`resend email verification webhook OR maileroo`](https://github.com/search?type=repositories&q=resend%20email%20verification%20webhook%20OR%20maileroo)
  - Reddit/search: `resend maileroo email verification webhook setup`
  - Best-case ref: local/CaptureInbound, docs/EMAIL_RESEND_MIGRATION.md

- **admin_setup** (incomplete)
  - GitHub: [`multitenant organization_id nextjs OR tenant resolver`](https://github.com/search?type=repositories&q=multitenant%20organization_id%20nextjs%20OR%20tenant%20resolver)
  - Reddit/search: `multitenant nextjs tenant resolver organization_id`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **auth** (incomplete)
  - GitHub: [`better-auth`](https://github.com/search?type=repositories&q=better-auth)
  - Reddit/search: `better-auth nextjs authentication`
  - Best-case ref: local/veritap_2026, config/capabilities.yaml auth.better_auth

- **stripe_checkout** (gap)
  - GitHub: [`stripe checkout session`](https://github.com/search?type=repositories&q=stripe%20checkout%20session)
  - Reddit/search: `stripe checkout session nextjs`
  - Best-case ref: local/autopay_ui, local/CaptureInbound, local/payclaw (feature-benchmark exemplars)

- **stripe_webhooks** (gap)
  - GitHub: [`stripe webhook signature verification idempotency`](https://github.com/search?type=repositories&q=stripe%20webhook%20signature%20verification%20idempotency)
  - Reddit/search: `stripe webhook signature verification idempotency`
  - Best-case ref: local/autopay_ui, local/CaptureInbound, local/payclaw (feature-benchmark exemplars)

- **telnyx_sms** (incomplete)
  - GitHub: [`telnyx sms webhook`](https://github.com/search?type=repositories&q=telnyx%20sms%20webhook)
  - Reddit/search: `telnyx sms webhook verification`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **webhooks_signature_verify** (incomplete)
  - GitHub: [`webhook signature verification`](https://github.com/search?type=repositories&q=webhook%20signature%20verification)
  - Reddit/search: `webhook signature verification best practices`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **queue_retry** (incomplete)
  - GitHub: [`bullmq retry queue worker`](https://github.com/search?type=repositories&q=bullmq%20retry%20queue%20worker)
  - Reddit/search: `bullmq retry queue worker node`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **observability** (incomplete)
  - GitHub: [`observability logging metrics audit`](https://github.com/search?type=repositories&q=observability%20logging%20metrics%20audit)
  - Reddit/search: `observability logging metrics node express`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **e2e** (incomplete)
  - GitHub: [`playwright e2e test OR cypress`](https://github.com/search?type=repositories&q=playwright%20e2e%20test%20OR%20cypress)
  - Reddit/search: `playwright cypress e2e testing`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **security_sweep** (incomplete)
  - GitHub: [`security audit dependency`](https://github.com/search?type=repositories&q=security%20audit%20dependency)
  - Reddit/search: `npm audit security dependency`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **capability_factory_health** (gap)
  - GitHub: [`stripe webhook auth capability`](https://github.com/search?type=repositories&q=stripe%20webhook%20auth%20capability)
  - Reddit/search: `stripe webhook auth capability patterns`
  - Best-case ref: config/capabilities.yaml, scripts/capability-factory.js pickCanonicalCandidates

### Issues to research

- **MULTITENANT_BASELINE_MISSING** (high): no tenant/org/workspace signals detected
  - Research: `multitenant tenant resolver nextjs`

### Next actions

- Add tenant resolver and organization_id guardrails

---

## SmartKB (score=35)

### Incomplete sections → research targets

- **email_setup** (incomplete)
  - GitHub: [`resend email verification webhook OR maileroo`](https://github.com/search?type=repositories&q=resend%20email%20verification%20webhook%20OR%20maileroo)
  - Reddit/search: `resend maileroo email verification webhook setup`
  - Best-case ref: local/CaptureInbound, docs/EMAIL_RESEND_MIGRATION.md

- **admin_setup** (incomplete)
  - GitHub: [`multitenant organization_id nextjs OR tenant resolver`](https://github.com/search?type=repositories&q=multitenant%20organization_id%20nextjs%20OR%20tenant%20resolver)
  - Reddit/search: `multitenant nextjs tenant resolver organization_id`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **queue_retry** (incomplete)
  - GitHub: [`bullmq retry queue worker`](https://github.com/search?type=repositories&q=bullmq%20retry%20queue%20worker)
  - Reddit/search: `bullmq retry queue worker node`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **e2e** (incomplete)
  - GitHub: [`playwright e2e test OR cypress`](https://github.com/search?type=repositories&q=playwright%20e2e%20test%20OR%20cypress)
  - Reddit/search: `playwright cypress e2e testing`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **capability_factory_health** (gap)
  - GitHub: [`stripe webhook auth capability`](https://github.com/search?type=repositories&q=stripe%20webhook%20auth%20capability)
  - Reddit/search: `stripe webhook auth capability patterns`
  - Best-case ref: config/capabilities.yaml, scripts/capability-factory.js pickCanonicalCandidates

### Issues to research

- **AUTH_NOT_STANDARDIZED** (critical): legacy auth detected without better-auth baseline
  - Research: `better-auth migration from next-auth`

- **MULTITENANT_BASELINE_MISSING** (high): no tenant/org/workspace signals detected
  - Research: `multitenant tenant resolver nextjs`

- **FORBIDDEN_PATTERN** (medium): TODO: in 1 file(s)
  - Research: `remove placeholder example.com fake patterns`

- **FORBIDDEN_PATTERN** (medium): fake in 3 file(s)
  - Research: `remove placeholder example.com fake patterns`

- **FORBIDDEN_PATTERN** (medium): example.com in 10 file(s)
  - Research: `remove placeholder example.com fake patterns`

### Next actions

- Migrate auth to better-auth; remove legacy auth
- Add tenant resolver and organization_id guardrails
- Remove placeholder/fake patterns

---

## SocialAiPilot (score=43)

### Incomplete sections → research targets

- **email_setup** (incomplete)
  - GitHub: [`resend email verification webhook OR maileroo`](https://github.com/search?type=repositories&q=resend%20email%20verification%20webhook%20OR%20maileroo)
  - Reddit/search: `resend maileroo email verification webhook setup`
  - Best-case ref: local/CaptureInbound, docs/EMAIL_RESEND_MIGRATION.md

- **admin_setup** (incomplete)
  - GitHub: [`multitenant organization_id nextjs OR tenant resolver`](https://github.com/search?type=repositories&q=multitenant%20organization_id%20nextjs%20OR%20tenant%20resolver)
  - Reddit/search: `multitenant nextjs tenant resolver organization_id`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **stripe_checkout** (gap)
  - GitHub: [`stripe checkout session`](https://github.com/search?type=repositories&q=stripe%20checkout%20session)
  - Reddit/search: `stripe checkout session nextjs`
  - Best-case ref: local/autopay_ui, local/CaptureInbound, local/payclaw (feature-benchmark exemplars)

- **telnyx_sms** (incomplete)
  - GitHub: [`telnyx sms webhook`](https://github.com/search?type=repositories&q=telnyx%20sms%20webhook)
  - Reddit/search: `telnyx sms webhook verification`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **queue_retry** (incomplete)
  - GitHub: [`bullmq retry queue worker`](https://github.com/search?type=repositories&q=bullmq%20retry%20queue%20worker)
  - Reddit/search: `bullmq retry queue worker node`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **observability** (incomplete)
  - GitHub: [`observability logging metrics audit`](https://github.com/search?type=repositories&q=observability%20logging%20metrics%20audit)
  - Reddit/search: `observability logging metrics node express`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **e2e** (incomplete)
  - GitHub: [`playwright e2e test OR cypress`](https://github.com/search?type=repositories&q=playwright%20e2e%20test%20OR%20cypress)
  - Reddit/search: `playwright cypress e2e testing`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **security_sweep** (incomplete)
  - GitHub: [`security audit dependency`](https://github.com/search?type=repositories&q=security%20audit%20dependency)
  - Reddit/search: `npm audit security dependency`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **capability_factory_health** (gap)
  - GitHub: [`stripe webhook auth capability`](https://github.com/search?type=repositories&q=stripe%20webhook%20auth%20capability)
  - Reddit/search: `stripe webhook auth capability patterns`
  - Best-case ref: config/capabilities.yaml, scripts/capability-factory.js pickCanonicalCandidates

### Issues to research

- **MULTITENANT_BASELINE_MISSING** (high): no tenant/org/workspace signals detected
  - Research: `multitenant tenant resolver nextjs`

- **FORBIDDEN_PATTERN** (medium): TODO: in 1 file(s)
  - Research: `remove placeholder example.com fake patterns`

- **FORBIDDEN_PATTERN** (medium): fake in 2 file(s)
  - Research: `remove placeholder example.com fake patterns`

- **FORBIDDEN_PATTERN** (medium): example.com in 2 file(s)
  - Research: `remove placeholder example.com fake patterns`

### Next actions

- Add tenant resolver and organization_id guardrails
- Remove placeholder/fake patterns

---

## SomaveaChaser (score=55)

### Incomplete sections → research targets

- **admin_setup** (incomplete)
  - GitHub: [`multitenant organization_id nextjs OR tenant resolver`](https://github.com/search?type=repositories&q=multitenant%20organization_id%20nextjs%20OR%20tenant%20resolver)
  - Reddit/search: `multitenant nextjs tenant resolver organization_id`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **auth** (incomplete)
  - GitHub: [`better-auth`](https://github.com/search?type=repositories&q=better-auth)
  - Reddit/search: `better-auth nextjs authentication`
  - Best-case ref: local/veritap_2026, config/capabilities.yaml auth.better_auth

- **telnyx_sms** (incomplete)
  - GitHub: [`telnyx sms webhook`](https://github.com/search?type=repositories&q=telnyx%20sms%20webhook)
  - Reddit/search: `telnyx sms webhook verification`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **queue_retry** (incomplete)
  - GitHub: [`bullmq retry queue worker`](https://github.com/search?type=repositories&q=bullmq%20retry%20queue%20worker)
  - Reddit/search: `bullmq retry queue worker node`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **observability** (incomplete)
  - GitHub: [`observability logging metrics audit`](https://github.com/search?type=repositories&q=observability%20logging%20metrics%20audit)
  - Reddit/search: `observability logging metrics node express`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **capability_factory_health** (gap)
  - GitHub: [`stripe webhook auth capability`](https://github.com/search?type=repositories&q=stripe%20webhook%20auth%20capability)
  - Reddit/search: `stripe webhook auth capability patterns`
  - Best-case ref: config/capabilities.yaml, scripts/capability-factory.js pickCanonicalCandidates

### Issues to research

- **MULTITENANT_BASELINE_MISSING** (high): no tenant/org/workspace signals detected
  - Research: `multitenant tenant resolver nextjs`

- **FORBIDDEN_PATTERN** (medium): fake in 8 file(s)
  - Research: `remove placeholder example.com fake patterns`

- **FORBIDDEN_PATTERN** (medium): example.com in 10 file(s)
  - Research: `remove placeholder example.com fake patterns`

### Next actions

- Add tenant resolver and organization_id guardrails
- Remove placeholder/fake patterns

---

## syrup-internal-line-sheet (score=19)

### Incomplete sections → research targets

- **email_setup** (incomplete)
  - GitHub: [`resend email verification webhook OR maileroo`](https://github.com/search?type=repositories&q=resend%20email%20verification%20webhook%20OR%20maileroo)
  - Reddit/search: `resend maileroo email verification webhook setup`
  - Best-case ref: local/CaptureInbound, docs/EMAIL_RESEND_MIGRATION.md

- **admin_setup** (incomplete)
  - GitHub: [`multitenant organization_id nextjs OR tenant resolver`](https://github.com/search?type=repositories&q=multitenant%20organization_id%20nextjs%20OR%20tenant%20resolver)
  - Reddit/search: `multitenant nextjs tenant resolver organization_id`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **auth** (incomplete)
  - GitHub: [`better-auth`](https://github.com/search?type=repositories&q=better-auth)
  - Reddit/search: `better-auth nextjs authentication`
  - Best-case ref: local/veritap_2026, config/capabilities.yaml auth.better_auth

- **stripe_checkout** (gap)
  - GitHub: [`stripe checkout session`](https://github.com/search?type=repositories&q=stripe%20checkout%20session)
  - Reddit/search: `stripe checkout session nextjs`
  - Best-case ref: local/autopay_ui, local/CaptureInbound, local/payclaw (feature-benchmark exemplars)

- **stripe_webhooks** (gap)
  - GitHub: [`stripe webhook signature verification idempotency`](https://github.com/search?type=repositories&q=stripe%20webhook%20signature%20verification%20idempotency)
  - Reddit/search: `stripe webhook signature verification idempotency`
  - Best-case ref: local/autopay_ui, local/CaptureInbound, local/payclaw (feature-benchmark exemplars)

- **telnyx_sms** (incomplete)
  - GitHub: [`telnyx sms webhook`](https://github.com/search?type=repositories&q=telnyx%20sms%20webhook)
  - Reddit/search: `telnyx sms webhook verification`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **webhooks_signature_verify** (incomplete)
  - GitHub: [`webhook signature verification`](https://github.com/search?type=repositories&q=webhook%20signature%20verification)
  - Reddit/search: `webhook signature verification best practices`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **queue_retry** (incomplete)
  - GitHub: [`bullmq retry queue worker`](https://github.com/search?type=repositories&q=bullmq%20retry%20queue%20worker)
  - Reddit/search: `bullmq retry queue worker node`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **observability** (incomplete)
  - GitHub: [`observability logging metrics audit`](https://github.com/search?type=repositories&q=observability%20logging%20metrics%20audit)
  - Reddit/search: `observability logging metrics node express`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **security_sweep** (incomplete)
  - GitHub: [`security audit dependency`](https://github.com/search?type=repositories&q=security%20audit%20dependency)
  - Reddit/search: `npm audit security dependency`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **capability_factory_health** (gap)
  - GitHub: [`stripe webhook auth capability`](https://github.com/search?type=repositories&q=stripe%20webhook%20auth%20capability)
  - Reddit/search: `stripe webhook auth capability patterns`
  - Best-case ref: config/capabilities.yaml, scripts/capability-factory.js pickCanonicalCandidates

### Issues to research

- **MULTITENANT_BASELINE_MISSING** (high): no tenant/org/workspace signals detected
  - Research: `multitenant tenant resolver nextjs`

### Next actions

- Add tenant resolver and organization_id guardrails

---

## tap2 (score=65)

### Incomplete sections → research targets

- **stripe_checkout** (gap)
  - GitHub: [`stripe checkout session`](https://github.com/search?type=repositories&q=stripe%20checkout%20session)
  - Reddit/search: `stripe checkout session nextjs`
  - Best-case ref: local/autopay_ui, local/CaptureInbound, local/payclaw (feature-benchmark exemplars)

- **queue_retry** (incomplete)
  - GitHub: [`bullmq retry queue worker`](https://github.com/search?type=repositories&q=bullmq%20retry%20queue%20worker)
  - Reddit/search: `bullmq retry queue worker node`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **observability** (incomplete)
  - GitHub: [`observability logging metrics audit`](https://github.com/search?type=repositories&q=observability%20logging%20metrics%20audit)
  - Reddit/search: `observability logging metrics node express`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **security_sweep** (incomplete)
  - GitHub: [`security audit dependency`](https://github.com/search?type=repositories&q=security%20audit%20dependency)
  - Reddit/search: `npm audit security dependency`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

### Issues to research

- **FORBIDDEN_PATTERN** (medium): example.com in 4 file(s)
  - Research: `remove placeholder example.com fake patterns`

### Next actions

- Remove placeholder/fake patterns

---

## wmactealth (score=45)

### Incomplete sections → research targets

- **email_setup** (incomplete)
  - GitHub: [`resend email verification webhook OR maileroo`](https://github.com/search?type=repositories&q=resend%20email%20verification%20webhook%20OR%20maileroo)
  - Reddit/search: `resend maileroo email verification webhook setup`
  - Best-case ref: local/CaptureInbound, docs/EMAIL_RESEND_MIGRATION.md

- **admin_setup** (incomplete)
  - GitHub: [`multitenant organization_id nextjs OR tenant resolver`](https://github.com/search?type=repositories&q=multitenant%20organization_id%20nextjs%20OR%20tenant%20resolver)
  - Reddit/search: `multitenant nextjs tenant resolver organization_id`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **telnyx_sms** (incomplete)
  - GitHub: [`telnyx sms webhook`](https://github.com/search?type=repositories&q=telnyx%20sms%20webhook)
  - Reddit/search: `telnyx sms webhook verification`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **queue_retry** (incomplete)
  - GitHub: [`bullmq retry queue worker`](https://github.com/search?type=repositories&q=bullmq%20retry%20queue%20worker)
  - Reddit/search: `bullmq retry queue worker node`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **observability** (incomplete)
  - GitHub: [`observability logging metrics audit`](https://github.com/search?type=repositories&q=observability%20logging%20metrics%20audit)
  - Reddit/search: `observability logging metrics node express`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **security_sweep** (incomplete)
  - GitHub: [`security audit dependency`](https://github.com/search?type=repositories&q=security%20audit%20dependency)
  - Reddit/search: `npm audit security dependency`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **capability_factory_health** (gap)
  - GitHub: [`stripe webhook auth capability`](https://github.com/search?type=repositories&q=stripe%20webhook%20auth%20capability)
  - Reddit/search: `stripe webhook auth capability patterns`
  - Best-case ref: config/capabilities.yaml, scripts/capability-factory.js pickCanonicalCandidates

### Issues to research

- **MULTITENANT_BASELINE_MISSING** (high): no tenant/org/workspace signals detected
  - Research: `multitenant tenant resolver nextjs`

- **FORBIDDEN_PATTERN** (medium): TODO: in 2 file(s)
  - Research: `remove placeholder example.com fake patterns`

- **FORBIDDEN_PATTERN** (medium): example.com in 2 file(s)
  - Research: `remove placeholder example.com fake patterns`

### Next actions

- Add tenant resolver and organization_id guardrails
- Remove placeholder/fake patterns

---

## wmactealth-lc (score=58)

### Incomplete sections → research targets

- **email_setup** (incomplete)
  - GitHub: [`resend email verification webhook OR maileroo`](https://github.com/search?type=repositories&q=resend%20email%20verification%20webhook%20OR%20maileroo)
  - Reddit/search: `resend maileroo email verification webhook setup`
  - Best-case ref: local/CaptureInbound, docs/EMAIL_RESEND_MIGRATION.md

- **telnyx_sms** (incomplete)
  - GitHub: [`telnyx sms webhook`](https://github.com/search?type=repositories&q=telnyx%20sms%20webhook)
  - Reddit/search: `telnyx sms webhook verification`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **queue_retry** (incomplete)
  - GitHub: [`bullmq retry queue worker`](https://github.com/search?type=repositories&q=bullmq%20retry%20queue%20worker)
  - Reddit/search: `bullmq retry queue worker node`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **observability** (incomplete)
  - GitHub: [`observability logging metrics audit`](https://github.com/search?type=repositories&q=observability%20logging%20metrics%20audit)
  - Reddit/search: `observability logging metrics node express`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **security_sweep** (incomplete)
  - GitHub: [`security audit dependency`](https://github.com/search?type=repositories&q=security%20audit%20dependency)
  - Reddit/search: `npm audit security dependency`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **capability_factory_health** (incomplete)
  - GitHub: [`stripe webhook auth capability`](https://github.com/search?type=repositories&q=stripe%20webhook%20auth%20capability)
  - Reddit/search: `stripe webhook auth capability patterns`
  - Best-case ref: config/capabilities.yaml, scripts/capability-factory.js pickCanonicalCandidates

### Issues to research

- **FORBIDDEN_PATTERN** (medium): TODO: in 1 file(s)
  - Research: `remove placeholder example.com fake patterns`

- **FORBIDDEN_PATTERN** (medium): example.com in 2 file(s)
  - Research: `remove placeholder example.com fake patterns`

### Next actions

- Remove placeholder/fake patterns

---

## BakTokingcom (score=51)

### Incomplete sections → research targets

- **email_setup** (incomplete)
  - GitHub: [`resend email verification webhook OR maileroo`](https://github.com/search?type=repositories&q=resend%20email%20verification%20webhook%20OR%20maileroo)
  - Reddit/search: `resend maileroo email verification webhook setup`
  - Best-case ref: local/CaptureInbound, docs/EMAIL_RESEND_MIGRATION.md

- **admin_setup** (incomplete)
  - GitHub: [`multitenant organization_id nextjs OR tenant resolver`](https://github.com/search?type=repositories&q=multitenant%20organization_id%20nextjs%20OR%20tenant%20resolver)
  - Reddit/search: `multitenant nextjs tenant resolver organization_id`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **stripe_checkout** (gap)
  - GitHub: [`stripe checkout session`](https://github.com/search?type=repositories&q=stripe%20checkout%20session)
  - Reddit/search: `stripe checkout session nextjs`
  - Best-case ref: local/autopay_ui, local/CaptureInbound, local/payclaw (feature-benchmark exemplars)

- **telnyx_sms** (incomplete)
  - GitHub: [`telnyx sms webhook`](https://github.com/search?type=repositories&q=telnyx%20sms%20webhook)
  - Reddit/search: `telnyx sms webhook verification`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **queue_retry** (incomplete)
  - GitHub: [`bullmq retry queue worker`](https://github.com/search?type=repositories&q=bullmq%20retry%20queue%20worker)
  - Reddit/search: `bullmq retry queue worker node`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **e2e** (incomplete)
  - GitHub: [`playwright e2e test OR cypress`](https://github.com/search?type=repositories&q=playwright%20e2e%20test%20OR%20cypress)
  - Reddit/search: `playwright cypress e2e testing`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **capability_factory_health** (gap)
  - GitHub: [`stripe webhook auth capability`](https://github.com/search?type=repositories&q=stripe%20webhook%20auth%20capability)
  - Reddit/search: `stripe webhook auth capability patterns`
  - Best-case ref: config/capabilities.yaml, scripts/capability-factory.js pickCanonicalCandidates

### Issues to research

- **MULTITENANT_BASELINE_MISSING** (high): no tenant/org/workspace signals detected
  - Research: `multitenant tenant resolver nextjs`

- **FORBIDDEN_PATTERN** (medium): mockTranslate( in 2 file(s)
  - Research: `remove placeholder example.com fake patterns`

- **FORBIDDEN_PATTERN** (medium): fake in 1 file(s)
  - Research: `remove placeholder example.com fake patterns`

- **FORBIDDEN_PATTERN** (medium): example.com in 1 file(s)
  - Research: `remove placeholder example.com fake patterns`

### Next actions

- Add tenant resolver and organization_id guardrails
- Remove placeholder/fake patterns

---

## RobloxGitSync (score=18)

### Incomplete sections → research targets

- **email_setup** (incomplete)
  - GitHub: [`resend email verification webhook OR maileroo`](https://github.com/search?type=repositories&q=resend%20email%20verification%20webhook%20OR%20maileroo)
  - Reddit/search: `resend maileroo email verification webhook setup`
  - Best-case ref: local/CaptureInbound, docs/EMAIL_RESEND_MIGRATION.md

- **admin_setup** (incomplete)
  - GitHub: [`multitenant organization_id nextjs OR tenant resolver`](https://github.com/search?type=repositories&q=multitenant%20organization_id%20nextjs%20OR%20tenant%20resolver)
  - Reddit/search: `multitenant nextjs tenant resolver organization_id`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **auth** (incomplete)
  - GitHub: [`better-auth`](https://github.com/search?type=repositories&q=better-auth)
  - Reddit/search: `better-auth nextjs authentication`
  - Best-case ref: local/veritap_2026, config/capabilities.yaml auth.better_auth

- **stripe_checkout** (gap)
  - GitHub: [`stripe checkout session`](https://github.com/search?type=repositories&q=stripe%20checkout%20session)
  - Reddit/search: `stripe checkout session nextjs`
  - Best-case ref: local/autopay_ui, local/CaptureInbound, local/payclaw (feature-benchmark exemplars)

- **stripe_webhooks** (gap)
  - GitHub: [`stripe webhook signature verification idempotency`](https://github.com/search?type=repositories&q=stripe%20webhook%20signature%20verification%20idempotency)
  - Reddit/search: `stripe webhook signature verification idempotency`
  - Best-case ref: local/autopay_ui, local/CaptureInbound, local/payclaw (feature-benchmark exemplars)

- **telnyx_sms** (incomplete)
  - GitHub: [`telnyx sms webhook`](https://github.com/search?type=repositories&q=telnyx%20sms%20webhook)
  - Reddit/search: `telnyx sms webhook verification`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **webhooks_signature_verify** (incomplete)
  - GitHub: [`webhook signature verification`](https://github.com/search?type=repositories&q=webhook%20signature%20verification)
  - Reddit/search: `webhook signature verification best practices`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **queue_retry** (incomplete)
  - GitHub: [`bullmq retry queue worker`](https://github.com/search?type=repositories&q=bullmq%20retry%20queue%20worker)
  - Reddit/search: `bullmq retry queue worker node`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **observability** (incomplete)
  - GitHub: [`observability logging metrics audit`](https://github.com/search?type=repositories&q=observability%20logging%20metrics%20audit)
  - Reddit/search: `observability logging metrics node express`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **e2e** (incomplete)
  - GitHub: [`playwright e2e test OR cypress`](https://github.com/search?type=repositories&q=playwright%20e2e%20test%20OR%20cypress)
  - Reddit/search: `playwright cypress e2e testing`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **security_sweep** (incomplete)
  - GitHub: [`security audit dependency`](https://github.com/search?type=repositories&q=security%20audit%20dependency)
  - Reddit/search: `npm audit security dependency`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **capability_factory_health** (gap)
  - GitHub: [`stripe webhook auth capability`](https://github.com/search?type=repositories&q=stripe%20webhook%20auth%20capability)
  - Reddit/search: `stripe webhook auth capability patterns`
  - Best-case ref: config/capabilities.yaml, scripts/capability-factory.js pickCanonicalCandidates

- **feature_benchmark_vs_exemplar** (incomplete)
  - GitHub: [`feature benchmark exemplar`](https://github.com/search?type=repositories&q=feature%20benchmark%20exemplar)
  - Reddit/search: `feature benchmark exemplar`
  - Best-case ref: scripts/feature-benchmark-score.js EXEMPLAR_LIBRARY, data/exemplar-repos.json

### Issues to research

- **MULTITENANT_BASELINE_MISSING** (high): no tenant/org/workspace signals detected
  - Research: `multitenant tenant resolver nextjs`

### Next actions

- Add tenant resolver and organization_id guardrails

---

## Cookies_Pass (score=18)

### Incomplete sections → research targets

- **email_setup** (incomplete)
  - GitHub: [`resend email verification webhook OR maileroo`](https://github.com/search?type=repositories&q=resend%20email%20verification%20webhook%20OR%20maileroo)
  - Reddit/search: `resend maileroo email verification webhook setup`
  - Best-case ref: local/CaptureInbound, docs/EMAIL_RESEND_MIGRATION.md

- **admin_setup** (incomplete)
  - GitHub: [`multitenant organization_id nextjs OR tenant resolver`](https://github.com/search?type=repositories&q=multitenant%20organization_id%20nextjs%20OR%20tenant%20resolver)
  - Reddit/search: `multitenant nextjs tenant resolver organization_id`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **auth** (incomplete)
  - GitHub: [`better-auth`](https://github.com/search?type=repositories&q=better-auth)
  - Reddit/search: `better-auth nextjs authentication`
  - Best-case ref: local/veritap_2026, config/capabilities.yaml auth.better_auth

- **stripe_checkout** (gap)
  - GitHub: [`stripe checkout session`](https://github.com/search?type=repositories&q=stripe%20checkout%20session)
  - Reddit/search: `stripe checkout session nextjs`
  - Best-case ref: local/autopay_ui, local/CaptureInbound, local/payclaw (feature-benchmark exemplars)

- **stripe_webhooks** (gap)
  - GitHub: [`stripe webhook signature verification idempotency`](https://github.com/search?type=repositories&q=stripe%20webhook%20signature%20verification%20idempotency)
  - Reddit/search: `stripe webhook signature verification idempotency`
  - Best-case ref: local/autopay_ui, local/CaptureInbound, local/payclaw (feature-benchmark exemplars)

- **telnyx_sms** (incomplete)
  - GitHub: [`telnyx sms webhook`](https://github.com/search?type=repositories&q=telnyx%20sms%20webhook)
  - Reddit/search: `telnyx sms webhook verification`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **webhooks_signature_verify** (incomplete)
  - GitHub: [`webhook signature verification`](https://github.com/search?type=repositories&q=webhook%20signature%20verification)
  - Reddit/search: `webhook signature verification best practices`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **queue_retry** (incomplete)
  - GitHub: [`bullmq retry queue worker`](https://github.com/search?type=repositories&q=bullmq%20retry%20queue%20worker)
  - Reddit/search: `bullmq retry queue worker node`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **observability** (incomplete)
  - GitHub: [`observability logging metrics audit`](https://github.com/search?type=repositories&q=observability%20logging%20metrics%20audit)
  - Reddit/search: `observability logging metrics node express`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **e2e** (incomplete)
  - GitHub: [`playwright e2e test OR cypress`](https://github.com/search?type=repositories&q=playwright%20e2e%20test%20OR%20cypress)
  - Reddit/search: `playwright cypress e2e testing`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **security_sweep** (incomplete)
  - GitHub: [`security audit dependency`](https://github.com/search?type=repositories&q=security%20audit%20dependency)
  - Reddit/search: `npm audit security dependency`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **capability_factory_health** (gap)
  - GitHub: [`stripe webhook auth capability`](https://github.com/search?type=repositories&q=stripe%20webhook%20auth%20capability)
  - Reddit/search: `stripe webhook auth capability patterns`
  - Best-case ref: config/capabilities.yaml, scripts/capability-factory.js pickCanonicalCandidates

- **feature_benchmark_vs_exemplar** (incomplete)
  - GitHub: [`feature benchmark exemplar`](https://github.com/search?type=repositories&q=feature%20benchmark%20exemplar)
  - Reddit/search: `feature benchmark exemplar`
  - Best-case ref: scripts/feature-benchmark-score.js EXEMPLAR_LIBRARY, data/exemplar-repos.json

### Issues to research

- **MULTITENANT_BASELINE_MISSING** (high): no tenant/org/workspace signals detected
  - Research: `multitenant tenant resolver nextjs`

### Next actions

- Add tenant resolver and organization_id guardrails

---

## glitch-app (score=24)

### Incomplete sections → research targets

- **email_setup** (incomplete)
  - GitHub: [`resend email verification webhook OR maileroo`](https://github.com/search?type=repositories&q=resend%20email%20verification%20webhook%20OR%20maileroo)
  - Reddit/search: `resend maileroo email verification webhook setup`
  - Best-case ref: local/CaptureInbound, docs/EMAIL_RESEND_MIGRATION.md

- **admin_setup** (incomplete)
  - GitHub: [`multitenant organization_id nextjs OR tenant resolver`](https://github.com/search?type=repositories&q=multitenant%20organization_id%20nextjs%20OR%20tenant%20resolver)
  - Reddit/search: `multitenant nextjs tenant resolver organization_id`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **auth** (incomplete)
  - GitHub: [`better-auth`](https://github.com/search?type=repositories&q=better-auth)
  - Reddit/search: `better-auth nextjs authentication`
  - Best-case ref: local/veritap_2026, config/capabilities.yaml auth.better_auth

- **stripe_checkout** (gap)
  - GitHub: [`stripe checkout session`](https://github.com/search?type=repositories&q=stripe%20checkout%20session)
  - Reddit/search: `stripe checkout session nextjs`
  - Best-case ref: local/autopay_ui, local/CaptureInbound, local/payclaw (feature-benchmark exemplars)

- **stripe_webhooks** (gap)
  - GitHub: [`stripe webhook signature verification idempotency`](https://github.com/search?type=repositories&q=stripe%20webhook%20signature%20verification%20idempotency)
  - Reddit/search: `stripe webhook signature verification idempotency`
  - Best-case ref: local/autopay_ui, local/CaptureInbound, local/payclaw (feature-benchmark exemplars)

- **telnyx_sms** (incomplete)
  - GitHub: [`telnyx sms webhook`](https://github.com/search?type=repositories&q=telnyx%20sms%20webhook)
  - Reddit/search: `telnyx sms webhook verification`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **webhooks_signature_verify** (incomplete)
  - GitHub: [`webhook signature verification`](https://github.com/search?type=repositories&q=webhook%20signature%20verification)
  - Reddit/search: `webhook signature verification best practices`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **queue_retry** (incomplete)
  - GitHub: [`bullmq retry queue worker`](https://github.com/search?type=repositories&q=bullmq%20retry%20queue%20worker)
  - Reddit/search: `bullmq retry queue worker node`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **observability** (incomplete)
  - GitHub: [`observability logging metrics audit`](https://github.com/search?type=repositories&q=observability%20logging%20metrics%20audit)
  - Reddit/search: `observability logging metrics node express`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **e2e** (incomplete)
  - GitHub: [`playwright e2e test OR cypress`](https://github.com/search?type=repositories&q=playwright%20e2e%20test%20OR%20cypress)
  - Reddit/search: `playwright cypress e2e testing`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **security_sweep** (incomplete)
  - GitHub: [`security audit dependency`](https://github.com/search?type=repositories&q=security%20audit%20dependency)
  - Reddit/search: `npm audit security dependency`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **capability_factory_health** (gap)
  - GitHub: [`stripe webhook auth capability`](https://github.com/search?type=repositories&q=stripe%20webhook%20auth%20capability)
  - Reddit/search: `stripe webhook auth capability patterns`
  - Best-case ref: config/capabilities.yaml, scripts/capability-factory.js pickCanonicalCandidates

### Issues to research

- **MULTITENANT_BASELINE_MISSING** (high): no tenant/org/workspace signals detected
  - Research: `multitenant tenant resolver nextjs`

### Next actions

- Add tenant resolver and organization_id guardrails

---

## LeadGenAi (score=24)

### Incomplete sections → research targets

- **email_setup** (incomplete)
  - GitHub: [`resend email verification webhook OR maileroo`](https://github.com/search?type=repositories&q=resend%20email%20verification%20webhook%20OR%20maileroo)
  - Reddit/search: `resend maileroo email verification webhook setup`
  - Best-case ref: local/CaptureInbound, docs/EMAIL_RESEND_MIGRATION.md

- **admin_setup** (incomplete)
  - GitHub: [`multitenant organization_id nextjs OR tenant resolver`](https://github.com/search?type=repositories&q=multitenant%20organization_id%20nextjs%20OR%20tenant%20resolver)
  - Reddit/search: `multitenant nextjs tenant resolver organization_id`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **auth** (incomplete)
  - GitHub: [`better-auth`](https://github.com/search?type=repositories&q=better-auth)
  - Reddit/search: `better-auth nextjs authentication`
  - Best-case ref: local/veritap_2026, config/capabilities.yaml auth.better_auth

- **stripe_checkout** (gap)
  - GitHub: [`stripe checkout session`](https://github.com/search?type=repositories&q=stripe%20checkout%20session)
  - Reddit/search: `stripe checkout session nextjs`
  - Best-case ref: local/autopay_ui, local/CaptureInbound, local/payclaw (feature-benchmark exemplars)

- **stripe_webhooks** (gap)
  - GitHub: [`stripe webhook signature verification idempotency`](https://github.com/search?type=repositories&q=stripe%20webhook%20signature%20verification%20idempotency)
  - Reddit/search: `stripe webhook signature verification idempotency`
  - Best-case ref: local/autopay_ui, local/CaptureInbound, local/payclaw (feature-benchmark exemplars)

- **telnyx_sms** (incomplete)
  - GitHub: [`telnyx sms webhook`](https://github.com/search?type=repositories&q=telnyx%20sms%20webhook)
  - Reddit/search: `telnyx sms webhook verification`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **webhooks_signature_verify** (incomplete)
  - GitHub: [`webhook signature verification`](https://github.com/search?type=repositories&q=webhook%20signature%20verification)
  - Reddit/search: `webhook signature verification best practices`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **queue_retry** (incomplete)
  - GitHub: [`bullmq retry queue worker`](https://github.com/search?type=repositories&q=bullmq%20retry%20queue%20worker)
  - Reddit/search: `bullmq retry queue worker node`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **observability** (incomplete)
  - GitHub: [`observability logging metrics audit`](https://github.com/search?type=repositories&q=observability%20logging%20metrics%20audit)
  - Reddit/search: `observability logging metrics node express`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **e2e** (incomplete)
  - GitHub: [`playwright e2e test OR cypress`](https://github.com/search?type=repositories&q=playwright%20e2e%20test%20OR%20cypress)
  - Reddit/search: `playwright cypress e2e testing`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **security_sweep** (incomplete)
  - GitHub: [`security audit dependency`](https://github.com/search?type=repositories&q=security%20audit%20dependency)
  - Reddit/search: `npm audit security dependency`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **capability_factory_health** (gap)
  - GitHub: [`stripe webhook auth capability`](https://github.com/search?type=repositories&q=stripe%20webhook%20auth%20capability)
  - Reddit/search: `stripe webhook auth capability patterns`
  - Best-case ref: config/capabilities.yaml, scripts/capability-factory.js pickCanonicalCandidates

### Issues to research

- **MULTITENANT_BASELINE_MISSING** (high): no tenant/org/workspace signals detected
  - Research: `multitenant tenant resolver nextjs`

### Next actions

- Add tenant resolver and organization_id guardrails

---

## v0-morningops (score=66)

### Incomplete sections → research targets

- **telnyx_sms** (incomplete)
  - GitHub: [`telnyx sms webhook`](https://github.com/search?type=repositories&q=telnyx%20sms%20webhook)
  - Reddit/search: `telnyx sms webhook verification`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **queue_retry** (incomplete)
  - GitHub: [`bullmq retry queue worker`](https://github.com/search?type=repositories&q=bullmq%20retry%20queue%20worker)
  - Reddit/search: `bullmq retry queue worker node`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **observability** (incomplete)
  - GitHub: [`observability logging metrics audit`](https://github.com/search?type=repositories&q=observability%20logging%20metrics%20audit)
  - Reddit/search: `observability logging metrics node express`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **security_sweep** (incomplete)
  - GitHub: [`security audit dependency`](https://github.com/search?type=repositories&q=security%20audit%20dependency)
  - Reddit/search: `npm audit security dependency`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

### Issues to research

- **FORBIDDEN_PATTERN** (medium): fake in 2 file(s)
  - Research: `remove placeholder example.com fake patterns`

### Next actions

- Remove placeholder/fake patterns

---

## reframed (score=18)

### Incomplete sections → research targets

- **email_setup** (incomplete)
  - GitHub: [`resend email verification webhook OR maileroo`](https://github.com/search?type=repositories&q=resend%20email%20verification%20webhook%20OR%20maileroo)
  - Reddit/search: `resend maileroo email verification webhook setup`
  - Best-case ref: local/CaptureInbound, docs/EMAIL_RESEND_MIGRATION.md

- **admin_setup** (incomplete)
  - GitHub: [`multitenant organization_id nextjs OR tenant resolver`](https://github.com/search?type=repositories&q=multitenant%20organization_id%20nextjs%20OR%20tenant%20resolver)
  - Reddit/search: `multitenant nextjs tenant resolver organization_id`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **auth** (incomplete)
  - GitHub: [`better-auth`](https://github.com/search?type=repositories&q=better-auth)
  - Reddit/search: `better-auth nextjs authentication`
  - Best-case ref: local/veritap_2026, config/capabilities.yaml auth.better_auth

- **stripe_checkout** (gap)
  - GitHub: [`stripe checkout session`](https://github.com/search?type=repositories&q=stripe%20checkout%20session)
  - Reddit/search: `stripe checkout session nextjs`
  - Best-case ref: local/autopay_ui, local/CaptureInbound, local/payclaw (feature-benchmark exemplars)

- **stripe_webhooks** (gap)
  - GitHub: [`stripe webhook signature verification idempotency`](https://github.com/search?type=repositories&q=stripe%20webhook%20signature%20verification%20idempotency)
  - Reddit/search: `stripe webhook signature verification idempotency`
  - Best-case ref: local/autopay_ui, local/CaptureInbound, local/payclaw (feature-benchmark exemplars)

- **telnyx_sms** (incomplete)
  - GitHub: [`telnyx sms webhook`](https://github.com/search?type=repositories&q=telnyx%20sms%20webhook)
  - Reddit/search: `telnyx sms webhook verification`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **webhooks_signature_verify** (incomplete)
  - GitHub: [`webhook signature verification`](https://github.com/search?type=repositories&q=webhook%20signature%20verification)
  - Reddit/search: `webhook signature verification best practices`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **queue_retry** (incomplete)
  - GitHub: [`bullmq retry queue worker`](https://github.com/search?type=repositories&q=bullmq%20retry%20queue%20worker)
  - Reddit/search: `bullmq retry queue worker node`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **observability** (incomplete)
  - GitHub: [`observability logging metrics audit`](https://github.com/search?type=repositories&q=observability%20logging%20metrics%20audit)
  - Reddit/search: `observability logging metrics node express`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **e2e** (incomplete)
  - GitHub: [`playwright e2e test OR cypress`](https://github.com/search?type=repositories&q=playwright%20e2e%20test%20OR%20cypress)
  - Reddit/search: `playwright cypress e2e testing`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **security_sweep** (incomplete)
  - GitHub: [`security audit dependency`](https://github.com/search?type=repositories&q=security%20audit%20dependency)
  - Reddit/search: `npm audit security dependency`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **capability_factory_health** (gap)
  - GitHub: [`stripe webhook auth capability`](https://github.com/search?type=repositories&q=stripe%20webhook%20auth%20capability)
  - Reddit/search: `stripe webhook auth capability patterns`
  - Best-case ref: config/capabilities.yaml, scripts/capability-factory.js pickCanonicalCandidates

- **feature_benchmark_vs_exemplar** (incomplete)
  - GitHub: [`feature benchmark exemplar`](https://github.com/search?type=repositories&q=feature%20benchmark%20exemplar)
  - Reddit/search: `feature benchmark exemplar`
  - Best-case ref: scripts/feature-benchmark-score.js EXEMPLAR_LIBRARY, data/exemplar-repos.json

### Issues to research

- **MULTITENANT_BASELINE_MISSING** (high): no tenant/org/workspace signals detected
  - Research: `multitenant tenant resolver nextjs`

### Next actions

- Add tenant resolver and organization_id guardrails

---

## oss-index (score=40)

### Incomplete sections → research targets

- **admin_setup** (incomplete)
  - GitHub: [`multitenant organization_id nextjs OR tenant resolver`](https://github.com/search?type=repositories&q=multitenant%20organization_id%20nextjs%20OR%20tenant%20resolver)
  - Reddit/search: `multitenant nextjs tenant resolver organization_id`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **stripe_checkout** (gap)
  - GitHub: [`stripe checkout session`](https://github.com/search?type=repositories&q=stripe%20checkout%20session)
  - Reddit/search: `stripe checkout session nextjs`
  - Best-case ref: local/autopay_ui, local/CaptureInbound, local/payclaw (feature-benchmark exemplars)

- **telnyx_sms** (incomplete)
  - GitHub: [`telnyx sms webhook`](https://github.com/search?type=repositories&q=telnyx%20sms%20webhook)
  - Reddit/search: `telnyx sms webhook verification`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **capability_factory_health** (gap)
  - GitHub: [`stripe webhook auth capability`](https://github.com/search?type=repositories&q=stripe%20webhook%20auth%20capability)
  - Reddit/search: `stripe webhook auth capability patterns`
  - Best-case ref: config/capabilities.yaml, scripts/capability-factory.js pickCanonicalCandidates

### Issues to research

- **AUTH_NOT_STANDARDIZED** (critical): legacy auth detected without better-auth baseline
  - Research: `better-auth migration from next-auth`

- **MULTITENANT_BASELINE_MISSING** (high): no tenant/org/workspace signals detected
  - Research: `multitenant tenant resolver nextjs`

- **FORBIDDEN_PATTERN** (medium): TODO: in 10 file(s)
  - Research: `remove placeholder example.com fake patterns`

- **FORBIDDEN_PATTERN** (medium): fake in 10 file(s)
  - Research: `remove placeholder example.com fake patterns`

- **FORBIDDEN_PATTERN** (medium): example.com in 10 file(s)
  - Research: `remove placeholder example.com fake patterns`

### Next actions

- Migrate auth to better-auth; remove legacy auth
- Add tenant resolver and organization_id guardrails
- Remove placeholder/fake patterns

---

## oss-saas-bench (score=60)

### Incomplete sections → research targets

- **auth** (incomplete)
  - GitHub: [`better-auth`](https://github.com/search?type=repositories&q=better-auth)
  - Reddit/search: `better-auth nextjs authentication`
  - Best-case ref: local/veritap_2026, config/capabilities.yaml auth.better_auth

- **telnyx_sms** (incomplete)
  - GitHub: [`telnyx sms webhook`](https://github.com/search?type=repositories&q=telnyx%20sms%20webhook)
  - Reddit/search: `telnyx sms webhook verification`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **queue_retry** (incomplete)
  - GitHub: [`bullmq retry queue worker`](https://github.com/search?type=repositories&q=bullmq%20retry%20queue%20worker)
  - Reddit/search: `bullmq retry queue worker node`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **observability** (incomplete)
  - GitHub: [`observability logging metrics audit`](https://github.com/search?type=repositories&q=observability%20logging%20metrics%20audit)
  - Reddit/search: `observability logging metrics node express`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **e2e** (incomplete)
  - GitHub: [`playwright e2e test OR cypress`](https://github.com/search?type=repositories&q=playwright%20e2e%20test%20OR%20cypress)
  - Reddit/search: `playwright cypress e2e testing`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **security_sweep** (incomplete)
  - GitHub: [`security audit dependency`](https://github.com/search?type=repositories&q=security%20audit%20dependency)
  - Reddit/search: `npm audit security dependency`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **capability_factory_health** (incomplete)
  - GitHub: [`stripe webhook auth capability`](https://github.com/search?type=repositories&q=stripe%20webhook%20auth%20capability)
  - Reddit/search: `stripe webhook auth capability patterns`
  - Best-case ref: config/capabilities.yaml, scripts/capability-factory.js pickCanonicalCandidates

### Issues to research

- **FORBIDDEN_PATTERN** (medium): TODO: in 10 file(s)
  - Research: `remove placeholder example.com fake patterns`

- **FORBIDDEN_PATTERN** (medium): fake in 2 file(s)
  - Research: `remove placeholder example.com fake patterns`

- **FORBIDDEN_PATTERN** (medium): example.com in 10 file(s)
  - Research: `remove placeholder example.com fake patterns`

### Next actions

- Remove placeholder/fake patterns

---

## usipeorg (score=18)

### Incomplete sections → research targets

- **email_setup** (incomplete)
  - GitHub: [`resend email verification webhook OR maileroo`](https://github.com/search?type=repositories&q=resend%20email%20verification%20webhook%20OR%20maileroo)
  - Reddit/search: `resend maileroo email verification webhook setup`
  - Best-case ref: local/CaptureInbound, docs/EMAIL_RESEND_MIGRATION.md

- **admin_setup** (incomplete)
  - GitHub: [`multitenant organization_id nextjs OR tenant resolver`](https://github.com/search?type=repositories&q=multitenant%20organization_id%20nextjs%20OR%20tenant%20resolver)
  - Reddit/search: `multitenant nextjs tenant resolver organization_id`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **auth** (incomplete)
  - GitHub: [`better-auth`](https://github.com/search?type=repositories&q=better-auth)
  - Reddit/search: `better-auth nextjs authentication`
  - Best-case ref: local/veritap_2026, config/capabilities.yaml auth.better_auth

- **stripe_checkout** (gap)
  - GitHub: [`stripe checkout session`](https://github.com/search?type=repositories&q=stripe%20checkout%20session)
  - Reddit/search: `stripe checkout session nextjs`
  - Best-case ref: local/autopay_ui, local/CaptureInbound, local/payclaw (feature-benchmark exemplars)

- **stripe_webhooks** (gap)
  - GitHub: [`stripe webhook signature verification idempotency`](https://github.com/search?type=repositories&q=stripe%20webhook%20signature%20verification%20idempotency)
  - Reddit/search: `stripe webhook signature verification idempotency`
  - Best-case ref: local/autopay_ui, local/CaptureInbound, local/payclaw (feature-benchmark exemplars)

- **telnyx_sms** (incomplete)
  - GitHub: [`telnyx sms webhook`](https://github.com/search?type=repositories&q=telnyx%20sms%20webhook)
  - Reddit/search: `telnyx sms webhook verification`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **webhooks_signature_verify** (incomplete)
  - GitHub: [`webhook signature verification`](https://github.com/search?type=repositories&q=webhook%20signature%20verification)
  - Reddit/search: `webhook signature verification best practices`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **queue_retry** (incomplete)
  - GitHub: [`bullmq retry queue worker`](https://github.com/search?type=repositories&q=bullmq%20retry%20queue%20worker)
  - Reddit/search: `bullmq retry queue worker node`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **observability** (incomplete)
  - GitHub: [`observability logging metrics audit`](https://github.com/search?type=repositories&q=observability%20logging%20metrics%20audit)
  - Reddit/search: `observability logging metrics node express`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **e2e** (incomplete)
  - GitHub: [`playwright e2e test OR cypress`](https://github.com/search?type=repositories&q=playwright%20e2e%20test%20OR%20cypress)
  - Reddit/search: `playwright cypress e2e testing`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **security_sweep** (incomplete)
  - GitHub: [`security audit dependency`](https://github.com/search?type=repositories&q=security%20audit%20dependency)
  - Reddit/search: `npm audit security dependency`
  - Best-case ref: oss-dashboard-benchmark top repos, dashboard-chatbot-repo-scout ui_signals

- **capability_factory_health** (gap)
  - GitHub: [`stripe webhook auth capability`](https://github.com/search?type=repositories&q=stripe%20webhook%20auth%20capability)
  - Reddit/search: `stripe webhook auth capability patterns`
  - Best-case ref: config/capabilities.yaml, scripts/capability-factory.js pickCanonicalCandidates

### Issues to research

- **MULTITENANT_BASELINE_MISSING** (high): no tenant/org/workspace signals detected
  - Research: `multitenant tenant resolver nextjs`

### Next actions

- Add tenant resolver and organization_id guardrails

---

## claw-architect (score=97)

### Incomplete sections → research targets

### Issues to research

- **FORBIDDEN_PATTERN** (medium): mockTranslate( in 10 file(s)
  - Research: `remove placeholder example.com fake patterns`

- **FORBIDDEN_PATTERN** (medium): TODO: in 10 file(s)
  - Research: `remove placeholder example.com fake patterns`

- **FORBIDDEN_PATTERN** (medium): fake in 10 file(s)
  - Research: `remove placeholder example.com fake patterns`

- **FORBIDDEN_PATTERN** (medium): example.com in 10 file(s)
  - Research: `remove placeholder example.com fake patterns`

### Next actions

- Remove placeholder/fake patterns

---

## How the builder uses this

1. **Gap pulse:** `npm run builder:gap:pulse -- --repos <name>` runs gap analysis and queues repo_autofix + opencode_controller with gap context (benchmark_lookup, issues, quality_gate_scripts).
2. **Research agenda:** This file and `builder-research-agenda-latest.json` list per-repo GitHub search URLs and Reddit/search suggestions for each incomplete section and issue.
3. **Benchmark lookup:** `npm run repo:benchmark:lookup -- --repo <name>` or `--rolling` produces `repo-completion-benchmark-lookup-latest.md` with the same GitHub links.
4. **Quality gates:** Before considering a build complete, run and pass the repo's check/build, lint, test, test:e2e (when defined). repo_autofix runs these; see docs/BUILDER-PROFESSIONAL-COMPLETION.md.
5. **InayanBuilderBot:** Can consume this JSON or the benchmark lookup report to drive Reddit/GitHub research stages and filter candidates by section_id.
