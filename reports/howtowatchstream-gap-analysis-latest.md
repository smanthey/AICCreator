# HowtoWatchStream-SmartKB — Gap Analysis

**Repo:** HowtoWatchStream-SmartKB  
**Last run:** 2026-03-05 (gap re-run after fixes)  
**Capability score:** 45  
**Incomplete sections:** 9 | **Next actions:** 0 | **Issues:** 0

---

## Section status

| Section | Status | Detail |
|---------|--------|--------|
| webhooks_signature_verify | complete | score=100 |
| feature_benchmark_vs_exemplar | complete | run completed |
| admin_setup | complete | tenant signals=true |
| email_setup | incomplete | email.mailersend |
| auth | incomplete | api-key |
| stripe_checkout | gap | score=30 |
| stripe_webhooks | gap | score=55 securityCoverage=0.5 |
| telnyx_sms | incomplete | score=65 |
| queue_retry | incomplete | score=30 |
| observability | incomplete | score=65 |
| e2e | incomplete | score=30 |
| security_sweep | incomplete | security.runtime_baseline |

---

## Issues

None (MULTITENANT_BASELINE_MISSING and FORBIDDEN_PATTERN resolved.)

---

## Next actions

None. Tenant resolver and placeholder/fake pattern fixes applied.

---

## Research targets (GitHub / best-case)

- **email_setup:** [resend email verification webhook OR maileroo](https://github.com/search?type=repositories&q=resend%20email%20verification%20webhook%20OR%20maileroo) — best-case: local/email exemplar, docs/EMAIL_RESEND_MIGRATION.md  
- **admin_setup:** [multitenant organization_id nextjs OR tenant resolver](https://github.com/search?type=repositories&q=multitenant%20organization_id%20nextjs%20OR%20tenant%20resolver) — oss-dashboard-benchmark  
- **auth:** [better-auth](https://github.com/search?type=repositories&q=better-auth) — local/auth exemplar  
- **stripe_checkout:** [stripe checkout session](https://github.com/search?type=repositories&q=stripe%20checkout%20session) — local/stripe exemplar  
- **stripe_webhooks:** [stripe webhook signature verification idempotency](https://github.com/search?type=repositories&q=stripe%20webhook%20signature%20verification%20idempotency) — local/stripe exemplar  
- **telnyx_sms:** [telnyx sms webhook](https://github.com/search?type=repositories&q=telnyx%20sms%20webhook)  
- **queue_retry:** [bullmq retry queue worker](https://github.com/search?type=repositories&q=bullmq%20retry%20queue%20worker)  
- **observability:** [observability logging metrics audit](https://github.com/search?type=repositories&q=observability%20logging%20metrics%20audit)  
- **e2e:** [playwright e2e test OR cypress](https://github.com/search?type=repositories&q=playwright%20e2e%20test%20OR%20cypress)  
- **security_sweep:** [security audit dependency](https://github.com/search?type=repositories&q=security%20audit%20dependency)  
- **capability_factory_health:** [stripe webhook auth capability](https://github.com/search?type=repositories&q=stripe%20webhook%20auth%20capability) — config/capabilities.yaml, scripts/capability-factory.js  

---

## How to re-run and complete

```bash
# Full cycle (index + gap + research + queue fixes) until this repo has no gaps
npm run inayan:full-cycle -- --until-repo HowtoWatchStream-SmartKB --max-iterations 20

# Force-queue builder tasks even if duplicate_active (recommended when making SmartKB work)
npm run inayan:full-cycle -- --until-repo HowtoWatchStream-SmartKB --force-queue
npm run builder:gap:pulse -- --repos HowtoWatchStream-SmartKB --force

# Skip index, just gap + research + queue
npm run inayan:full-cycle -- --until-repo HowtoWatchStream-SmartKB --no-index --max-iterations 20

# Gap only
npm run repo:completion:gap -- --repo HowtoWatchStream-SmartKB

# Builder gap pulse (queue repo_autofix + opencode_controller when gaps exist)
npm run builder:gap:pulse -- --repos HowtoWatchStream-SmartKB

# Research agenda for this repo
npm run builder:research:agenda -- --repo HowtoWatchStream-SmartKB
```

**Workers:** Queued tasks (`repo_autofix`, `opencode_controller`) are processed by claw-architect workers. Ensure workers are running (e.g. PM2 or `npm run tasks:health`) so SmartKB gets implementation and quality-gate runs.

**Artifacts:**  
- JSON: `reports/repo-completion-gap-HowtoWatchStream-SmartKB-<timestamp>.json`  
- Rolling: `reports/repo-completion-gap-rolling.json`  
- Research: `reports/builder-research-agenda-latest.json` and `.md`
