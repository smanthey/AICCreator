#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="/usr/local/bin:/opt/homebrew/bin:${PATH:-}"
if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ROOT_DIR/.env"
  set +a
fi

if [[ -z "${GITHUB_PERSONAL_ACCESS_TOKEN:-}" && -n "${GITHUB_TOKEN:-}" ]]; then
  export GITHUB_PERSONAL_ACCESS_TOKEN="$GITHUB_TOKEN"
fi

if [[ "${1:-}" == "--healthcheck" ]]; then
  if [[ -z "${GITHUB_PERSONAL_ACCESS_TOKEN:-}" ]]; then
    echo "[mcp-github] warning: GITHUB_PERSONAL_ACCESS_TOKEN/GITHUB_TOKEN not set (server will start but API calls may fail)" >&2
  fi
  echo "[mcp-github] ok"
  exit 0
fi

exec npx -y @modelcontextprotocol/server-github
