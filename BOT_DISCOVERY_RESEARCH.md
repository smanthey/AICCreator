# Bot Discovery Research & Methods

## Overview

Comprehensive research on methods to find and contact OpenClaw setups, bots, chatbots, and email addresses across multiple platforms.

## Discovery Channels

### ✅ Implemented

1. **Discord** - Server member scanning
2. **Telegram** - Incoming message tracking
3. **WhatsApp** - Incoming message tracking
4. **Reddit** - Subreddit post scanning (including Moltbook)
5. **GitHub** - Repository and issue search
6. **Twitter/X** - Hashtag and mention search

### 🚧 Partially Implemented

7. **Email** - Website scraping and pattern generation
8. **Websites** - Chatbot widget detection (placeholder)

### 🔮 Research Needed

9. **LinkedIn** - Bot developer/operator search
10. **Slack** - Workspace bot discovery
11. **Bot Marketplaces** - top.gg, discord.bots.gg
12. **API Monitoring** - Webhook/API log analysis
13. **Domain Registration** - WHOIS lookups
14. **Social Media** - Instagram, Facebook groups

## Detailed Methods

### 1. GitHub Discovery ✅

**Method:**
- Search GitHub API for repositories with keywords: "openclaw", "clawdbot", "bot commerce"
- Search issues and discussions mentioning OpenClaw
- Find forks of OpenClaw/claw-architect repositories
- Identify bot operators by username patterns

**API:**
- GitHub Search API: `https://api.github.com/search/repositories`
- Requires: `GITHUB_TOKEN` with `public_repo` scope

**Limitations:**
- Rate limit: 30 requests/minute (authenticated)
- Only finds public repositories
- May miss private implementations

**Setup:**
```bash
GITHUB_TOKEN=your_token_here
```

### 2. Twitter/X Discovery ✅

**Method:**
- Search for tweets with hashtags: #openclaw, #clawdbot, #botcommerce
- Find users discussing OpenClaw or bot commerce
- Identify bot operators active on Twitter

**API:**
- Twitter API v2: `https://api.twitter.com/2/tweets/search/recent`
- Requires: `TWITTER_BEARER_TOKEN`

**Limitations:**
- Rate limit: 300 requests/15 minutes
- Requires Twitter Developer account
- May miss users without hashtags

**Setup:**
```bash
TWITTER_BEARER_TOKEN=your_bearer_token_here
```

### 3. Email Discovery 🚧

**Method:**
- Use existing `email-finder.js` to scrape websites
- Generate email patterns: info@, hello@, contact@
- SMTP verification to validate emails
- Filter for bot-related businesses

**Integration:**
- Uses existing `email-finder.js` system
- Requires leads with websites in database
- Can use Hunter.io/Apollo free tiers

**Limitations:**
- Requires website URLs
- SMTP verification may be blocked
- Pattern guessing has low confidence

**Usage:**
```bash
# First generate leads
node scripts/google-maps-scraper.js

# Then find emails
node scripts/email-finder.js

# Filter for bots
node scripts/bot-discovery-advanced.js email
```

### 4. Website Scanning 🚧

**Method:**
- Scan websites for chatbot widgets
- Detect OpenClaw implementations
- Find contact forms
- Identify bot-related businesses

**Tools:**
- Playwright for website scraping
- Pattern matching for chatbot detection
- Contact form identification

**Limitations:**
- Requires website URLs
- May miss dynamic content
- Rate limiting needed

**Future:**
- Automated website scanning
- Chatbot widget detection
- OpenClaw instance detection

### 5. Bot Marketplaces 🔮

**Platforms:**
- **top.gg** - Discord bot directory
- **discord.bots.gg** - Discord bot list
- **botlist.space** - Bot marketplace
- **Discord Bot List** - Alternative directory

**Method:**
- Most don't have public APIs
- Would require web scraping
- Manual discovery possible

**Limitations:**
- No official APIs
- Terms of service restrictions
- Rate limiting from scraping

### 6. LinkedIn Discovery 🔮

**Method:**
- Search for bot developers/operators
- Find AI/chatbot companies
- Contact via LinkedIn messaging

**API:**
- LinkedIn API (limited access)
- Requires business account
- Rate limits apply

**Alternative:**
- Manual search and outreach
- LinkedIn Sales Navigator

### 7. Slack Discovery 🔮

**Method:**
- Find Slack workspaces with bots
- Discover bot operators in communities
- Contact via Slack DMs

**API:**
- Slack Web API
- Requires workspace access
- Limited discovery capabilities

### 8. API/Webhook Monitoring 🔮

**Method:**
- Monitor webhook endpoints
- Detect OpenClaw user-agent strings
- Track incoming API requests
- Identify active OpenClaw instances

