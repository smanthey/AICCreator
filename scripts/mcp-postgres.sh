#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Ensure node/npm are found when Cursor spawns with minimal PATH
export PATH="/usr/local/bin:/opt/homebrew/bin:${PATH:-}"

if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ROOT_DIR/.env"
  set +a
fi

HOST="${POSTGRES_HOST:-${CLAW_DB_HOST:-127.0.0.1}}"
PORT="${POSTGRES_PORT:-${CLAW_DB_PORT:-15432}}"
USER="${POSTGRES_USER:-${CLAW_DB_USER:-claw}}"
PASS="${POSTGRES_PASSWORD:-${CLAW_DB_PASSWORD:-}}"
DB="${POSTGRES_DB:-${CLAW_DB_NAME:-claw_architect}}"

if [[ "${1:-}" == "--healthcheck" ]]; then
  if [[ -z "$PASS" ]]; then
    echo "[mcp-postgres] missing POSTGRES_PASSWORD/CLAW_DB_PASSWORD" >&2
    exit 1
  fi
  echo "[mcp-postgres] ok host=$HOST port=$PORT db=$DB user=$USER"
  exit 0
fi

if [[ -z "$PASS" ]]; then
  echo "[mcp-postgres] missing POSTGRES_PASSWORD/CLAW_DB_PASSWORD" >&2
  exit 1
fi

# URL-encode password so special characters (@, :, /, etc.) don't break the URI
PASS_ENC=$(node -e "console.log(encodeURIComponent(process.argv[1]))" "$PASS")
URI="postgresql://${USER}:${PASS_ENC}@${HOST}:${PORT}/${DB}"
BIN="$ROOT_DIR/node_modules/.bin/mcp-server-postgres"
INDEX_JS="$ROOT_DIR/node_modules/@modelcontextprotocol/server-postgres/dist/index.js"
if [[ ! -f "$INDEX_JS" ]]; then
  echo "[mcp-postgres] missing server at $INDEX_JS. Run: npm install" >&2
  exit 1
fi

# Run with node explicitly so it works when Cursor spawns with minimal PATH
# MCP stdio transport expects pure JSON-RPC on stdout.
exec node "$INDEX_JS" "$URI"
