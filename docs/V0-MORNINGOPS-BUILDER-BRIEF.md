# v0-morningops — Builder brief (Inayan)

**Repo:** `v0-morningops` (Next.js, Prisma, better-auth, Gmail + Calendar today)

**Current state:** Stripped-down email management app built to test if the concept works. Gmail-only (OAuth + Gmail API). Has a landing page (hero, features, pricing section), dashboard with daily brief and contacts, but **no real marketing flow** and **no Stripe payment** in use — billing is off by default (`BILLING_REQUIRED` env). Leave off the paywall; add features and improve with the Inayan builder.

---

## Direction: add features, no paywall

- **Do not add a paywall.** Keep `BILLING_REQUIRED` default false; ensure full product access without Stripe.
- **Add features** people look for in email management apps (see below).
- **Support any email**, not just Gmail: IMAP, Outlook/Office 365, Apple iCloud, Yahoo, etc., so users can connect work/personal/side accounts.

---

## Features people want (email management)

Use this as a **prioritized backlog** for the builder. Fill in all gaps (env, error handling, tests, security, observability) as you go.

1. **Multiple email providers (not just Gmail)**  
   - Add IMAP and/or Microsoft Graph (Outlook/Office 365), and optionally Apple/Yahoo.  
   - Per-account connect/disconnect; unified brief that merges from all connected accounts.

2. **Multiple accounts / unified inbox**  
   - One user can connect several mailboxes (work, personal, side).  
   - Per-account labels or filters; optional “focus account” for the brief.

3. **Scheduling & time management**  
   - Snooze (hide from brief until a time).  
   - Send-later / follow-up reminders (if sending is ever added, keep read-only first).  
   - Morning digest time (already have `briefTime` — respect it and timezone).

4. **Inbox triage & prioritization**  
   - AI triage (action / follow-up / FYI / newsletter) — extend current brief engine.  
   - Inbox-zero helpers: bulk mark done, archive, or “noise” so the brief stays focused.

5. **Better landing/marketing (no payment)**  
   - Clear value prop, social proof, use cases.  
   - No Stripe checkout; CTA = “Connect your email” or “Start free”.  
   - Optional: pricing page that says “Free during beta” or “No credit card required.”

6. **Privacy & security**  
   - Read-only by default; no sending on behalf unless user explicitly opts in.  
   - Data export and account deletion (GDPR-style).  
   - Short privacy/security section on landing or in app.

7. **Observability & ops**  
   - Logging, health endpoint, and basic metrics so the app is operable in production.

---

## Technical notes (current stack)

- **Auth:** better-auth, Prisma; Google OAuth for Gmail.  
- **DB:** PostgreSQL (Prisma); `User` has `googleAccessToken`, `googleRefreshToken`; add fields or tables for other providers.  
- **Email fetch:** `lib/google.ts` — Gmail API. New providers = new modules (e.g. `lib/imap.ts`, `lib/microsoft-graph.ts`) and a small provider abstraction so the brief engine can pull from any connected account.  
- **Brief:** `lib/brief-engine.ts`; daily brief stored in `Brief`.  
- **Access:** `lib/access.ts` — `hasAccess(stripeStatus, email)`; when `BILLING_REQUIRED` is false, everyone has access. Keep it that way.

---

## Inayan builder instructions

- **Context:** People describe only a small portion of what’s needed. Your job is to **fill in all the gaps** (env, errors, tests, security, observability), not just the obvious feature.  
- **Scope:** Implement multiple-email support and the features above in order; improve landing and DX as you go.  
- **No paywall:** Do not require Stripe or payment for core use.  
- **Reference:** This doc and `docs/BUILDER-PROFESSIONAL-COMPLETION.md`; run `repo-completion-gap-one` and quality gates before considering the repo done.