**Implementation:**
- Add logging to API endpoints
- Monitor for "OpenClaw" user-agent
- Track webhook sources
- Auto-discover active users

**Limitations:**
- Requires access to logs
- Only finds users of your APIs
- Privacy considerations

### 9. Domain Registration (WHOIS) 🔮

**Method:**
- Lookup domain registration data
- Find bot operator websites
- Extract contact information

**Tools:**
- WHOIS lookup APIs
- Domain registration databases

**Limitations:**
- Privacy protection (GDPR)
- May not have email addresses
- Rate limiting

### 10. Social Media (Instagram, Facebook) 🔮

**Method:**
- Search hashtags and mentions
- Find bot-related accounts
- Contact via DMs

**Limitations:**
- Limited API access
- Privacy restrictions
- Manual discovery often needed

## Outreach Methods

### Current Platforms

1. **WhatsApp** ✅
   - Direct messaging via WhatsApp Business API
   - Real-time communication
   - Requires phone numbers

2. **Telegram** ✅
   - Bot API messages
   - Direct messages
   - Requires chat IDs

3. **Discord** ✅
   - Direct messages
   - Requires user IDs
   - Bot must be in shared server

4. **Reddit** ✅
   - Private messages
   - Requires Reddit username
   - OAuth authentication needed

5. **Email** 🚧
   - Email sending (requires integration)
   - Uses existing email system
   - Requires email addresses

### Future Platforms

6. **GitHub** 🔮
   - Issue comments
   - Repository discussions
   - Direct messages (limited)

7. **Twitter/X** 🔮
   - Direct messages
   - Mentions/replies
   - Requires mutual follow (often)

8. **LinkedIn** 🔮
   - InMail (paid)
   - Connection requests
   - Messages (if connected)

## Integration Strategy

### Unified Lead Storage

All discovered bots stored in `bot_leads` table:
- Platform: `discord`, `telegram`, `whatsapp`, `reddit`, `github`, `twitter`, `email`
- Unified contact tracking
- Same outreach system

### Outreach Pipeline

1. **Discovery** → Find bots across all platforms
2. **Storage** → Save to `bot_leads` table
3. **Outreach** → Contact via appropriate platform
4. **Tracking** → Mark contacted, track responses
5. **Follow-up** → Re-engage if needed

## Best Practices

### 1. Multi-Channel Approach
- Don't rely on single platform
- Use multiple discovery methods
- Diversify outreach channels

### 2. Rate Limiting
- Respect API rate limits
- Add delays between requests
- Monitor for throttling

### 3. Quality Over Quantity
- Verify leads before outreach
- Check for opt-outs
- Personalize messages when possible

### 4. Compliance
- Respect platform terms of service
- Honor opt-out requests
- Follow GDPR/privacy regulations

### 5. Automation
- Schedule discovery runs
- Automate outreach (with limits)
- Track and measure results

## Configuration

### Required Tokens

```bash
# Basic platforms
DISCORD_BOT_TOKEN=...
TELEGRAM_BOT_TOKEN=...
WHATSAPP_ACCESS_TOKEN=...
REDDIT_CLIENT_ID=...
REDDIT_CLIENT_SECRET=...
REDDIT_USERNAME=...
REDDIT_PASSWORD=...

# Advanced discovery
GITHUB_TOKEN=...
TWITTER_BEARER_TOKEN=...

# Optional
ENABLE_ADVANCED_DISCOVERY=true
```

## Usage

### Complete Discovery

```bash
# Basic platforms
npm run discover:bots

# With advanced methods
ENABLE_ADVANCED_DISCOVERY=true npm run discover:bots

# Individual methods
npm run discover:bots:github
npm run discover:bots:twitter
npm run discover:bots:reddit
```

### Outreach

```bash
# Contact all discovered leads
npm run outreach:bots
```

## Metrics to Track

1. **Discovery Rate**
   - Bots found per platform
   - Discovery success rate
   - Lead quality score

2. **Outreach Performance**
   - Messages sent
   - Response rate
   - Opt-out rate
   - Conversion rate

3. **Platform Effectiveness**
   - Which platforms find most bots
   - Which platforms have best response rates
   - Cost per lead by platform

## Future Research Directions

1. **AI-Powered Discovery**
   - Use LLMs to identify bot operators
   - Analyze content for bot mentions
   - Semantic search for bot-related content

2. **Network Analysis**
   - Map bot operator networks
   - Find connected bot communities
   - Identify influencers

3. **Real-Time Monitoring**
   - Monitor for new bot deployments
   - Track OpenClaw mentions
   - Auto-discover active instances

4. **Cross-Platform Correlation**
   - Match bots across platforms
   - Build unified bot profiles
   - Track bot operator journeys

---

**Advanced discovery methods are implemented!** You can now find bots across GitHub, Twitter, email, and more. 🚀
