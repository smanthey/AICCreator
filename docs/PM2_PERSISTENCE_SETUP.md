# PM2 Persistence Setup Guide

## Overview

**You do not need a terminal open.** All systems run under PM2 as a daemon. After you run the start commands below and `pm2 save`, you can close the terminal; dispatcher, workers, API, cron jobs, and all agents keep running in the background. Cron-scheduled apps (e.g. daily-feature-rotation, symbolic-qa-hub, exemplar-repos) show as "stopped" until their next scheduled run—that is normal.

## Quick Setup

### 1. Install PM2 (if not already installed)

```bash
npm install -g pm2
```

### 2. Start All Services (then close the terminal)

```bash
# One command: start background + main ecosystem and save (no terminal needed after this)
npm run pm2:ensure

# Or step by step:
# Start background services (dispatcher, workers, API, cron jobs, etc.)
pm2 start ecosystem.background.config.js

# Start control plane (gateway, local worker)
pm2 start ecosystem.config.js

# Save the process list so PM2 daemon keeps managing them
pm2 save
```

After this, close the terminal. PM2 runs in the background; all long-running and cron-scheduled apps are managed by it.

### 3. Configure Auto-Start on Boot

```bash
# This will print a command - run it with sudo
pm2 startup

# Then save again
pm2 save
```

### 4. Verify Everything is Running

```bash
# Check status
pm2 status

# Run persistence check
node scripts/ensure-pm2-persistence.js
```

## Critical Processes

These processes should ALWAYS be running under PM2:

- `claw-architect-api` - Dashboard and API server
- `claw-dispatcher` - Task dispatcher
- `claw-gateway` - Telegram gateway
- `claw-worker` - Local worker
- `claw-prompt-oracle` - Bot commerce system

## Verification

### Check if PM2 is Running

```bash
pm2 status
```

You should see all processes with status "online".

### Test Persistence

1. Close ALL terminal windows
2. Open a new terminal
3. Run: `pm2 status`
4. All processes should still be running

### Check Logs

```bash
# All logs
pm2 logs

# Specific process
pm2 logs claw-architect-api
```

## Troubleshooting

### Processes Not Starting

```bash
# Check PM2 logs
pm2 logs

# Restart all
pm2 restart all

# If that doesn't work, delete and restart
pm2 delete all
pm2 start ecosystem.background.config.js
pm2 start ecosystem.config.js
pm2 save
```

### PM2 Not Surviving Reboot

```bash
# Re-run startup configuration
pm2 startup
# (Follow the printed command)

# Save again
pm2 save
```

### Processes Dying

Check the logs to see why:

```bash
pm2 logs <process-name> --lines 100
```

Common issues:
- Missing environment variables (check `.env`)
- Port conflicts
- Database connection issues
- Memory limits

## Maintenance

### Daily Checks

Run the persistence check script:

```bash
node scripts/ensure-pm2-persistence.js
```

### After Code Changes

If you update code, restart affected processes:

```bash
# Restart specific process
pm2 restart claw-architect-api

# Or restart all
pm2 restart all
pm2 save
```

### After Environment Changes

If you change `.env`:

```bash
pm2 restart all --update-env
pm2 save
```

## Important Notes

1. **NEVER run scripts directly with `node`** - Always use PM2
2. **Always run `pm2 save`** after starting/stopping processes
3. **Check `pm2 status`** regularly to ensure everything is running
4. **Use `pm2 logs`** to debug issues

## Ecosystem Files

- `ecosystem.config.js` - Control plane (gateway, local worker)
- `ecosystem.background.config.js` - Background services (dispatcher, workers, API, bots)
- `ecosystem.ai-satellite.config.js` - AI satellite devices
- `ecosystem.i7-satellite.config.js` - i7 desktop satellite

## Dashboard Integration

The dashboard shows PM2 status. If processes aren't running, you'll see warnings.

## Emergency Recovery

If PM2 crashes or processes stop:

```bash
# Kill all PM2 processes
pm2 kill

# Restart PM2 daemon
pm2 resurrect

# Or start fresh
pm2 start ecosystem.background.config.js
pm2 start ecosystem.config.js
pm2 save
```
