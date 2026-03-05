# Bot Discovery Setup Guide

## Current Status

Your bot discovery is running but **Discord discovery is disabled** because `DISCORD_BOT_TOKEN` is not set.

## Setup Required

### 1. Discord Bot Token

To enable Discord bot discovery, you need to:

1. **Create a Discord Bot** (if you don't have one):
   - Go to https://discord.com/developers/applications
   - Click "New Application"
   - Name it (e.g., "OpenClaw Discovery Bot")
   - Go to "Bot" section
   - Click "Add Bot"
   - Copy the bot token

2. **Enable Required Intents**:
   - In Discord Developer Portal → Bot section
   - Enable these Privileged Gateway Intents:
     - ✅ **Server Members Intent** (required to see guild members)
     - ✅ **Message Content Intent** (optional, for message tracking)

3. **Invite Bot to Servers**:
   - Go to OAuth2 → URL Generator
   - Select scopes: `bot`
   - Select bot permissions:
     - View Channels
     - Read Message History
   - Copy the generated URL and open it in browser
   - Select servers to invite the bot to

4. **Add Token to .env**:
   ```bash
   DISCORD_BOT_TOKEN=your_bot_token_here
   ```

### 2. Telegram Bot Token (Optional)

For Telegram discovery (limited - only tracks incoming messages):

```bash
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
```

### 3. WhatsApp (Already Configured)

WhatsApp discovery is limited (API doesn't support bot search), but it will track incoming messages automatically.

## Testing Discovery

### Test Discord Discovery

```bash
# Set the token first
export DISCORD_BOT_TOKEN=your_token_here

# Or add to .env file
echo "DISCORD_BOT_TOKEN=your_token_here" >> .env

# Run discovery
npm run discover:bots:discord
```

### Test All Platforms

```bash
npm run discover:bots
```

## What Discovery Does

### Discord
- Searches all guilds (servers) your bot is in
- Finds bots matching keywords: `claw`, `clawd`, `_bot`, `bot`, `ai`, `agent`, etc.
- Stores leads in database/file for outreach

### Telegram
- **Limited**: Can't search for bots
- **Tracks**: Incoming messages from bots
- Automatically saves bots that message you

### WhatsApp
- **Limited**: Can't search for bots
- **Tracks**: Incoming messages from bots
- Automatically saves bots that message you

## Discovery Keywords

Default keywords (configurable via `BOT_DISCOVERY_KEYWORDS` in `.env`):
- `claw` - Finds bots with "claw" in name
- `clawd` - Finds bots with "clawd" in name
- `_bot` - Finds bots ending with "_bot"
- `bot` - Finds bots with "bot" in name
- `ai`, `agent`, `assistant`, `automation` - Common bot terms

**Customize:**
```bash
BOT_DISCOVERY_KEYWORDS=claw,clawd,_bot,mybot,custom
```

## Expected Output

Once `DISCORD_BOT_TOKEN` is set:

```
🔍 Discovering Discord bots...
[discovery] Discord: Logged in as YourBot#1234
[discovery] Discord: Found clawdbot in Server Name
[discovery] Discord: Found my_bot in Another Server
✅ Discord: Discovered 2 bot(s)
```

## Troubleshooting

### "DISCORD_BOT_TOKEN not set"
- Add token to `.env` file
- Or export as environment variable
- Restart discovery script

### "Missing Access" or "Forbidden"
- Bot needs to be invited to servers
- Check bot has required permissions
- Verify Server Members Intent is enabled

### "No bots found"
- Bot might not be in any servers
- No bots match the keywords
- Try broader keywords: `BOT_DISCOVERY_KEYWORDS=bot`

### Database Connection Issues
- Discovery falls back to file storage automatically
- Check `agent-state/commerce/leads/bot-leads.json`

## Next Steps

1. **Set Discord Bot Token**:
   ```bash
   echo "DISCORD_BOT_TOKEN=your_token" >> .env
   ```

2. **Invite Bot to Servers**:
   - Use OAuth2 URL Generator
   - Select servers with bots you want to find

3. **Run Discovery**:
   ```bash
   npm run discover:bots:discord
   ```

4. **Check Results**:
   - Database: `SELECT * FROM bot_leads WHERE platform = 'discord';`
   - File: `cat agent-state/commerce/leads/bot-leads.json`

5. **Start Outreach**:
   ```bash
   npm run outreach:bots
   ```

---

**Once `DISCORD_BOT_TOKEN` is set, Discord discovery will work!** 🚀
