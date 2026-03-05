# Automated Bot Outreach Scheduling

## Overview

Automated scheduling for bot discovery and outreach. The system will:
1. **Discover** new bots on Discord, Telegram, WhatsApp
2. **Contact** uncontacted leads with outreach messages
3. **Track** responses and opt-outs

## Scheduling Options

### Option 1: PM2 Cron Jobs (Recommended)

Already configured in `ecosystem.background.config.js`:

**Bot Discovery:**
- Runs daily at 9 AM
- Discovers bots on all platforms
- Stores leads in database/file

**Bot Outreach:**
- Runs every 6 hours
- Contacts uncontacted leads
- Respects opt-outs

**Start with PM2:**
```bash
pm2 start ecosystem.background.config.js --only claw-bot-discovery,claw-bot-outreach
pm2 save
```

**Check status:**
```bash
pm2 list | grep bot
pm2 logs claw-bot-discovery
pm2 logs claw-bot-outreach
```

### Option 2: Continuous Scheduler

Runs discovery and outreach in a continuous loop:

```bash
npm run outreach:schedule:continuous
```

**Configuration (via .env):**
```bash
# Discovery runs every 24 hours (default)
BOT_DISCOVERY_INTERVAL_HOURS=24

# Outreach runs every 6 hours (default)
BOT_OUTREACH_INTERVAL_HOURS=6

# Platforms to discover
BOT_DISCOVERY_PLATFORMS=discord,telegram,whatsapp

# Max leads to contact per outreach cycle
BOT_OUTREACH_LIMIT=50
```

### Option 3: Manual One-Time Run

```bash
# Run discovery + outreach once
npm run outreach:schedule

# Or run individually
npm run discover:bots
npm run outreach:bots
```

## Current PM2 Schedule

**Discovery:**
- **Frequency:** Daily at 9 AM
- **Script:** `bot-lead-discovery.js`
- **Action:** Finds bots on Discord, Telegram, WhatsApp

**Outreach:**
- **Frequency:** Every 6 hours
- **Script:** `bot-outreach.js`
- **Action:** Contacts uncontacted leads

## Customizing Schedule

### Change Discovery Frequency

Edit `ecosystem.background.config.js`:

```javascript
{
  name: "claw-bot-discovery",
  cron_restart: "0 9 * * *", // Daily at 9 AM
  // Change to: "0 */12 * * *" for every 12 hours
  // Or: "0 0 * * 1" for weekly on Monday
}
```

### Change Outreach Frequency

```javascript
{
  name: "claw-bot-outreach",
  cron_restart: "0 */6 * * *", // Every 6 hours
  // Change to: "0 */3 * * *" for every 3 hours
  // Or: "0 10,14,18 * * *" for 10 AM, 2 PM, 6 PM
}
```

### Cron Syntax

```
* * * * *
| | | | └ day of week (0-7, 0/7=Sun)
| | | └── month (1-12)
| | └──── day of month (1-31)
| └────── hour (0-23)
└──────── minute (0-59)
```

**Examples:**
- `0 9 * * *` - Daily at 9 AM
- `0 */6 * * *` - Every 6 hours
- `0 9,15 * * *` - 9 AM and 3 PM daily
- `0 9 * * 1` - Every Monday at 9 AM

## Monitoring

### Check PM2 Status

```bash
pm2 list | grep bot
```

### View Logs

```bash
# Discovery logs
pm2 logs claw-bot-discovery --lines 50

# Outreach logs
pm2 logs claw-bot-outreach --lines 50

# Both
pm2 logs --lines 50
```

### Check Lead Stats

```bash
# If using database
psql -h your-host -d claw_architect -c "SELECT platform, COUNT(*) FROM bot_leads GROUP BY platform;"

# If using file storage
cat agent-state/commerce/leads/bot-leads.json | jq 'to_entries | length'
```

## Rate Limiting

The system includes rate limiting:
- **2 second delay** between messages
- **50 leads per cycle** (configurable via `BOT_OUTREACH_LIMIT`)
- **Respects opt-outs** - won't contact bots that sent "STOP"

## Opt-Out Handling

When a bot sends "STOP":
- Marked as `opt_out = TRUE`
- Status set to `opt_out`
- Won't be contacted in future cycles

## Troubleshooting

### Discovery Not Finding Bots

1. **Check Discord token:**
   ```bash
   echo $DISCORD_BOT_TOKEN
   ```

2. **Check discovery keywords:**
   ```bash
   echo $BOT_DISCOVERY_KEYWORDS
   # Default: bot,claw,ai,agent,assistant,automation
   ```

3. **Run manually to see errors:**
   ```bash
   npm run discover:bots:discord
   ```

### Outreach Not Sending

1. **Check if leads exist:**
   ```bash
   # Check database or file
   ```

2. **Check WhatsApp/Telegram tokens:**
   ```bash
   echo $WHATSAPP_ACCESS_TOKEN
   echo $TELEGRAM_BOT_TOKEN
   ```

3. **Run manually:**
   ```bash
   npm run outreach:bots
   ```

### PM2 Not Running

```bash
# Check if PM2 processes are running
pm2 list

# Restart if needed
pm2 restart claw-bot-discovery
pm2 restart claw-bot-outreach

# Check PM2 logs for errors
pm2 logs
```

## Best Practices

1. **Start with manual runs** to verify everything works
2. **Monitor first few cycles** to check for issues
3. **Adjust frequency** based on results
4. **Respect rate limits** - don't spam
5. **Monitor opt-outs** - respect user preferences

## Recommended Schedule

**For Testing:**
- Discovery: Daily at 9 AM
- Outreach: Every 12 hours

**For Production:**
- Discovery: Daily at 9 AM (or weekly if you have many leads)
- Outreach: Every 6 hours (or daily if volume is low)

## Next Steps

1. **Start PM2 processes:**
   ```bash
   pm2 start ecosystem.background.config.js --only claw-bot-discovery,claw-bot-outreach
   pm2 save
   ```

2. **Monitor first cycle:**
   ```bash
   pm2 logs --lines 100
   ```

3. **Check results:**
   - Review discovered leads
   - Check outreach success rate
   - Monitor opt-outs

4. **Adjust schedule** as needed

---

**Automated outreach is now scheduled!** 🚀
