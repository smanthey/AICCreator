#!/usr/bin/env python3
"""Generate chunk embeddings using Ollama (default: mxbai-embed-large)."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from ip_kb_common import DEFAULT_DB_PATH, connect_db, ensure_schema, upsert_chunk_embedding


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Embed KB chunks with Ollama")
    p.add_argument("--db", type=Path, default=DEFAULT_DB_PATH, help="SQLite DB path")
    p.add_argument("--model", default="mxbai-embed-large", help="Ollama embedding model")
    p.add_argument("--base-url", default="http://127.0.0.1:11434", help="Ollama base URL")
    p.add_argument("--limit", type=int, default=500, help="Max chunks per run")
    p.add_argument("--tier", choices=["all", "authoritative", "interpretive"], default="all", help="Filter tier")
    p.add_argument("--reembed", action="store_true", help="Re-embed even if vector exists")
    return p.parse_args()


def fetch_embedding(base_url: str, model: str, text: str) -> list[float]:
    import requests

    payload = {"model": model, "input": text}
    r = requests.post(f"{base_url.rstrip('/')}/api/embed", json=payload, timeout=120)
    if r.status_code == 404:
        payload = {"model": model, "prompt": text}
        r = requests.post(f"{base_url.rstrip('/')}/api/embeddings", json=payload, timeout=120)
    r.raise_for_status()
    data = r.json()

    if isinstance(data.get("embeddings"), list) and data["embeddings"]:
        emb = data["embeddings"][0]
    else:
        emb = data.get("embedding")

    if not isinstance(emb, list) or not emb:
        raise RuntimeError(f"Invalid embedding response: {json.dumps(data)[:300]}")
    return [float(x) for x in emb]


def main() -> None:
    args = parse_args()
    try:
        import requests  # noqa: F401
    except Exception:
        raise SystemExit("Install dependency first: pip install requests")

    conn = connect_db(args.db)
    ensure_schema(conn)

    if args.reembed:
        where_embed = ""
    else:
        where_embed = "AND ce.chunk_id IS NULL"

    rows = conn.execute(
        f"""
        SELECT c.chunk_id, c.heading, c.text
        FROM chunks c
        LEFT JOIN chunk_embeddings ce
          ON ce.chunk_id = c.chunk_id AND ce.model = ?
        WHERE (? = 'all' OR COALESCE(c.tier, 'authoritative') = ?)
          {where_embed}
        ORDER BY c.chunk_id ASC
        LIMIT ?
        """,
        (args.model, args.tier, args.tier, max(1, args.limit)),
    ).fetchall()

    if not rows:
        print("[ip-kb-embed] no chunks to embed")
        conn.close()
        return

    done = 0
    for chunk_id, heading, text in rows:
        content = f"{heading or ''}\n\n{text or ''}".strip()
        vec = fetch_embedding(args.base_url, args.model, content)
        upsert_chunk_embedding(conn, chunk_id=int(chunk_id), model=args.model, vector=vec)
        done += 1
        if done % 20 == 0:
            conn.commit()
            print(f"[ip-kb-embed] embedded {done}/{len(rows)}")

    conn.commit()
    conn.close()
    print(f"[ip-kb-embed] model={args.model} embedded={done}")


if __name__ == "__main__":
    main()
