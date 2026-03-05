# OpenClaw Paid Workshop Plan (90 minutes)

## Goal

Launch a paid, repeatable beginner workshop with a concrete outcome:

> **“By the end of 90 minutes, you will have your first OpenClaw agent running on a VPS with Telegram access and optional local Ollama model fallback.”**

---

## Topic selection: most searched + easiest to teach

### Selection method used

I prioritized topics that appear across official docs “quick start” paths and beginner setup pages, then ranked by:

1. Beginner demand signal (appears in onboarding/get-started paths)
2. Fast time-to-value in one session
3. Low setup risk for live teaching

### Ranked shortlist

1. **Onboarding Wizard + First Agent**
   - Why: official onboarding path, quickest “first success”
   - Docs: `openclaw onboard`, dashboard first chat
2. **Telegram Bot Integration**
   - Why: very clear before/after demo, easy to validate in class
3. **VPS Docker Deployment (Hetzner-style)**
   - Why: strong practical demand (“keep it running 24/7”)
4. **Ollama Local Provider Setup**
   - Why: high interest in local/private AI workflows
5. **Install a Skill from ClawHub**
   - Why: instant extensibility and good upsell path

### Recommended first paid workshop topic

Use #3 + #2 + #4:

> **“OpenClaw 24/7 Bootcamp: VPS deploy + Telegram control + local Ollama fallback”**

It balances demand and teachability and creates a clear transformation.

---

## 90-minute live curriculum (hands-on)

## 0:00-0:10 — Orientation + outcome contract
- What they will have by minute 90
- Architecture diagram (Gateway, agent, channel, model provider)
- Prereq checklist (VPS login, BotFather token, local machine terminal)

## 0:10-0:30 — OpenClaw install + first agent
- Run onboarding wizard
- Verify local dashboard chat
- Explain where state/config lives

**Exercise 1:** each attendee sends first message in local dashboard

## 0:30-0:50 — Deploy to VPS (Docker path)
- Provision VPS
- Deploy gateway container with persisted volumes
- Basic health check and restart behavior

**Exercise 2:** attendees connect to their VPS instance and confirm gateway responds

## 0:50-1:05 — Telegram integration
- Create bot in BotFather
- Add token to config
- Start gateway and approve pairing

**Exercise 3:** send command from Telegram and receive response

## 1:05-1:20 — Ollama fallback (local/private mode)
- Pull a lightweight model
- Configure OpenClaw provider route to Ollama
- Test fallback prompt

**Exercise 4:** trigger one prompt against Ollama model

## 1:20-1:30 — Troubleshooting + graduation
- Common errors and fixes checklist
- Completion checklist
- Next workshop CTA

---

## Payment setup (fastest options)

## Option A: Stripe Payment Link (fast + robust)
- Create one-time product in Stripe
- Generate a Payment Link
- Use success URL that redirects to workshop confirmation page
- Add email collection and receipt

Best when you want cleaner scaling and later automation.

## Option B: Gumroad product link (fastest no-code)
- Create a digital product (“Live workshop seat”)
- Set date/time in product description
- Use built-in checkout and test purchase flow

Best when you want minimal setup today.

---

## Simple landing page structure

Use one page with:

1. Headline outcome (one sentence)
2. Date/time + duration + timezone
3. Who it’s for / not for
4. What they’ll build in-session (checklist)
5. Instructor credibility + proof
6. Price + seat limit + CTA button (Stripe/Gumroad)
7. FAQ: recording, refunds, prerequisites

Suggested starter pricing:
- Pilot cohort: **$49–$99**
- Raise to **$149+** once replay + testimonials exist

---

## Follow-up monetization (replay + upsell)

1. **Replay product (48h after live)**
   - Sell recording + checklist + commands PDF
2. **Upsell next workshop**
   - “Production hardening + multi-agent routing”
3. **Bundle**
   - Live seat + replay + office hours

Suggested ladder:
- Workshop 1: First agent on VPS
- Workshop 2: Channels + auth + safety controls
- Workshop 3: Automation + dashboard + operations

---

## Simplest live workshop tech stack

For speed and low operational overhead:

1. **Zoom Meeting** (live delivery)
2. **Stripe Payment Link** or **Gumroad product link** (checkout)
3. **Single HTML landing page** (your existing server)
4. **Google Sheet / Notion** (roster + attendance)
5. **Loom or Zoom cloud recording** (replay asset)

That stack is enough to run paid workshops reliably without building a custom app first.

---

## Source links used

- OpenClaw Onboarding Wizard: https://docs.openclaw.ai/start/wizard
- OpenClaw Telegram: https://docs.openclaw.ai/telegram
- OpenClaw Hetzner VPS guide: https://docs.openclaw.ai/install/hetzner
- OpenClaw Ollama provider: https://docs.openclaw.ai/providers/ollama
- OpenClaw ClawHub: https://docs.openclaw.ai/tools/clawhub
- Stripe Payment Links: https://stripe.com/payments/payment-links
- Gumroad test purchase flow: https://gumroad.com/help/article/62-testing-a-purchase.html
