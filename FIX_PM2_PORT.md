# Fix PM2 Port Conflict

## Problem
PM2 process `claw-prompt-oracle` is showing as "errored" because port 3031 is already in use by the nohup process.

## Solution

**Step 1: Kill the nohup process using port 3031**
```bash
kill $(lsof -ti :3031)
```

**Step 2: Verify port is free**
```bash
lsof -i :3031
# Should show nothing
```

**Step 3: Restart PM2 process**
```bash
pm2 restart claw-prompt-oracle
```

**Step 4: Check it's running**
```bash
pm2 list | grep claw-prompt-oracle
pm2 logs claw-prompt-oracle --lines 20
```

**Step 5: Verify health**
```bash
curl http://localhost:3031/health
```

---

## Alternative: Stop nohup and use PM2 only

If you want to use PM2 (recommended), make sure nohup isn't running:

```bash
# Kill any process on port 3031
kill $(lsof -ti :3031)

# Stop PM2 process
pm2 stop claw-prompt-oracle

# Delete and recreate with PM2
pm2 delete claw-prompt-oracle
pm2 start scripts/bot-commerce.js --name claw-prompt-oracle --env COMMERCE_PORT=3031

# Save PM2 config
pm2 save
```

---

## Quick Fix (One-liner)

```bash
kill $(lsof -ti :3031) && sleep 1 && pm2 restart claw-prompt-oracle
```
