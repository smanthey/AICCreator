#!/usr/bin/env bash
set -euo pipefail

# Bootstraps Gitea on NAS using Docker Compose
# Usage:
#   bash scripts/gitea-nas-bootstrap.sh
# Optional env:
#   GITEA_HTTP_PORT=3000 GITEA_SSH_PORT=2222 GITEA_DATA_DIR=/volume1/docker/gitea

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/infra/gitea/docker-compose.gitea.yml"

if ! command -v docker >/dev/null 2>&1; then
  echo "[error] docker not found"
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "[error] docker compose plugin not found"
  exit 1
fi

export GITEA_HTTP_PORT="${GITEA_HTTP_PORT:-3000}"
export GITEA_SSH_PORT="${GITEA_SSH_PORT:-2222}"
export GITEA_DATA_DIR="${GITEA_DATA_DIR:-/volume1/docker/gitea}"
export GITEA_ROOT_URL="${GITEA_ROOT_URL:-http://$(hostname -I 2>/dev/null | awk '{print $1}'):${GITEA_HTTP_PORT}/}"
export GITEA_SSH_DOMAIN="${GITEA_SSH_DOMAIN:-$(hostname -I 2>/dev/null | awk '{print $1}')}"

mkdir -p "$GITEA_DATA_DIR"

# Bring up service
cd "$ROOT_DIR"
docker compose -f "$COMPOSE_FILE" up -d

cat <<MSG

[ok] Gitea started.

Next steps:
1) Open: ${GITEA_ROOT_URL}
2) Create admin account (first launch)
3) In Gitea UI, create org/team for agents
4) Add each agent SSH public key to the service account user

SSH clone format:
  ssh://git@${GITEA_SSH_DOMAIN}:${GITEA_SSH_PORT}/<owner>/<repo>.git

Health check:
  docker ps --filter name=gitea
  curl -I ${GITEA_ROOT_URL}

MSG
