# ClawPay Health Check — Ensure $1 Bot Revenue Flow Is Working

**ClawPay** = WhatsApp + Telegram + Discord commerce for the OpenClaw Prompt Oracle ($1 per prompt). The "agent learning to make $1 from other OpenClaw bots" is the **Autonomous Bot Collection Agent** plus outreach/discovery.

---

## 1. Required Processes (must be running)

| Process | Script | Purpose |
|---------|--------|---------|
| **claw-prompt-oracle** | bot-commerce.js | Core commerce: Telegram polling + WhatsApp webhook + Stripe. Port 3031. |
| **claw-bot-commerce-api** | bot-commerce-api.js | Programmatic API for bots. Port 3032. |
| **claw-discord-gateway** | discord-gateway.js | Handles `!oracle` on Discord. |
| **claw-bot-outreach** | bot-outreach.js | Cron every 6h: finds bots, sends outreach. |
| **claw-bot-discovery** | bot-lead-discovery.js | Cron daily 9am: discovers bots. |
| **claw-mission-bot_collection_autonomous** | bot-autonomous-agent.js | Cron every 4h: researches, discovers, outreaches, learns. Goal: 100–300k credits. |

---

## 2. Quick Verification Commands

```bash
# 1. PM2 status — core commerce must be online
pm2 jlist | node -e "
const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const critical = ['claw-prompt-oracle','claw-bot-commerce-api','claw-discord-gateway','claw-bot-outreach'];
critical.forEach(n => {
  const p = d.find(a=>a.name===n);
  console.log(n + ': ' + (p?.pm2_env?.status || 'NOT FOUND'));
});
"

# 2. Commerce health endpoint (if exposed)
curl -s http://localhost:3031/health 2>/dev/null | jq . || echo "Port 3031 not responding"

# 3. Pending payments (Stripe)
npm run commerce:pending

# 4. Credits check
npm run credits:check
```

---

## 3. Environment Variables (ClawPay)

| Variable | Required for |
|----------|--------------|
| `TELEGRAM_BOT_TOKEN` | Telegram commerce |
| `WHATSAPP_ACCESS_TOKEN` | WhatsApp commerce |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp commerce |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | WhatsApp webhook verification |
| `STRIPE_SECRET_KEY` | Payments |
| `STRIPE_WEBHOOK_SECRET` | Payment confirmation |
| `COMMERCE_PUBLIC_URL` | Payment links, webhooks (e.g. https://autopayagent.com) |
| `ANTHROPIC_API_KEY` or oracle model chain | Prompt generation |

---

## 4. Agent That Learns to Make $1 from Bots

**bot_collection_autonomous** runs every 4 hours. It:

- Researches (GitHub, HN, Reddit)
- Runs aggressive discovery (`bot-discovery-aggressive.js`)
- Runs outreach coordinator (`bot-outreach-coordinator.js`)
- Learns via `bot-learning-system.js`
- Improves via `bot-daily-improvement.js`

**Dependencies:** Same as ClawPay + discovery/outreach env (e.g. `OUTREACH_TARGET_BOT`, `TELEGRAM_BOT_TARGETS`, `WHATSAPP_BOT_NUMBERS`).

**To verify it's running:**

```bash
# Mission control agent (cron)
pm2 jlist | node -e "
const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const p = d.find(a=>a.name==='claw-mission-bot_collection_autonomous');
console.log('bot_collection_autonomous:', p?.pm2_env?.status || 'NOT IN PM2');
"

# Manual run (dry)
node scripts/bot-autonomous-agent.js run 2>&1 | head -50
```

**Note:** `claw-mission-bot_collection_autonomous` is in ecosystem.background.config.js (cron every 4h). Start with: `pm2 start ecosystem.background.config.js --only claw-mission-bot_collection_autonomous`

---

## 5. Start ClawPay (if down)

```bash
# Core commerce (Telegram + WhatsApp + Stripe webhooks)
pm2 start ecosystem.background.config.js --only claw-prompt-oracle,claw-bot-commerce-api

# Bot outreach + discovery (cron)
pm2 start ecosystem.background.config.js --only claw-bot-outreach,claw-bot-discovery

# Autonomous agent (if configured)
pm2 start ecosystem.background.config.js --only claw-mission-bot_collection_autonomous

pm2 save
```

---

## 6. WhatsApp Webhook (Meta)

1. Meta Business Manager → WhatsApp → Configuration → Webhook
2. Callback URL: `https://<COMMERCE_PUBLIC_URL>/webhooks/whatsapp`
3. Verify token: value of `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
4. Subscribe to: `messages`, `message_deliveries`, `message_reads`

---

## 7. Known Issues

- **Port 3031 in use:** See `FIX_PM2_PORT.md`. `kill $(lsof -ti :3031)` then `pm2 restart claw-prompt-oracle`
- **WhatsApp not receiving:** Check webhook is verified; ensure `COMMERCE_PUBLIC_URL` is reachable from Meta
- **Discord !oracle not working:** Ensure `claw-discord-gateway` is running and `DISCORD_BOT_TOKEN` is set
