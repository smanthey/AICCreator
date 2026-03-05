#!/usr/bin/env python3
"""
Index one or more local paths with jCodeMunch (same as MCP index_folder).
Usage:
  python scripts/jcodemunch-index-paths.py [path1 [path2 ...]]
  ./scripts/mcp-index-everything.sh | python scripts/jcodemunch-index-paths.py
Run with repo venv: .venv-openclaw-tools/bin/python scripts/jcodemunch-index-paths.py /path/to/repo
"""
import sys
from pathlib import Path

# Allow running from repo root; venv has jcodemunch_mcp installed
try:
    from jcodemunch_mcp.tools.index_folder import index_folder
except ImportError:
    sys.exit("jcodemunch_mcp not found. Run: .venv-openclaw-tools/bin/python (or pip install jcodemunch-mcp)")


def main():
    if len(sys.argv) > 1:
        paths = [p.strip() for p in sys.argv[1:] if p.strip()]
    else:
        paths = [line.strip() for line in sys.stdin if line.strip()]

    if not paths:
        print("Usage: jcodemunch-index-paths.py <path1> [path2 ...]", file=sys.stderr)
        print("   or: ./scripts/mcp-index-everything.sh | jcodemunch-index-paths.py", file=sys.stderr)
        sys.exit(1)

    use_ai = "--ai" in paths
    if use_ai:
        paths = [p for p in paths if p != "--ai"]

    ok = 0
    fail = 0
    for path in paths:
        path = Path(path).expanduser().resolve()
        if not path.exists():
            print(f"SKIP (missing): {path}", file=sys.stderr)
            fail += 1
            continue
        if not path.is_dir():
            print(f"SKIP (not dir): {path}", file=sys.stderr)
            fail += 1
            continue
        result = index_folder(str(path), use_ai_summaries=use_ai)
        if result.get("success"):
            repo = result.get("repo", "?")
            fc = result.get("file_count", 0)
            sc = result.get("symbol_count", 0)
            print(f"OK  {repo}  files={fc}  symbols={sc}  path={path}")
            ok += 1
        else:
            print(f"FAIL {path}  error={result.get('error', result)}", file=sys.stderr)
            fail += 1

    print(f"\nIndexed {ok} repos, {fail} failed/skipped.", file=sys.stderr)
    sys.exit(0 if fail == 0 else 1)


if __name__ == "__main__":
    main()
