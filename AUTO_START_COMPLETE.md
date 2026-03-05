# Auto-Start System Complete ✅

## One-Time Setup

Run this **once** and everything will auto-start forever:

```bash
npm run auto:start
```

This script will:
1. ✅ Install PM2 if needed
2. ✅ Configure PM2 to auto-start on system boot
3. ✅ Start all services
4. ✅ Save PM2 state
5. ✅ Verify everything is running

## What This Means

After running `npm run auto:start`:

- **All systems auto-start on boot** - No manual intervention needed
- **Services auto-restart if they crash** - PM2 handles recovery
- **Everything persists** - Close terminals, restart computer, everything keeps running
- **Auto-recovery pulse** - Runs every 5 minutes to ensure services stay healthy

## Services That Auto-Start

### Critical Services (Always Running)
- `claw-architect-api` - Dashboard API
- `claw-dispatcher` - Task dispatcher
- `claw-ollama` - Local AI server
- `claw-openclaw-coordinator` - System coordinator

### Background Services
- All workers (AI, NAS, IO)
- All scheduled tasks (cron jobs)
- All pulse scripts (health checks, recovery)
- All gateways (Discord, Telegram, etc.)

## Auto-Recovery

A new service (`claw-auto-recovery`) runs every 5 minutes to:
- Check if critical services are running
- Restart stopped/errored services automatically
- Save PM2 state periodically
- Log recovery actions

## Verification

Check everything is running:
```bash
pm2 status
```

View logs:
```bash
pm2 logs
```

## No More Manual Steps!

Once you run `npm run auto:start`, you never need to:
- ❌ Manually start services
- ❌ Run commands in terminal
- ❌ Worry about services stopping
- ❌ Restart after computer reboot

Everything is **fully automated** and **self-healing**.

## Troubleshooting

If something isn't running:
```bash
# Check status
pm2 status

# View logs
pm2 logs <service-name>

# Restart a service
pm2 restart <service-name>

# Restart all
pm2 restart all
```

The auto-recovery system will also attempt to fix issues automatically.
