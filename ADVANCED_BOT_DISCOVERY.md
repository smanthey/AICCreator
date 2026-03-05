# Advanced Bot Discovery Methods

## Overview

Expanded discovery system to find bots, chatbots, and OpenClaw setups across multiple platforms beyond Discord, Telegram, WhatsApp, and Reddit.

## Discovery Methods

### 1. GitHub Discovery ✅

**What it finds:**
- Repositories mentioning OpenClaw, clawdbot, or bot commerce
- Forks of OpenClaw/claw-architect repositories
- Issues and discussions mentioning bots
- Bot operators who have OpenClaw-related code

**Setup:**
```bash
# Create GitHub token
# Go to https://github.com/settings/tokens
# Generate token with "public_repo" scope

# Add to .env
GITHUB_TOKEN=your_github_token_here
```

**Usage:**
```bash
# Discover bots on GitHub
node scripts/bot-discovery-advanced.js github

# Or enable in main discovery
ENABLE_ADVANCED_DISCOVERY=true npm run discover:bots
```

### 2. Website/Email Discovery 🚧

**What it finds:**
- Websites with chatbot widgets or bot mentions
- Contact emails from bot operator websites
- Bot-related businesses with contact forms

**Integration:**
- Uses existing `email-finder.js` to scrape websites
- Uses existing `enrich-leads-email.js` to find emails
- Filters for bot-related keywords

**Usage:**
```bash
# First, generate leads with websites
node scripts/google-maps-scraper.js  # Or your lead source

# Then find emails
node scripts/email-finder.js

# Then discover bot-related leads
node scripts/bot-discovery-advanced.js email
```

### 3. Twitter/X Discovery ✅

**What it finds:**
- Tweets with #openclaw, #clawdbot, #botcommerce hashtags
- Users discussing OpenClaw or bot commerce
- Bot operators active on Twitter

**Setup:**
```bash
# Create Twitter app
# Go to https://developer.twitter.com
# Create app and get Bearer Token

# Add to .env
TWITTER_BEARER_TOKEN=your_bearer_token_here
```

**Usage:**
```bash
node scripts/bot-discovery-advanced.js twitter
```

### 4. Bot Marketplace Discovery 🚧

**What it finds:**
- Bots listed on Discord Bot List (top.gg)
- Bots on discord.bots.gg
- Bots on botlist.space

**Status:**
- Most marketplaces don't have public APIs
- Requires manual discovery or scraping
- Placeholder for future API integration

### 5. API/Webhook Discovery 🚧

**What it finds:**
- OpenClaw instances calling your APIs
- Webhook requests from bot operators
- User-Agent strings indicating OpenClaw usage

**Integration:**
- Requires access to API logs
- Monitor for OpenClaw user-agent patterns
- Track incoming webhook sources

## Complete Discovery Flow

### Step 1: Basic Discovery (Already Working)
```bash
# Discover on messaging platforms
npm run discover:bots
```

### Step 2: Advanced Discovery
```bash
# Enable advanced methods
ENABLE_ADVANCED_DISCOVERY=true npm run discover:bots

# Or run individually
node scripts/bot-discovery-advanced.js github
node scripts/bot-discovery-advanced.js twitter
```

### Step 3: Email Discovery
```bash
# Generate leads with websites first
node scripts/google-maps-scraper.js

# Find emails from websites
node scripts/email-finder.js

# Filter for bot-related leads
node scripts/bot-discovery-advanced.js email
```

## Outreach Methods

### Current Platforms
- ✅ **WhatsApp** - Direct messaging
- ✅ **Telegram** - Bot API messages
- ✅ **Discord** - Direct messages
- ✅ **Reddit** - Private messages
- 🚧 **Email** - Email sending (requires integration)

### Email Outreach (Future)

To enable email outreach:

1. **Integrate with email system:**
   ```javascript
   // Use existing send-email system
   const { sendEmail } = require("./send-email");
   
   await sendEmail({
     to: lead.email,
     subject: "OpenClaw Prompt Oracle",
     body: OUTREACH_MESSAGE,
   });
   ```

