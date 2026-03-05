#!/usr/bin/env bash
set -euo pipefail

# Configure current repo to push to local Gitea as primary/backup remote.
# Usage:
#   bash scripts/gitea-configure-remote.sh <owner> <repo> [remote_name]
# Example:
#   bash scripts/gitea-configure-remote.sh agents claw-architect gitea

OWNER="${1:-}"
REPO="${2:-}"
REMOTE_NAME="${3:-gitea}"

if [[ -z "$OWNER" || -z "$REPO" ]]; then
  echo "Usage: $0 <owner> <repo> [remote_name]"
  exit 1
fi

GITEA_HOST="${GITEA_HOST:-192.168.1.164}"
GITEA_SSH_PORT="${GITEA_SSH_PORT:-2222}"
AGENT_KEY_PATH="${AGENT_KEY_PATH:-$HOME/.ssh/id_ed25519}"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "[error] not inside a git repo"
  exit 1
fi

URL="ssh://git@${GITEA_HOST}:${GITEA_SSH_PORT}/${OWNER}/${REPO}.git"

if git remote get-url "$REMOTE_NAME" >/dev/null 2>&1; then
  git remote set-url "$REMOTE_NAME" "$URL"
else
  git remote add "$REMOTE_NAME" "$URL"
fi

SSH_CONFIG_FILE="$HOME/.ssh/config"
mkdir -p "$HOME/.ssh"
touch "$SSH_CONFIG_FILE"
chmod 600 "$SSH_CONFIG_FILE"

HOST_ALIAS="gitea-local"
if ! grep -q "^Host ${HOST_ALIAS}$" "$SSH_CONFIG_FILE" 2>/dev/null; then
  cat >> "$SSH_CONFIG_FILE" <<CFG

Host ${HOST_ALIAS}
  HostName ${GITEA_HOST}
  Port ${GITEA_SSH_PORT}
  User git
  IdentityFile ${AGENT_KEY_PATH}
  IdentitiesOnly yes

CFG
fi

cat <<MSG

[ok] remote configured:
  ${REMOTE_NAME} -> ${URL}

Suggested first push:
  git push -u ${REMOTE_NAME} HEAD

Test SSH:
  ssh -T ${HOST_ALIAS}

MSG
