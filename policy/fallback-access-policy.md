# Fallback Access Policy (Web as API, Safe Mode)

If direct API/CLI is unavailable, agents may use browser automation in read-only mode.

Rules:
- Allowed without extra approval:
  - Navigate, view pages, read/extract visible data, copy text.
  - Save extracted artifacts and evidence.
- Requires explicit user confirmation first:
  - Form submission
  - Purchases/checkout
  - Deletions
  - Account settings changes
  - Any action that mutates external state

Evidence requirements for browser extraction:
- `url`
- `captured_at` timestamp (ISO-8601)
- extracted data payload
- screenshots only when necessary for validation/debug

Storage location:
- `~/notes/sources/[service]/[YYYY-MM-DD]/...`

Minimum artifact structure:
- `metadata.json` with URL + timestamp + operator + method
- `extract.json` or `extract.md` with copied structured data
- optional `screenshots/` only when needed
