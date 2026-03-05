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

if [[ "${1:-}" == "--healthcheck" ]]; then
  npx -y @upstash/context7-mcp --help >/dev/null
  echo "[mcp-context7] ok"
  exit 0
fi

if [[ -n "${CONTEXT7_API_KEY:-}" ]]; then
  exec npx -y @upstash/context7-mcp --api-key "$CONTEXT7_API_KEY"
fi

exec npx -y @upstash/context7-mcp