2. **Add to outreach script:**
   - Get leads with emails from database
   - Filter for bot-related keywords
   - Send outreach emails

## Discovery Strategy

### Multi-Channel Approach

1. **Messaging Platforms** (Discord, Telegram, WhatsApp, Reddit)
   - Direct bot-to-bot communication
   - Real-time outreach

2. **Code Repositories** (GitHub)
   - Find developers building bots
   - Discover OpenClaw forks/implementations

3. **Social Media** (Twitter/X)
   - Find discussions about bots
   - Discover bot operators

4. **Websites/Email**
   - Find bot operator businesses
   - Contact via email

5. **Bot Marketplaces**
   - Discover listed bots
   - Contact bot owners

## Configuration

### Environment Variables

```bash
# Basic discovery (already configured)
DISCORD_BOT_TOKEN=...
TELEGRAM_BOT_TOKEN=...
WHATSAPP_ACCESS_TOKEN=...
REDDIT_CLIENT_ID=...
REDDIT_CLIENT_SECRET=...

# Advanced discovery
GITHUB_TOKEN=your_github_token
TWITTER_BEARER_TOKEN=your_twitter_token
ENABLE_ADVANCED_DISCOVERY=true

# Email discovery (uses existing system)
# No additional config needed
```

## Integration with Existing Systems

### Lead Database
- All discovered bots stored in `bot_leads` table
- Unified platform: `discord`, `telegram`, `whatsapp`, `reddit`, `github`, `twitter`, `email`
- Same outreach system handles all platforms

### Email System
- Uses existing `email-finder.js` for website scraping
- Uses existing `enrich-leads-email.js` for email discovery
- Can integrate with `send-email` for outreach

## Best Practices

### 1. Rate Limiting
- GitHub: 2 second delay between searches
- Twitter: 2 second delay between searches
- Email: 500-800ms delay between requests
- Respect API rate limits

### 2. Keyword Matching
- Use configurable keywords: `BOT_DISCOVERY_KEYWORDS`
- Default: `claw,clawd,_bot,bot,ai,agent,assistant,automation`
- Customize per platform if needed

### 3. Lead Quality
- Verify leads before outreach
- Check for opt-outs
- Respect platform-specific rules

## Future Enhancements

### 1. LinkedIn Discovery
- Search for bot developers/operators
- Find AI/chatbot companies
- Contact via LinkedIn messaging

### 2. Slack Discovery
- Find Slack workspaces with bots
- Discover bot operators in Slack communities
- Contact via Slack DMs

### 3. Website Scanning
- Automated website scanning for chatbot widgets
- Detect OpenClaw implementations
- Find contact forms

### 4. API Monitoring
- Real-time webhook monitoring
- Detect OpenClaw instances
- Auto-discover active users

## Usage Examples

### Complete Discovery Run
```bash
# Basic platforms
npm run discover:bots

# Advanced methods
ENABLE_ADVANCED_DISCOVERY=true npm run discover:bots

# Individual methods
node scripts/bot-discovery-advanced.js github
node scripts/bot-discovery-advanced.js twitter
```

### Outreach to All Platforms
```bash
# Contact all discovered leads
npm run outreach:bots
```

## Summary

**Available Now:**
- ✅ GitHub discovery (repos, issues, forks)
- ✅ Twitter discovery (hashtags, mentions)
- 🚧 Email discovery (requires lead generation first)
- 🚧 Website scanning (placeholder)

**Integration Points:**
- Uses existing `bot-lead-discovery.js` for storage
- Uses existing `bot-outreach.js` for messaging
- Uses existing `email-finder.js` for email discovery

**Next Steps:**
1. Set up GitHub and Twitter tokens
2. Run advanced discovery
3. Integrate email outreach
4. Add website scanning

---

**Advanced discovery methods are ready!** Expand your bot discovery across GitHub, Twitter, email, and more. 🚀
