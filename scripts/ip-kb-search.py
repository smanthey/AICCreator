#!/usr/bin/env python3
"""FTS search utility for local IP KB database."""

from __future__ import annotations

import argparse
import re
from pathlib import Path

from ip_kb_common import DEFAULT_DB_PATH, connect_db, ensure_schema


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Search local IP KB using SQLite FTS5.")
    p.add_argument("query", help="FTS query (e.g. 'section NEAR/2 2(d)')")
    p.add_argument("--db", type=Path, default=DEFAULT_DB_PATH, help="SQLite DB path")
    p.add_argument("--limit", type=int, default=10, help="Result limit")
    p.add_argument("--tier", choices=["all", "authoritative", "interpretive"], default="all", help="Filter by KB tier")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    conn = connect_db(args.db)
    ensure_schema(conn)
    sql = """
        SELECT d.title, c.heading, snippet(chunks_fts, 1, '[', ']', ' ... ', 14) AS snip
        FROM chunks_fts
        JOIN chunks c ON c.chunk_id = chunks_fts.rowid
        JOIN documents d ON d.doc_id = c.doc_id
        JOIN sources s ON s.source_id = d.source_id
        WHERE chunks_fts MATCH ?
          AND (? = 'all' OR COALESCE(c.tier, d.tier, s.tier, 'authoritative') = ?)
        LIMIT ?
        """
    q = args.query
    try:
        rows = conn.execute(sql, (q, args.tier, args.tier, max(1, args.limit))).fetchall()
    except Exception:
        tokens = [t for t in re.split(r"\s+", q.strip()) if t]
        sanitized = [t.replace('"', "") for t in tokens]
        escaped = " ".join(f"\"{t}\"" for t in sanitized)
        rows = conn.execute(sql, (escaped, args.tier, args.tier, max(1, args.limit))).fetchall()
    conn.close()

    if not rows:
        print("[ip-kb-search] no matches")
        return

    for idx, (title, heading, snip) in enumerate(rows, start=1):
        print(f"\n[{idx}] {title}\n{heading}\n{snip}")


if __name__ == "__main__":
    main()
