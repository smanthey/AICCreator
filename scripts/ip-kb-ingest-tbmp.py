#!/usr/bin/env python3
"""Ingest TBMP PDF into local IP KB SQLite."""

from __future__ import annotations

import argparse
import re
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
    p = argparse.ArgumentParser(description="Ingest TBMP PDF to ip_kb.sqlite")
    p.add_argument("--db", type=Path, default=DEFAULT_DB_PATH, help="SQLite DB path")
    p.add_argument("--pdf", type=Path, required=True, help="TBMP PDF path")
    p.add_argument(
        "--source-url",
        default="https://www.uspto.gov/sites/default/files/documents/tbmp-Master-June2025.pdf",
        help="Source URL to store for provenance",
    )
    p.add_argument("--version", default="June 2025", help="Version label")
    p.add_argument("--tier", default="authoritative", choices=["authoritative", "interpretive"], help="KB tier")
    p.add_argument("--max-chars", type=int, default=1800, help="Max chars per chunk")
    return p.parse_args()


HEADING_PATTERNS = [
    re.compile(r"^\d{3,4}(?:\.\d+)*\s+[A-Z].*"),
    re.compile(r"^[A-Z][A-Z\s,&\-]{8,}$"),
]


def is_heading(line: str) -> bool:
    s = line.strip()
    if not s:
        return False
    return any(p.match(s) for p in HEADING_PATTERNS)


def chunk_tbmp_page(page_text: str, max_chars: int) -> list[tuple[str, str]]:
    lines = [ln.strip() for ln in page_text.splitlines()]
    sections: list[tuple[str, list[str]]] = []
    current_heading = "TBMP"
    current_body: list[str] = []

    for ln in lines:
        if not ln:
            continue
        if is_heading(ln):
            if current_body:
                sections.append((current_heading, current_body))
                current_body = []
            current_heading = ln
        else:
            current_body.append(ln)
    if current_body:
        sections.append((current_heading, current_body))

    out: list[tuple[str, str]] = []
    for heading, body_lines in sections:
        text = "\n".join(body_lines).strip()
        if not text:
            continue
        for part in chunk_text(text, max_chars=max_chars):
            out.append((heading, part))
    return out


def main() -> None:
    args = parse_args()

    if not args.pdf.exists():
        raise SystemExit(f"[ip-kb-ingest-tbmp] missing pdf: {args.pdf}")

    try:
        from pypdf import PdfReader
    except Exception:
        raise SystemExit("Install dependency first: pip install pypdf")

    conn = connect_db(args.db)
    ensure_schema(conn)

    source_id = upsert_source(
        conn,
        SourceRef(name="TBMP", version=args.version, url=args.source_url, tier=args.tier, authority_score=1.0 if args.tier == "authoritative" else 0.6),
    )
    doc_id = insert_document(
        conn,
        source_id=source_id,
        external_id=f"TBMP-{args.version}",
        title=f"TBMP ({args.version})",
        tier=args.tier,
        url=args.source_url,
    )

    reader = PdfReader(str(args.pdf))
    ordinal = 0
    pages = len(reader.pages)
    for i, page in enumerate(reader.pages, start=1):
        page_text = (page.extract_text() or "").strip()
        if not page_text:
            continue
        for heading, ch in chunk_tbmp_page(page_text, max_chars=max(400, args.max_chars)):
            insert_chunk(
                conn,
                doc_id=doc_id,
                chunk_ordinal=ordinal,
                heading=f"{heading} (p.{i})",
                text=ch,
                tier=args.tier,
                metadata={"page": i, "source": "TBMP", "heading": heading},
            )
            ordinal += 1
        if i % 25 == 0:
            conn.commit()
            print(f"[ip-kb-ingest-tbmp] processed {i}/{pages} pages", file=sys.stderr)

    conn.commit()
    conn.close()
    print(f"[ip-kb-ingest-tbmp] doc_id={doc_id} chunks={ordinal} pages={pages}")


if __name__ == "__main__":
    main()
