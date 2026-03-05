# System Cleanup + i7 Utilization

## 1) Automatic cleanup on all devices

New script:

- `npm run system:cleanup`

What it does (safe defaults):

- Deletes old files from:
  - `logs/`
  - `reports/`
  - `scripts/reports/`
- Truncates oversized PM2 log files in `~/.pm2/logs`
- Removes stale temp files matching claw/codex/playwright patterns in system temp dir
- Runs `VACUUM` on local sqlite files if present (`claw_architect.db`, `ip_kb.sqlite`)
- Optionally restarts online PM2 processes that exceed a memory threshold

Key env knobs:

- `SYSTEM_CLEANUP_RETENTION_DAYS` (default `14`)
- `SYSTEM_CLEANUP_REPORT_RETENTION_DAYS` (default same as retention)
- `SYSTEM_CLEANUP_PM2_LOG_MAX_MB` (default `150`)
- `SYSTEM_CLEANUP_PM2_TRUNCATE_MB` (default `20`)
- `SYSTEM_CLEANUP_PM2_RESTART_HIGH_MEM` (default `true`)
- `SYSTEM_CLEANUP_PM2_RESTART_MB` (default `1024`)

### Scheduled via PM2

- Main background profile: `claw-system-cleanup` every 6 hours (`15 */6 * * *`)
- AI satellites: `<satellite>-system-cleanup` every 6 hours (`20 */6 * * *`)

Apply:

```bash
cd ~/claw-architect
pm2 reload ecosystem.background.config.js --update-env
pm2 save
```

On M1 satellites:

```bash
cd ~/claw-architect
SATELLITE_NAME=m1-laptop npm run pm2:ai-satellite:reload
pm2 save
```

## 2) i7 desktop role (always-on hardwired)

Dedicated profile added:

- `ecosystem.i7-satellite.config.js`

Processes:

- `<name>-worker-nas` (infra/deterministic/io-heavy/cpu-heavy queue lane)
- `<name>-worker-io` (general io_light lane)
- `<name>-system-cleanup` (every 6h)

Start on i7:

```bash
cd ~/claw-architect
SATELLITE_NAME=i7-desktop npm run pm2:i7:start
pm2 save
pm2 status
```

This makes the i7 an always-on throughput node while M-series devices focus more on AI lanes.
