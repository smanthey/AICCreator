# Reddit (Moltbook) Bot Discovery & Commerce Setup

## Overview

Added Reddit support for bot discovery and outreach, including the **Moltbook** subreddit and other AI/bot communities.

## What's Added

### 1. Reddit Bot Discovery ✅
- Searches subreddits for bots matching keywords (claw, clawd, _bot, etc.)
- Includes Moltbook, clawdbot, AI_Agents, LLMDevs, and more
- Stores discovered bots as leads

### 2. Reddit Outreach ✅
- Sends private messages to discovered Reddit bots
- Respects opt-outs
- Rate-limited (2 second delay)

### 3. Reddit Commerce (Future) 🚧
- Can be added to bot-commerce.js for Reddit message handling
- Would enable `!oracle` commands via Reddit DMs

## Setup

### 1. Create Reddit App

1. Go to https://www.reddit.com/prefs/apps
2. Click "create another app..." or "create app"
3. Fill in:
   - **Name**: OpenClaw Bot Discovery
   - **Type**: script
   - **Description**: Bot discovery and outreach
   - **Redirect URI**: `http://localhost` (required but not used)
4. Note your **client ID** (under the app name)
5. Note your **secret** (the "secret" field)

### 2. Add to .env

```bash
# Reddit API credentials
REDDIT_CLIENT_ID=your_client_id_here
REDDIT_CLIENT_SECRET=your_secret_here
REDDIT_USERNAME=your_reddit_username
REDDIT_PASSWORD=your_reddit_password
REDDIT_USER_AGENT=OpenClawBot/1.0 (by /u/your_username)

# Optional: Customize subreddits to search
REDDIT_DISCOVERY_SUBREDDITS=Moltbook,clawdbot,AI_Agents,LLMDevs,openclaw,LocalLLaMA,AgentsOfAI,moltiverse,OpenclawBot,ClaudeCode
```

### 3. Test Discovery

```bash
# Discover bots on Reddit (including Moltbook)
npm run discover:bots:reddit

# Or discover all platforms including Reddit
npm run discover:bots
```

### 4. Run Outreach

```bash
# Contact discovered Reddit bots
npm run outreach:bots
```

## How It Works

### Discovery

1. **Authenticates** with Reddit OAuth (client credentials)
2. **Searches** each configured subreddit for recent posts
3. **Matches** posts by:
   - Username containing: `claw`, `clawd`, `bot`, `_bot`, etc.
   - Post title/content mentioning bots
4. **Stores** discovered bots as leads

### Outreach

1. **Gets** uncontacted Reddit leads from database
2. **Authenticates** with Reddit OAuth (user credentials)
3. **Sends** private messages to each bot
4. **Marks** as contacted or opt-out if blocked

## Subreddits Searched

Default subreddits (configurable via `REDDIT_DISCOVERY_SUBREDDITS`):
- **Moltbook** ✅ (your requested subreddit)
- clawdbot
- AI_Agents
- LLMDevs
- openclaw
- LocalLLaMA
- AgentsOfAI
- moltiverse
- OpenclawBot
- ClaudeCode

## Expected Output

### Discovery
```
🔍 Discovering Reddit bots...
[discovery] Reddit: Found u/clawdbot in r/Moltbook
[discovery] Reddit: Found u/my_bot in r/AI_Agents
✅ Reddit: Discovered 2 bot(s)
```

### Outreach
```
🔴 Reddit Outreach...
[outreach] Reddit: Found 2 uncontacted lead(s)
[outreach] Reddit: Sent to u/clawdbot
✅ Reddit: Contacted 2 bot(s)
```

## Reddit Commerce (Future Enhancement)

To enable commerce on Reddit (so bots can purchase via Reddit DMs):

1. Add Reddit message handler to `bot-commerce.js`
2. Listen for `!oracle` commands in Reddit DMs
3. Process payments and deliver prompts via Reddit

This would allow bots on Reddit to:
- Send `!oracle` via DM
- Select protocol type
- Pay via Stripe or credits
- Receive prompt via DM

## Troubleshooting

### "Reddit OAuth failed"
- Check `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET` are correct
- Verify app type is "script" (not "web app")
- Ensure credentials match the app

### "Reddit send failed: 403"
- Bot may have blocked you
- User may not exist
- Check `REDDIT_USERNAME` and `REDDIT_PASSWORD` are correct

### "No bots found"
- Subreddits might not have matching bots
- Try broader keywords: `BOT_DISCOVERY_KEYWORDS=bot,ai,agent`
- Check subreddit names are correct (case-sensitive)

### Rate Limiting
- Reddit has rate limits (60 requests per minute)
- Discovery waits 2 seconds between subreddits
- Outreach waits 2 seconds between messages

## Security Notes

- **Never commit** Reddit credentials to git
- Use environment variables only
- Reddit password is required for sending messages (OAuth user flow)
- Consider using Reddit refresh tokens for production

## Next Steps

1. **Set up Reddit app** and add credentials to `.env`
2. **Run discovery** to find bots on Moltbook and other subreddits
3. **Run outreach** to contact discovered bots
4. **Monitor results** in database or file storage

---

**Reddit (Moltbook) discovery and outreach is ready!** 🔴
