#!/usr/bin/env python3
"""Initialize local IP KB SQLite database."""

from __future__ import annotations

import argparse
from pathlib import Path

from ip_kb_common import DEFAULT_DB_PATH, connect_db, ensure_schema


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Initialize local IP KB database.")
    p.add_argument("--db", type=Path, default=DEFAULT_DB_PATH, help="SQLite DB path (default: ip_kb.sqlite)")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    conn = connect_db(args.db)
    ensure_schema(conn)
    conn.close()
    print(f"[ip-kb-init] initialized {args.db.resolve()}")


if __name__ == "__main__":
    main()
