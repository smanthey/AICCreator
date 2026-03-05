# 🆘 WhatsApp Payment Server - Help Guide

## 🎯 Quick Start

### Option 1: Stop PM2 and Run Manually (Recommended for Testing)

```bash
# 1. Stop the PM2 process that's auto-restarting
pm2 stop claw-prompt-oracle

# 2. Verify port 3031 is free
lsof -i :3031

# 3. Start the server manually
npm run commerce:server
```

### Option 2: Use PM2 to Manage It

```bash
# Check if it's already running
pm2 list

# View logs
pm2 logs claw-prompt-oracle

# Restart if needed
pm2 restart claw-prompt-oracle

# Stop it
pm2 stop claw-prompt-oracle
```

---

## 🔧 Troubleshooting

### Port 3031 Already in Use

**Problem:** `Error: listen EADDRINUSE: address already in use :::3031`

**Solution 1: Kill the process**
```bash
# Find and kill the process
kill -9 $(lsof -ti :3031)

# Or use the helper script
npm run commerce:kill
```

**Solution 2: Stop PM2 process**
```bash
pm2 stop claw-prompt-oracle
```

**Solution 3: Use a different port**
```bash
COMMERCE_PORT=3032 npm run commerce:server
```
*(Note: You'll need to update webhook URLs if you change the port)*

---

## ✅ Verify Server is Running

Once the server starts, you should see:

```
[bot-commerce] starting standalone mode (Telegram/WhatsApp + webhook server)
[bot-commerce] delivery route registered for whatsapp
[bot-commerce] Telegram commerce polling started
[payment-router] webhook server on :3031
```

**Health check:**
```bash
curl http://localhost:3031/health
```

Should return:
```json
{
  "status": "ok",
  "port": 3031,
  "price_usd": 1,
  "stripe": true,
  "whatsapp_webhook": true,
  "whatsapp_messaging": true
}
```

---

## 📱 Test WhatsApp Flow

1. **Send message to your WhatsApp Business number:**
   ```
   oracle
   ```

2. **Follow the prompts:**
   - Select a protocol (1-6)
   - Provide context: `WhatsApp | payment bot | analytics bots`
   - Choose payment: `1` (Stripe)

3. **You'll receive a payment link** - click it and pay $1

4. **Prompt is delivered automatically** after payment

---

## 🔗 Webhook Configuration

### Meta Business Manager (WhatsApp)
- **URL:** `https://autopayagent.com/webhooks/whatsapp`
- **Verify Token:** `83b6bca4b79b4e535b2d3bc14`
- **Events:** `messages`, `message_deliveries`, `message_reads`

### Stripe Dashboard
- **URL:** `https://autopayagent.com/webhooks/stripe`
- **Events:** `checkout.session.completed`, `checkout.session.async_payment_succeeded`

---

## 📊 Monitor Payments

```bash
# Check pending payments
npm run commerce:pending

# View transaction log
cat agent-state/commerce/transactions.jsonl | tail -20
```

---

## 🛑 Stop the Server

**If running manually:**
- Press `Ctrl+C` in the terminal

**If running via PM2:**
```bash
pm2 stop claw-prompt-oracle
```

---

## 🔄 Common Commands

```bash
# Start server (manual)
npm run commerce:server

# Kill process on port 3031
npm run commerce:kill

# Check pending payments
npm run commerce:pending

# Add credits to a user
npm run credits:add <userId> <amount>

# Check user credits
npm run credits:check <userId>
```

---

## ❓ Still Having Issues?

1. **Check environment variables:**
   ```bash
   node scripts/whatsapp-payment-setup.js
   ```

2. **Verify webhooks are configured:**
   - Meta Business Manager → WhatsApp → Configuration → Webhook
   - Stripe Dashboard → Developers → Webhooks

3. **Check server logs:**
   - Look for error messages in the terminal
   - Check PM2 logs: `pm2 logs claw-prompt-oracle`

4. **Verify port is accessible:**
   ```bash
   curl http://localhost:3031/health
   ```

---

## 🎯 Next Steps After Server Starts

1. ✅ Server is running on port 3031
2. ✅ Webhooks are configured in Meta and Stripe
3. ✅ Send `oracle` to your WhatsApp Business number
4. ✅ Test the full payment flow
5. ✅ Monitor payments: `npm run commerce:pending`

**You have 24 hours of free messaging - use it to test!** 🚀
