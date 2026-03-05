#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="${HOME:-$HOME}"
WORKSPACE="$ROOT_DIR"
REPOS="${CLAW_REPOS:-$HOME/claw-repos}"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"

if [[ "${1:-}" == "--healthcheck" ]]; then
  [[ -d "$ROOT" ]]      || { echo "[mcp-filesystem] missing dir: $ROOT" >&2; exit 1; }
  [[ -d "$WORKSPACE" ]] || { echo "[mcp-filesystem] missing dir: $WORKSPACE" >&2; exit 1; }
  [[ -d "$REPOS" ]]     || echo "[mcp-filesystem] optional dir missing: $REPOS" >&2
  [[ -d "$CODEX_HOME" ]] || echo "[mcp-filesystem] optional dir missing: $CODEX_HOME" >&2
  echo "[mcp-filesystem] ok"
  exit 0
fi

ROOTS=("$WORKSPACE" "$ROOT")
[[ -d "$REPOS" ]]     && ROOTS+=("$REPOS")
[[ -d "$CODEX_HOME" ]] && ROOTS+=("$CODEX_HOME")
exec npx -y @modelcontextprotocol/server-filesystem "${ROOTS[@]}"
