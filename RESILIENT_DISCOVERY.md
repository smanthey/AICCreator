# Resilient Bot Discovery: Fallback Methods

## Overview

**If APIs don't work, the system finds alternative ways to get the same information.**

The discovery system is designed to be resilient - if primary APIs fail, it automatically falls back to alternative methods to find the same information.

## Fallback Strategy

### Primary → Fallback Chain

For each discovery method:
1. **Try API first** (fastest, most accurate)
2. **If API fails** → Use web scraping
3. **If scraping fails** → Use alternative data sources
4. **If all fail** → Log error, continue with other methods

## Platform-Specific Fallbacks

### 1. Moltbook Discovery

**Primary:** Moltbook API
- Fast, accurate, official data
- Requires `MOLTBOOK_API_KEY`

**Fallback 1:** Web Scraping
- Scrape `moltbook.com` for bot listings
- Parse HTML for bot profiles
- Extract reputation, karma, verification

**Fallback 2:** GitHub Search
- Search for repos mentioning "moltbook"
- Find bots that integrate with Moltbook
- Extract bot information from code

**Fallback 3:** Reddit Search
- Search r/moltbook or related subreddits
- Find bot discussions and mentions
- Extract bot usernames and profiles

### 2. GitHub Discovery

**Primary:** GitHub API
- Official API, structured data
- Requires `GITHUB_TOKEN`

**Fallback:** Web Scraping
- Scrape `github.com/search` for repos
- Parse search results HTML
- Extract repo owner, description, stars
- Find bots in commit history, issues

### 3. Twitter Discovery

**Primary:** Twitter API v2
- Official API, real-time data
- Requires `TWITTER_BEARER_TOKEN`

**Fallback:** Web Scraping
- Scrape `twitter.com/search` for hashtags
- Parse tweet HTML
- Extract usernames, mentions
- Find bot accounts and discussions

### 4. Reddit Discovery

**Primary:** Reddit OAuth API
- Official API, structured data
- Requires `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET`

**Fallback:** Web Scraping
- Scrape subreddit pages directly
- Parse post HTML
- Extract usernames, post content
- Find bot mentions and discussions

### 5. Discord Discovery

**Primary:** Discord.js API
- Official API, real-time data
- Requires `DISCORD_BOT_TOKEN`

**Fallback:** Web Scraping
- Scrape Discord bot listing sites (top.gg, discord.bots.gg)
- Parse bot profile pages
- Extract bot IDs, usernames, descriptions

## Implementation Pattern

### Standard Fallback Pattern

```javascript
async function discoverPlatformBots() {
  let discovered = 0;
  let usedFallback = false;

  // Try API first
  if (API_KEY) {
    try {
      discovered = await discoverViaAPI();
    } catch (err) {
      console.warn("API failed, using fallback:", err.message);
      usedFallback = true;
    }
  } else {
    usedFallback = true;
  }

  // Fallback methods
  if (usedFallback || discovered === 0) {
    const fallbackCount = await discoverViaFallback();
    discovered += fallbackCount;
  }

  return discovered;
}
```

## Fallback Methods

### Web Scraping

**Tools:**
- Playwright (headless browser)
- Cheerio (HTML parsing)
- Puppeteer (alternative)

**Example:**
```javascript
async function scrapeMoltbookWebsite() {
  const browser = await playwright.chromium.launch();
  const page = await browser.newPage();
  
  await page.goto("https://moltbook.com/agents");
  const bots = await page.evaluate(() => {
    // Extract bot data from page
    return Array.from(document.querySelectorAll(".agent-card")).map(card => ({
      name: card.querySelector(".name").textContent,
      karma: parseInt(card.querySelector(".karma").textContent),
      // ... extract other data
    }));
  });
  
  await browser.close();
  return bots;
}
```

### Alternative Data Sources

**GitHub:**
- Search repos, issues, discussions
- Parse README files
- Extract bot information

**Reddit:**
- Search subreddits
- Parse post content
- Extract bot mentions

**Twitter:**
- Search hashtags
- Parse tweet content
- Extract bot accounts

## Error Handling

### Graceful Degradation

```javascript
try {
  // Try primary method
  return await primaryMethod();
} catch (err) {
  console.warn("Primary method failed, trying fallback:", err.message);
  
  try {
    // Try fallback 1
    return await fallback1();
  } catch (err2) {
    console.warn("Fallback 1 failed, trying fallback 2:", err2.message);
    
    try {
      // Try fallback 2
      return await fallback2();
    } catch (err3) {
      console.error("All methods failed:", err3.message);
      return 0; // Continue with other platforms
    }
  }
}
```

## Configuration

### Enable/Disable Fallbacks

```bash
# Enable fallback methods (default: true)
ENABLE_FALLBACK_DISCOVERY=true

# Disable fallback (use API only)
ENABLE_FALLBACK_DISCOVERY=false
```

### Fallback Timeouts

```bash
# Timeout for API calls (default: 10s)
API_TIMEOUT_MS=10000

# Timeout for web scraping (default: 30s)
SCRAPE_TIMEOUT_MS=30000
```

## Best Practices

### 1. Always Have Fallbacks

- Never rely on single API
- Always implement fallback methods
- Test fallbacks regularly

### 2. Rate Limiting

- Respect rate limits for APIs
- Use delays for web scraping
- Cache results when possible

### 3. Error Recovery

- Log all failures
- Continue with other platforms
- Retry failed methods later

### 4. Data Quality

- Validate scraped data
- Cross-reference multiple sources
- Prefer API data when available

## Current Status

### ✅ Implemented Fallbacks

- **Moltbook**: API → Web scraping → GitHub → Reddit
- **GitHub**: API → Web scraping
- **Twitter**: API → Web scraping

### 🚧 Planned Fallbacks

- **Reddit**: API → Web scraping
- **Discord**: API → Bot listing sites
- **Email**: API → Website scraping

## Usage

### Automatic Fallback

```bash
# Discovery automatically uses fallbacks if APIs fail
npm run discover:bots
```

### Manual Fallback Testing

```bash
# Test fallback methods directly
node scripts/moltbook-discovery.js discover --fallback-only
```

## Summary

**Resilient Discovery = Multiple Data Sources**

- ✅ Primary API (fastest)
- ✅ Web scraping (when API fails)
- ✅ Alternative sources (GitHub, Reddit, etc.)
- ✅ Graceful degradation
- ✅ Always finds information

**The system never gives up - it finds alternative ways to get the same information.** 🔄
