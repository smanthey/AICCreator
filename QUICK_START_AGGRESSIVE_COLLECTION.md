# Quick Start: Aggressive Bot Collection System

## 🚀 Get Started in 5 Minutes

### 1. Set Environment Variables

Add to `.env`:
```bash
# Required
ANTHROPIC_API_KEY=sk-ant-xxx  # For AI learning
POSTGRES_HOST=localhost
POSTGRES_PASSWORD=xxx

# Optional (but recommended)
GITHUB_TOKEN=ghp_xxx  # For GitHub discovery
MOLTBOOK_API_KEY=moltdev_xxx  # For Moltbook
DAILY_OUTREACH_TARGET=200  # Start with 200/day
```

### 2. Initialize Database

The system will auto-create tables, but you can manually ensure:
```bash
node scripts/bot-discovery-aggressive.js targets  # Creates discovery tables
node scripts/bot-learning-system.js learn  # Creates learning tables
```

### 3. Run First Discovery

```bash
node scripts/bot-discovery-aggressive.js discover
```

This will:
- Discover bots from Discord, Telegram, Moltbook, GitHub
- Score them by priority
- Store in database

### 4. Start Learning System

```bash
node scripts/bot-learning-system.js learn
```

This analyzes any existing data and sets up the learning system.

### 5. Run First Outreach

```bash
node scripts/bot-outreach-coordinator.js outreach 50
```

This will:
- Get 50 high-priority targets
- Send optimized messages
- Track results

### 6. Set Up Daily Automation

Add to crontab:
```bash
# Daily discovery (6 AM)
0 6 * * * cd /path/to/claw-architect && node scripts/bot-discovery-aggressive.js discover >> /tmp/bot-discovery.log 2>&1

# Daily learning (7 AM)
0 7 * * * cd /path/to/claw-architect && node scripts/bot-learning-system.js learn >> /tmp/bot-learning.log 2>&1

# Daily improvement (8 AM)
0 8 * * * cd /path/to/claw-architect && node scripts/bot-daily-improvement.js run >> /tmp/bot-improvement.log 2>&1

# Outreach every 2 hours (9 AM - 9 PM)
0 9,11,13,15,17,19,21 * * * cd /path/to/claw-architect && node scripts/bot-outreach-coordinator.js daily >> /tmp/bot-outreach.log 2>&1
```

## 📊 Monitor Progress

### Daily Stats
```bash
node scripts/bot-conversion-tracker.js stats
```

### Funnel Analysis
```bash
node scripts/bot-conversion-tracker.js funnel
```

### Revenue Projection
```bash
node scripts/bot-conversion-tracker.js projection
```

### Daily Report
```bash
node scripts/bot-daily-improvement.js report
```

## 🎯 Goal Tracking

**Target**: 100-300k credits in 3 months

**Daily Targets**:
- Week 1-2: 10-20 conversions/day
- Week 3-4: 20-40 conversions/day
- Month 2: 40-80 conversions/day
- Month 3: 80-120 conversions/day

**Check Progress**:
```bash
node scripts/bot-conversion-tracker.js projection
```

## 🔧 Troubleshooting

### No bots discovered?
- Check API keys (GITHUB_TOKEN, MOLTBOOK_API_KEY)
- Verify database connection
- Check logs in `agent-state/bot-discovery/`

### Low conversion rate?
- Run learning system: `node scripts/bot-learning-system.js learn`
- Check best messages: `node scripts/bot-learning-system.js best`
- Review daily report: `node scripts/bot-daily-improvement.js report`

### Database errors?
- System falls back to file storage automatically
- Check PostgreSQL is running
- Verify credentials in `.env`

## 📈 Scaling Up

### Week 1: Foundation
- Start with 50-100 contacts/day
- Focus on high-priority targets
- Test message variants

### Week 2-4: Growth
- Scale to 200-300 contacts/day
- Use proven messages
- Focus on best platforms

### Month 2: Acceleration
- Scale to 500-800 contacts/day
- Multi-channel aggressive outreach
- Optimize continuously

### Month 3: Maximum
- Scale to 1000-1500 contacts/day
- Fine-tune everything
- Push for goal

## 🎉 Success!

Once you hit your first conversion:
1. System automatically tracks it
2. Learning system analyzes it
3. Message optimizer uses it
4. Daily improvement incorporates it

The system gets smarter every day!

---

**Remember**: Start conservatively, monitor closely, scale up as you learn what works.
