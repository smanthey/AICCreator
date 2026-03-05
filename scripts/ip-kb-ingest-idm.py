#!/usr/bin/env python3
"""Ingest USPTO ID Manual rows into local IP KB SQLite."""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Dict, List
from urllib.parse import urlencode

from ip_kb_common import DEFAULT_DB_PATH, SourceRef, connect_db, ensure_schema, upsert_source


BASE = "https://idm-tmng.uspto.gov/id-master-list-public.html"


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Ingest USPTO ID Manual by class into ip_kb.sqlite")
    p.add_argument("--db", type=Path, default=DEFAULT_DB_PATH, help="SQLite DB path")
    p.add_argument("--class-start", type=int, default=1, help="Starting Nice class number")
    p.add_argument("--class-end", type=int, default=45, help="Ending Nice class number")
    p.add_argument("--rows", type=int, default=200, help="Rows per page")
    p.add_argument("--sleep-ms", type=int, default=250, help="Delay between page requests")
    p.add_argument("--max-pages", type=int, default=200, help="Safety limit per class")
    p.add_argument("--tier", default="authoritative", choices=["authoritative", "interpretive"], help="KB tier for source provenance")
    p.add_argument("--from-json", type=Path, default=None, help="Optional JSON file from Playwright scraper")
    return p.parse_args()


def build_params(class_num: str, page_num: int, rows: int) -> List[tuple]:
    return [
        ("class-num", class_num),
        ("class-valid", "true"),
        ("pageNum", str(page_num)),
        ("rows", str(rows)),
        ("search-by", "all"),
        ("status", "A"),
        ("status", "D"),
        ("status", "M"),
        ("status", "X"),
        ("status-all", "All"),
    ]


def parse_rows(html: str) -> List[Dict[str, str]]:
    try:
        from bs4 import BeautifulSoup
    except Exception:
        raise SystemExit("Install dependency first: pip install beautifulsoup4")

    soup = BeautifulSoup(html, "html.parser")
    table = soup.find("table")
    if not table:
        return []

    headers = [th.get_text(" ", strip=True) for th in table.find_all("th")]
    if not headers:
        return []

    out: List[Dict[str, str]] = []
    trs = table.find_all("tr")
    for tr in trs[1:]:
        cells = [td.get_text(" ", strip=True) for td in tr.find_all("td")]
        if not cells:
            continue
        row = dict(zip(headers, cells))
        out.append(row)
    return out


def extract_id_text(row: Dict[str, str]) -> str:
    candidates = [
        "Identification",
        "ID",
        "Description",
        "Identification Text",
    ]
    for key in candidates:
        val = row.get(key)
        if val:
            return val.strip()
    return ""


def insert_rows(conn, rows: List[Dict[str, str]]) -> int:
    inserted = 0
    for item in rows:
        if "row" in item:
            class_num = str(item.get("class_num") or "").zfill(3)
            row = item.get("row") or {}
        else:
            row = item
            class_num = str(row.get("Class") or row.get("Intl Class") or row.get("International Class") or "").zfill(3)

        id_text = extract_id_text(row)
        if not id_text:
            continue

        status = (row.get("Status") or "").strip()
        us_class = (row.get("US Class") or row.get("U.S. Class") or "").strip()
        intl_class = (row.get("Intl Class") or row.get("International Class") or class_num).strip()
        notes = (row.get("Notes") or "").strip()
        class_num = (class_num or intl_class or "000").zfill(3)

        conn.execute(
            """
            INSERT INTO idm_entries(class_num, id_text, status, us_class, intl_class, notes, raw_row_json)
            VALUES(?, ?, ?, ?, ?, ?, ?)
            """,
            (class_num, id_text, status, us_class, intl_class, notes, json.dumps(row)),
        )
        inserted += 1

    conn.commit()
    return inserted


def main() -> None:
    args = parse_args()
    try:
        import requests
    except Exception:
        raise SystemExit("Install dependency first: pip install requests")

    conn = connect_db(args.db)
    ensure_schema(conn)
    upsert_source(
        conn,
        SourceRef(name="IDM", version="live-web", url=BASE, tier=args.tier, authority_score=1.0 if args.tier == "authoritative" else 0.6),
    )

    total_inserted = 0

    if args.from_json:
        if not args.from_json.exists():
            raise SystemExit(f"--from-json path not found: {args.from_json}")
        try:
            parsed = json.loads(args.from_json.read_text(encoding="utf-8"))
        except Exception as exc:
            raise SystemExit(f"Failed to parse JSON {args.from_json}: {exc}")
        if not isinstance(parsed, list):
            raise SystemExit("--from-json must be a JSON array")
        total_inserted = insert_rows(conn, parsed)
        conn.close()
        print(f"[ip-kb-ingest-idm] total_inserted={total_inserted} from-json={args.from_json}")
        return

    session = requests.Session()
    session.headers.update({"User-Agent": "claw-architect-ip-kb/1.0"})

    for cls in range(args.class_start, args.class_end + 1):
        class_num = f"{cls:03d}"
        class_inserted = 0
        for page in range(1, args.max_pages + 1):
            params = build_params(class_num, page, args.rows)
            url = f"{BASE}?{urlencode(params)}"
            try:
                resp = session.get(BASE, params=params, timeout=45)
                resp.raise_for_status()
            except Exception as exc:
                print(f"[ip-kb-ingest-idm] class={class_num} page={page} request failed: {exc}", file=sys.stderr)
                break

            rows = parse_rows(resp.text)
            if not rows:
                break

            normalized = [{"class_num": class_num, "row": row} for row in rows]
            inserted_now = insert_rows(conn, normalized)
            class_inserted += inserted_now
            total_inserted += inserted_now
            if len(rows) < args.rows:
                break
            time.sleep(max(0, args.sleep_ms) / 1000.0)

        print(f"[ip-kb-ingest-idm] class={class_num} inserted={class_inserted}")

    conn.close()
    if total_inserted == 0:
        print(
            "[ip-kb-ingest-idm] total_inserted=0 (no server-side table rows discovered; "
            "IDM may require dynamic API/browser session in current deployment)"
        )
    else:
        print(f"[ip-kb-ingest-idm] total_inserted={total_inserted}")


if __name__ == "__main__":
    main()
