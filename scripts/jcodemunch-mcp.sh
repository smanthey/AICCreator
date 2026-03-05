#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_BIN="$ROOT_DIR/.venv-openclaw-tools/bin/jcodemunch-mcp"

if [[ "${1:-}" == "--healthcheck" ]]; then
  if [[ -x "$VENV_BIN" ]]; then
    echo "[jcodemunch] ok (venv)"
    exit 0
  fi
  if command -v jcodemunch-mcp &>/dev/null; then
    echo "[jcodemunch] ok (path)"
    exit 0
  fi
  echo "[jcodemunch] not found: install with pip (e.g. pip install jcodemunch-mcp) or create .venv-openclaw-tools with jcodemunch-mcp" >&2
  exit 1
fi

if [[ -x "$VENV_BIN" ]]; then
  exec "$VENV_BIN" "$@"
fi

if command -v jcodemunch-mcp &>/dev/null; then
  exec jcodemunch-mcp "$@"
fi

echo "[jcodemunch] jcodemunch-mcp not found. Install with: pip install jcodemunch-mcp (Python 3.10+)" >&2
exit 1

