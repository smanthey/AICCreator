#!/usr/bin/env bash
set -euo pipefail

# Restore Gitea data from a backup tarball.
# Usage:
#   bash scripts/gitea-nas-restore.sh /volume1/backups/gitea/gitea-data-YYYYMMDD-HHMMSS.tar.gz

BACKUP_TAR="${1:-}"
GITEA_DATA_DIR="${GITEA_DATA_DIR:-/volume1/docker/gitea}"

if [[ -z "$BACKUP_TAR" || ! -f "$BACKUP_TAR" ]]; then
  echo "Usage: $0 <backup_tar.gz>"
  exit 1
fi

mkdir -p "$GITEA_DATA_DIR"

docker stop gitea >/dev/null 2>&1 || true

# wipe current data and restore
find "$GITEA_DATA_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
tar -xzf "$BACKUP_TAR" -C "$GITEA_DATA_DIR"

docker start gitea >/dev/null 2>&1 || true

echo "[ok] restore complete from $BACKUP_TAR"
