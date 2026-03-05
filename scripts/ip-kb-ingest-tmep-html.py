#!/usr/bin/env python3
"""Ingest unpacked TMEP HTML bundle into local IP KB SQLite."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from ip_kb_common import (
    DEFAULT_DB_PATH,
    SourceRef,
    chunk_text,
    connect_db,
    ensure_schema,
    insert_chunk,
    insert_document,
    upsert_source,
)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Ingest TMEP HTML directory to ip_kb.sqlite")
    p.add_argument("--db", type=Path, default=DEFAULT_DB_PATH, help="SQLite DB path")
    p.add_argument("--root", type=Path, required=True, help="Root directory containing TMEP HTML files")
    p.add_argument(
        "--source-url",
        default="https://www.uspto.gov/trademarks/guides-and-manuals/tmep-archives",
        help="Source URL to store for provenance",
    )
    p.add_argument("--version", default="latest-local-html", help="Version label")
    p.add_argument("--tier", default="authoritative", choices=["authoritative", "interpretive"], help="KB tier")
    p.add_argument("--max-chars", type=int, default=1800, help="Max chars per chunk")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    if not args.root.exists():
        raise SystemExit(f"[ip-kb-ingest-tmep-html] missing root: {args.root}")

    try:
        from bs4 import BeautifulSoup
    except Exception:
        raise SystemExit("Install dependency first: pip install beautifulsoup4")

    try:
        import html2text
    except Exception:
        raise SystemExit("Install dependency first: pip install html2text")

    conn = connect_db(args.db)
    ensure_schema(conn)
    source_id = upsert_source(
        conn,
        SourceRef(name="TMEP", version=args.version, url=args.source_url, tier=args.tier, authority_score=1.0 if args.tier == "authoritative" else 0.6),
    )

    h = html2text.HTML2Text()
    h.ignore_links = False
    h.body_width = 0

    html_files = sorted(args.root.rglob("*.html"))
    if not html_files:
        conn.close()
        raise SystemExit(f"[ip-kb-ingest-tmep-html] no html files found under {args.root}")

    docs = 0
    chunks = 0
    for idx, fpath in enumerate(html_files, start=1):
        raw = fpath.read_text(encoding="utf-8", errors="ignore")
        soup = BeautifulSoup(raw, "html.parser")
        title = soup.title.get_text(" ", strip=True) if soup.title else fpath.name
        external_id = str(fpath.relative_to(args.root))

        doc_id = insert_document(
            conn,
            source_id=source_id,
            external_id=f"TMEP::{external_id}",
            title=title,
            tier=args.tier,
            url=None,
        )
        docs += 1

        txt = h.handle(str(soup)).strip()
        ordinal = 0
        for ch in chunk_text(txt, max_chars=max(400, args.max_chars)):
            insert_chunk(
                conn,
                doc_id=doc_id,
                chunk_ordinal=ordinal,
                heading=title,
                text=ch,
                tier=args.tier,
                metadata={"path": external_id},
            )
            ordinal += 1
            chunks += 1

        if idx % 200 == 0:
            conn.commit()
            print(f"[ip-kb-ingest-tmep-html] processed {idx}/{len(html_files)} docs", file=sys.stderr)

    conn.commit()
    conn.close()
    print(f"[ip-kb-ingest-tmep-html] docs={docs} chunks={chunks}")


if __name__ == "__main__":
    main()
