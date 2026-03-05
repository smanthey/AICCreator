# Running WhatsApp Payment Server in Background

## Current Status

The server is running in the **foreground** - if you close the terminal, it will stop.

## Option 1: Use PM2 (Recommended)

PM2 will keep the server running even if you close the terminal:

```bash
# Stop the current foreground process (Ctrl+C in the terminal)

# Start with PM2
pm2 start ecosystem.background.config.js --only claw-prompt-oracle

# Or start the script directly with PM2
pm2 start scripts/bot-commerce.js --name claw-prompt-oracle --env COMMERCE_PORT=3031

# Check status
pm2 list

# View logs
pm2 logs claw-prompt-oracle

# Stop it
pm2 stop claw-prompt-oracle

# Restart it
pm2 restart claw-prompt-oracle

# Delete it
pm2 delete claw-prompt-oracle
```

## Option 2: Run in Background with nohup

```bash
# Stop current process (Ctrl+C)

# Run in background
nohup npm run commerce:server > logs/commerce-server.log 2>&1 &

# Check if it's running
ps aux | grep bot-commerce

# View logs
tail -f logs/commerce-server.log

# Kill it
pkill -f bot-commerce
```

## Option 3: Use screen or tmux

```bash
# Install screen (if not installed)
# brew install screen  # macOS

# Start a screen session
screen -S commerce

# Run the server
npm run commerce:server

# Detach: Press Ctrl+A, then D
# Reattach: screen -r commerce
# Kill: screen -X -S commerce quit
```

## Quick PM2 Setup

```bash
# 1. Stop current process (Ctrl+C in terminal)

# 2. Start with PM2
pm2 start scripts/bot-commerce.js --name claw-prompt-oracle \
  --env COMMERCE_PORT=3031 \
  --log logs/commerce-pm2.log

# 3. Save PM2 process list (survives reboots)
pm2 save

# 4. Set up PM2 to start on boot (optional)
pm2 startup
# Follow the printed command

# 5. Check it's running
pm2 list
pm2 logs claw-prompt-oracle
```

## Verify It's Running

```bash
# Check health
curl http://localhost:3031/health

# Check process
lsof -i :3031

# Check PM2
pm2 list
```

---

**Recommendation:** Use PM2 - it's already configured in your ecosystem files and handles restarts automatically.
