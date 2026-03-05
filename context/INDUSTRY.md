# Industry Context

> Domain knowledge injected into agents that need business context.

---

## Active Verticals

### 1. Plushtrap — Collectibles / DTC eCommerce
- **Type:** Direct-to-consumer physical product
- **Products:** Plush toys, collectibles, limited runs
- **Audience:** Collectors, fans, gift buyers
- **Content platforms:** TikTok, Instagram (visual-first)
- **Growth lever:** Viral unboxing, limited drops, community builds
- **Email:** Drip campaigns for drops, waitlists, restock alerts

### 2. Skynpatch — B2B Software/Services
- **Type:** Business-to-business
- **Audience:** SMBs and mid-market companies
- **Email templates:** `skynpatch_b2b_intro`, `skynpatch_b2b_followup`
- **Growth lever:** Cold outreach, partnerships, referrals

---

## Content Intelligence

### High-Performing Content Patterns (General DTC)
- **Hook formats:** POV, "Wait until you see...", transformation before/after
- **Optimal length:** 15–30s TikTok, 30–60s Reels
- **CTA pattern:** Soft CTA in captions, link in bio
- **Posting cadence:** 1–3x/day TikTok, 4–7x/week Reels

### Lead Generation Context
- Google Places API: use specific city/zip, not broad regions
- B2B leads: verified email required before send_email task
- Max 50 leads per batch to avoid spam triggers

---

## Competitor Intelligence Framework

When analyzing competitor content via `analyze_content`:
1. Identify dominant hook pattern (first 2s opener)
2. Map content type (tutorial / transformation / POV / testimonial / drop)
3. Extract pacing notes (cuts per 10s, music type)
4. Identify CTA placement and wording
5. Score confidence based on sample size (< 3 items = low confidence)

---

## Compliance Notes
- Email sends require verified leads (lead.email NOT NULL)
- YouTube scraping: use official API only (no unofficial scrapers)
- TikTok/Instagram: Apify actors only (rate-limited by design)
- GDPR: leads sourced from Google Places are business entities, not personal data
