# NAS Backup System (Pre-Dedupe Gate)

## Goal

Before any dedupe removal, ensure each device has a verified NAS copy and a central ledger proving coverage.

## New Commands

- `npm run backup:to:nas`
- `npm run backup:verify:nas`

## How it works

### 1) Device backup lane (`backup:to:nas`)

- Scans `BACKUP_SOURCE_ROOTS`
- Copies files to `NAS_BACKUP_ROOT/devices/<device>/<root_name>/...`
- Verifies copied files by SHA-256
- Writes central ledger: `NAS_BACKUP_ROOT/_backup_ledger/<device>.jsonl`
- Writes run report in `scripts/reports/*-backup-to-nas.json`

### 2) Central verification lane (`backup:verify:nas`)

- Reads latest ledger slice per required device
- Verifies destination file existence
- Enforces freshness window (`BACKUP_VERIFY_FRESH_HOURS`)
- Detects duplicate SHA groups in backup set
- Writes report: `scripts/reports/*-backup-verify-nas.json`

## Dedupe safety gate

`scripts/dedupe-quarantine.js --execute` now blocks unless latest backup verification is green.

- Override only if absolutely needed:
  - `--force-without-backup`
- Gate toggle:
  - `DEDUPE_REQUIRE_BACKUP_VERIFY=true` (default)

## PM2 schedules

### Main background profile

- `claw-backup-to-nas` every 2 hours
- `claw-backup-verify-nas` every 2 hours (offset)

### AI satellites

- `<satellite>-backup-to-nas` every 2 hours

### i7 profile

- `<satellite>-backup-to-nas` every 2 hours

## Required env per device

- `NAS_BACKUP_ROOT` (example: `/Volumes/home/Storage/_claw_backup`)
- `BACKUP_DEVICE_NAME` (unique stable name)
- `BACKUP_SOURCE_ROOTS` (pipe-separated roots)

Example:

```bash
BACKUP_DEVICE_NAME=PRIMARY_DEV_MACHINE
NAS_BACKUP_ROOT=/Volumes/home/Storage/_claw_backup
BACKUP_SOURCE_ROOTS=$HOME/Downloads|$HOME/Dropbox|$HOME/claw-repos
```

## Rollout

Main:

```bash
cd ~/claw-architect
pm2 reload ecosystem.background.config.js --update-env
pm2 save
```

M1 satellite:

```bash
cd ~/claw-architect
SATELLITE_NAME=m1-laptop npm run pm2:ai-satellite:reload
pm2 save
```

i7:

```bash
cd ~/claw-architect
SATELLITE_NAME=i7-desktop npm run pm2:i7:reload
pm2 save
```

