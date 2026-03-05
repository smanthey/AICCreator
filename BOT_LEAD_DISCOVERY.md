# Bot Lead Discovery & Outreach System

## Overview

The system now **dynamically discovers** bot leads instead of using hardcoded lists:

1. **Discovery** - Finds bots on Discord, Telegram, WhatsApp
2. **Storage** - Saves leads to database
3. **Outreach** - Contacts uncontacted leads
4. **Tracking** - Monitors responses and opt-outs

## How It Works

### 1. Lead Discovery

**Discord:**
- Searches all guilds your bot is in
- Finds bots matching keywords (configurable)
- Stores bot info in database

**Telegram/WhatsApp:**
- Tracks incoming messages as potential leads
- Automatically discovers bots that message you

### 2. Lead Storage

Leads are stored in `bot_leads` table:
- Platform (discord, telegram, whatsapp)
- Bot ID, username, display name
- Contact info (user ID, chat ID, etc.)
- Status (discovered, contacted, responded, opt_out)
- Timestamps (discovered_at, contacted_at, responded_at)

### 3. Outreach

Contacts uncontacted leads:
- Gets leads with `status = 'discovered'` and `contacted_at IS NULL`
- Sends outreach message
- Marks as contacted
- Handles opt-outs

## Usage

### Discover Leads

```bash
# Discover bots on all platforms
npm run discover:bots

# Discover only Discord bots
npm run discover:bots:discord

# Or directly:
node scripts/bot-lead-discovery.js [discord|telegram|whatsapp|all]
```

### Contact Discovered Leads

```bash
# Contact uncontacted leads
npm run outreach:bots
```

## Configuration

### Discovery Keywords

Set keywords to search for in bot names:

```bash
# .env
BOT_DISCOVERY_KEYWORDS=bot,claw,ai,agent,assistant,automation
```

### Auto-Discovery

The system automatically tracks incoming messages:
- **Discord**: Tracks bot messages in guilds
- **Telegram**: Tracks messages from bots/users
- **WhatsApp**: Tracks incoming messages

## Database Schema

```sql
CREATE TABLE bot_leads (
  id SERIAL PRIMARY KEY,
  platform TEXT NOT NULL,
  bot_id TEXT NOT NULL,
  bot_username TEXT,
  bot_display_name TEXT,
  contact_info TEXT,
  guild_id TEXT,
  guild_name TEXT,
  discovered_at TIMESTAMP DEFAULT NOW(),
  contacted_at TIMESTAMP,
  responded_at TIMESTAMP,
  status TEXT DEFAULT 'discovered',
  opt_out BOOLEAN DEFAULT FALSE,
  notes JSONB,
  UNIQUE(platform, bot_id)
);
```

## Status Flow

1. **discovered** - Found but not contacted
2. **contacted** - Outreach message sent
3. **responded** - Bot replied (handled by commerce flow)
4. **opt_out** - Bot opted out (STOP message)

## Opt-Out Handling

When a bot sends "STOP":
- Marked as `opt_out = TRUE`
- Status set to `opt_out`
- Won't be contacted again

## Scheduling

### Daily Discovery

```bash
# Add to cron or PM2
0 9 * * * cd /path/to/claw-architect && npm run discover:bots
```

### Daily Outreach

```bash
# Contact new leads daily
0 10 * * * cd /path/to/claw-architect && npm run outreach:bots
```

### PM2 Config

```javascript
{
  name: "claw-bot-discovery",
  script: "scripts/bot-lead-discovery.js",
  cron_restart: "0 9 * * *", // Daily at 9 AM
  autorestart: false,
},
{
  name: "claw-bot-outreach",
  script: "scripts/bot-outreach.js",
  cron_restart: "0 10 * * *", // Daily at 10 AM
  autorestart: false,
}
```

## Statistics

View lead stats:

```sql
SELECT 
  platform,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE contacted_at IS NULL) as uncontacted,
  COUNT(*) FILTER (WHERE contacted_at IS NOT NULL) as contacted,
  COUNT(*) FILTER (WHERE opt_out = TRUE) as opted_out
FROM bot_leads
GROUP BY platform;
```

## Integration

The discovery system integrates with:
- `bot-commerce.js` - Tracks incoming messages
- `discord-gateway.js` - Tracks bot messages in guilds
- `bot-outreach.js` - Uses discovered leads for outreach

## Next Steps

1. Run discovery: `npm run discover:bots`
2. Review discovered leads in database
3. Run outreach: `npm run outreach:bots`
4. Monitor responses and conversions
5. Schedule daily discovery/outreach cycles

---

**The system now finds leads dynamically instead of using hardcoded lists!**
