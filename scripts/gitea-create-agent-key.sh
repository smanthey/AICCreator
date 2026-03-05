#!/usr/bin/env bash
set -euo pipefail

# Create a dedicated SSH key per agent/device for Gitea.
# Usage:
#   bash scripts/gitea-create-agent-key.sh m1-laptop-ai

NAME="${1:-}"
if [[ -z "$NAME" ]]; then
  echo "Usage: $0 <agent-name>"
  exit 1
fi

KEY_DIR="$HOME/.ssh"
KEY_PATH="$KEY_DIR/id_ed25519_${NAME}_gitea"
mkdir -p "$KEY_DIR"
chmod 700 "$KEY_DIR"

if [[ -f "$KEY_PATH" ]]; then
  echo "[warn] key already exists: $KEY_PATH"
else
  ssh-keygen -t ed25519 -C "${NAME}@gitea-local" -f "$KEY_PATH" -N ""
  chmod 600 "$KEY_PATH"
  chmod 644 "$KEY_PATH.pub"
fi

cat <<MSG

[ok] Agent key ready:
  private: $KEY_PATH
  public:  $KEY_PATH.pub

Add this public key in Gitea:
- User Settings -> SSH / GPG Keys -> Add Key

Public key:
$(cat "$KEY_PATH.pub")

MSG
