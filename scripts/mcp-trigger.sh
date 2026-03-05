#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Ensure npx/node are found when Cursor spawns with minimal PATH
export PATH="/usr/local/bin:/opt/homebrew/bin:${PATH:-}"

if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ROOT_DIR/.env"
  set +a
fi

if [[ "${1:-}" == "--healthcheck" ]]; then
  if command -v npx &>/dev/null; then
    echo "[mcp-trigger] ok (npx available)"
    exit 0
  fi
  echo "[mcp-trigger] npx not found" >&2
  exit 1
fi

cd "$ROOT_DIR"
exec npx trigger.dev@4.4.1 mcp "$@"
