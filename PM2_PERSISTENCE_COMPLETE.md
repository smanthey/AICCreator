# PM2 Persistence - Complete Setup ✅

## Overview

All systems now run persistently in the background under PM2. **Closing terminals or programs will NOT kill your bots** - they continue running independently.

## What Was Added

### 1. Verification Script
- **`scripts/ensure-pm2-persistence.js`** - Checks PM2 setup and process status
- Run: `npm run pm2:check`

### 2. Startup Script
- **`scripts/start-all-persistent.sh`** - Ensures all processes start under PM2
- Run: `./scripts/start-all-persistent.sh` or `npm run pm2:ensure`

### 3. Dashboard Integration
- Dashboard shows warnings if processes aren't running under PM2
- System status endpoint checks PM2 health
- Visual alerts for persistence issues

### 4. Documentation
- **`docs/PM2_PERSISTENCE_SETUP.md`** - Complete setup guide

## Quick Start

### First Time Setup

```bash
# 1. Install PM2 (if not already installed)
npm install -g pm2

# 2. Start all systems
npm run pm2:ensure
# OR
./scripts/start-all-persistent.sh

# 3. Configure auto-start on boot
pm2 startup
# (Follow the printed command)

# 4. Save process list
pm2 save

# 5. Verify everything is running
npm run pm2:check
```

### Daily Use

```bash
# Check status
pm2 status

# View logs
pm2 logs

# Restart if needed
pm2 restart all
pm2 save
```

## Critical Processes

These MUST be running under PM2:

- ✅ `claw-architect-api` - Dashboard/API
- ✅ `claw-dispatcher` - Task dispatcher  
- ✅ `claw-gateway` - Telegram gateway
- ✅ `claw-worker` - Local worker
- ✅ `claw-prompt-oracle` - Bot commerce

## Testing Persistence

1. **Start all processes**: `npm run pm2:ensure`
2. **Verify they're running**: `pm2 status`
3. **Close ALL terminal windows**
4. **Open a new terminal**
5. **Check again**: `pm2 status`
6. **All processes should still be "online"** ✅

## Dashboard Warnings

The dashboard will show a warning banner if:
- PM2 is not running
- Critical processes are not online
- Processes may not persist when terminals close

## NPM Commands

- `npm run pm2:check` - Verify PM2 setup and process status
- `npm run pm2:ensure` - Start all processes under PM2 and save

## Important Notes

1. **NEVER run scripts directly** - Always use PM2
   - ❌ `node scripts/architect-api.js` (will die when terminal closes)
   - ✅ `pm2 start ecosystem.background.config.js` (persists)

2. **Always save after changes**
   - After starting/stopping: `pm2 save`
   - After environment changes: `pm2 restart all --update-env && pm2 save`

3. **Check regularly**
   - Run `npm run pm2:check` daily
   - Check dashboard for warnings

## Troubleshooting

### Processes Not Running

```bash
# Check what's wrong
pm2 logs <process-name>

# Restart all
pm2 restart all
pm2 save
```

### PM2 Not Surviving Reboot

```bash
# Re-configure startup
pm2 startup
# (Follow printed command)
pm2 save
```

### Everything Stopped

```bash
# Start fresh
pm2 kill
npm run pm2:ensure
pm2 save
```

## Verification

Run the check script to verify everything:

```bash
npm run pm2:check
```

You should see:
- ✅ PM2 is installed
- ✅ PM2 startup is configured
- ✅ All critical processes running
- ✅ PM2 save state is recent

## Success Criteria

✅ All processes show "online" in `pm2 status`  
✅ Closing terminals doesn't stop processes  
✅ Processes restart automatically on reboot  
✅ Dashboard shows no persistence warnings  

---

**Your bots are now persistent!** They'll keep running even if you close terminals, restart your computer, or log out.
