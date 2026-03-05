# Pinterest Caption Conversion Playbook (Media Hub)

This playbook drives the Media Hub caption engine and bulk queue behavior.

## Hard limits (official)

- Title: max 100 characters.
- Description: up to 800 characters in platform specs.
- Alt text: up to 500 characters.
- For feed visibility, prioritize the first ~40 characters of title copy.

References:
- [Review Pin specs (Pinterest Help)](https://help.pinterest.com/en/article/review-pin-specs)
- [Review ad specs / product specs (Pinterest Business Help)](https://help.pinterest.com/en/business/article/pinterest-product-specs)
- [Collections ads specs (Pinterest Business Help)](https://help.pinterest.com/en/business/article/collections-ads-on-pinterest)
- [Add alternative text to your Pins (Pinterest Business Help)](https://help.pinterest.com/en/business/article/add-alternative-text-to-your-pins-archived)

## Conversion-focused caption pattern

1. Lead with product + intent in first line.
2. Include one tangible benefit from visual summary or product context.
3. Add clear CTA (shop/discover/learn more/save).
4. Include destination URL for traffic-focused campaigns.
5. Use concise, relevant hashtags (avoid stuffing).
6. Keep claims grounded to provided asset metadata.

## Current Media Hub defaults

- Caption generator clamps title to 100 chars and description to 500 chars by default for safety.
- Alt descriptions are clipped to concise accessibility text.
- Quality scoring penalizes:
  - missing/weak CTA
  - overly short copy
  - overlong title/description
  - hashtag underuse/overuse
- Auto-queue skips duplicates by `file_index_id + pinterest_account + board_name` when an active queue entry already exists.

## Set-and-forget workflow

1. Keep image review status up to date (`approved` for publish-ready assets).
2. Run dry-run queue automation first:
   - `npm run media:hub:autopilot`
3. Run apply mode after validating output:
   - `npm run media:hub:autopilot:apply`
4. Optionally schedule it via PM2/cron for daily board-ready queue filling.

