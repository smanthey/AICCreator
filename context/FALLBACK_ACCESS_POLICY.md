# Fallback Access Policy (API-First, Safe Browser Fallback)

This repo now enforces API/HTTP-first access through the shared toolkit:

- `$HOME/claw-architect/scripts/agent-toolkit.js`

## Order of operations

1. `fetch` (native HTTP)
2. `curl` fallback
3. Playwright browser fallback (read/extract only)

## Guardrails (browser fallback)

- Read/extract only
- Non-GET/HEAD browser requests are blocked by default
- No form submit/purchase/delete flows

## Evidence capture

Fallback attempts write artifacts under:

- `~/notes/sources/<service>/<YYYY-MM-DD>/...`

Each artifact includes:

- URL + final URL
- timestamp
- method (`fetch`/`curl`/`playwright`)
- attempts trail
- copied data preview
- optional screenshot path

## Usage examples

```js
const { fetchWithFallback, callApiWithFallback } = require("./scripts/agent-toolkit");

// API-first with auto fallback + source artifacts on fallback
const res = await fetchWithFallback("https://example.com/data", {
  sourceService: "market_research",
  allowBrowser: true,
});

// Capture artifacts even on direct fetch success
const res2 = await fetchWithFallback("https://example.com/data", {
  sourceService: "market_research",
  captureSource: true,
});

// API call with explicit browser fallback URL
const apiRes = await callApiWithFallback("https://api.example.com/v1/items", {
  sourceService: "competitor_intel",
  browserFallbackUrl: "https://example.com/items",
  readOnly: true,
  captureScreenshot: false,
});
```

## Recommendation

For scraping/research scripts, always pass:

- `sourceService` for clean artifact grouping
- `browserFallbackUrl` when API endpoints are unstable
- `captureScreenshot: true` only when visual evidence is needed
