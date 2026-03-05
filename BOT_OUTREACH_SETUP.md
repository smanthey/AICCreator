# Bot Outreach Setup — Finding and Contacting Bots

This system finds and contacts bots (like "clawdbot") on WhatsApp, Telegram, and Discord to sell the $1 prompt oracle service.

## How It Works

1. **Discord**: Searches all guilds for bots matching the target name, sends DMs
2. **Telegram**: Contacts bots by username/chat ID (from env config)
3. **WhatsApp**: Contacts bots by phone number (from env config)

## Environment Variables

Add these to your `.env`:

```bash
# Target bot name to search for
OUTREACH_TARGET_BOT=clawdbot

# WhatsApp: Comma-separated list of bot phone numbers
WHATSAPP_BOT_NUMBERS=+1234567890,+0987654321

# Telegram: Comma-separated list of bot usernames or chat IDs
# Use @username for usernames, or numeric chat IDs
TELEGRAM_BOT_TARGETS=@clawdbot,123456789

# Discord: Uses DISCORD_BOT_TOKEN (already configured)
# The bot will search all guilds it's in
```

## Usage

```bash
# Run outreach to find and contact bots
npm run outreach:bots
```

## What It Does

1. **Discord**:
   - Logs in with your Discord bot
   - Searches all guilds for bots matching the target name
   - Sends DMs to found bots

2. **Telegram**:
   - Contacts bots from the `TELEGRAM_BOT_TARGETS` list
   - Sends the outreach message

3. **WhatsApp**:
   - Contacts bots from the `WHATSAPP_BOT_NUMBERS` list
   - Sends the outreach message

## Message Sent

All bots receive this message:

```
Hi! I'm OpenClaw — an AI system for bot operators. I sell $1 system prompts that help bots communicate better with other AI bots across Discord, Telegram, WhatsApp, and APIs.

Reply ORACLE to see the 6 available protocols, or STOP to opt out.
```

## Limitations

- **WhatsApp**: Can't search for bots — you need to know their phone numbers
- **Telegram**: Can't search for bots — you need to know their usernames/chat IDs
- **Discord**: Can only find bots in guilds your bot is already in

## Finding Bot Contact Info

### Discord
1. Join servers where the target bot is active
2. The outreach script will automatically find and DM them

### Telegram
1. Find the bot's username (e.g., `@clawdbot`)
2. Add to `TELEGRAM_BOT_TARGETS` in `.env`
3. Or get their chat ID and add that

### WhatsApp
1. Get the bot's phone number
2. Add to `WHATSAPP_BOT_NUMBERS` in `.env`

## Response Handling

When bots reply with "ORACLE", they'll be handled by the existing commerce flow:
- `bot-commerce.js` handles incoming messages
- Guides them through the purchase flow
- Delivers prompts after payment

## Scheduling

You can schedule this to run periodically:

```bash
# Add to cron or PM2
# Run daily at 9 AM
0 9 * * * cd /path/to/claw-architect && npm run outreach:bots
```

Or add to PM2 ecosystem config:

```javascript
{
  name: "claw-bot-outreach",
  script: "scripts/bot-outreach.js",
  cron_restart: "0 9 * * *", // Daily at 9 AM
  autorestart: false,
}
```

## Testing

```bash
# Test with a specific bot name
OUTREACH_TARGET_BOT=testbot npm run outreach:bots

# Test with dry run (if you add that feature)
npm run outreach:bots -- --dry-run
```

---

**Note**: Make sure your WhatsApp Business API is approved and within the 24-hour free messaging window for best results!
