#!/usr/bin/env bash
set -euo pipefail

# Backup Gitea data directory on NAS.
# Usage:
#   bash scripts/gitea-nas-backup.sh
# Optional env:
#   GITEA_DATA_DIR=/volume1/docker/gitea
#   GITEA_BACKUP_DIR=/volume1/backups/gitea

GITEA_DATA_DIR="${GITEA_DATA_DIR:-/volume1/docker/gitea}"
GITEA_BACKUP_DIR="${GITEA_BACKUP_DIR:-/volume1/backups/gitea}"
TS="$(date +%Y%m%d-%H%M%S)"
OUT="$GITEA_BACKUP_DIR/gitea-data-$TS.tar.gz"

mkdir -p "$GITEA_BACKUP_DIR"

if [[ ! -d "$GITEA_DATA_DIR" ]]; then
  echo "[error] missing Gitea data dir: $GITEA_DATA_DIR"
  exit 1
fi

# Optional: pause writes briefly for consistency by stopping container
if docker ps --format '{{.Names}}' | grep -q '^gitea$'; then
  docker stop gitea >/dev/null
  STOPPED=1
else
  STOPPED=0
fi

trap 'if [[ "${STOPPED:-0}" -eq 1 ]]; then docker start gitea >/dev/null || true; fi' EXIT

tar -czf "$OUT" -C "$GITEA_DATA_DIR" .

if [[ "$STOPPED" -eq 1 ]]; then
  docker start gitea >/dev/null
  STOPPED=0
fi

echo "[ok] backup written: $OUT"
ls -lh "$OUT"
