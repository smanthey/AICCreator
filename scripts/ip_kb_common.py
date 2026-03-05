#!/usr/bin/env python3
"""Common helpers for local IP knowledge base scripts."""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Optional


DEFAULT_DB_PATH = Path("ip_kb.sqlite")


SCHEMA_SQL = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS sources (
  source_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT,
  url TEXT,
  tier TEXT NOT NULL DEFAULT 'authoritative',
  authority_score REAL NOT NULL DEFAULT 1.0,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documents (
  doc_id INTEGER PRIMARY KEY,
  source_id INTEGER NOT NULL,
  external_id TEXT,
  title TEXT NOT NULL,
  url TEXT,
  tier TEXT NOT NULL DEFAULT 'authoritative',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (source_id) REFERENCES sources(source_id)
);

CREATE TABLE IF NOT EXISTS chunks (
  chunk_id INTEGER PRIMARY KEY,
  doc_id INTEGER NOT NULL,
  chunk_ordinal INTEGER NOT NULL,
  heading TEXT,
  text TEXT NOT NULL,
  char_count INTEGER NOT NULL,
  tier TEXT NOT NULL DEFAULT 'authoritative',
  metadata_json TEXT,
  FOREIGN KEY (doc_id) REFERENCES documents(doc_id),
  UNIQUE(doc_id, chunk_ordinal)
);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  heading, text,
  content='chunks',
  content_rowid='chunk_id'
);

CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, heading, text) VALUES (new.chunk_id, new.heading, new.text);
END;

CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, heading, text) VALUES('delete', old.chunk_id, old.heading, old.text);
END;

CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, heading, text) VALUES('delete', old.chunk_id, old.heading, old.text);
  INSERT INTO chunks_fts(rowid, heading, text) VALUES (new.chunk_id, new.heading, new.text);
END;

CREATE TABLE IF NOT EXISTS idm_entries (
  idm_id INTEGER PRIMARY KEY,
  class_num TEXT NOT NULL,
  id_text TEXT NOT NULL,
  status TEXT,
  us_class TEXT,
  intl_class TEXT,
  notes TEXT,
  raw_row_json TEXT,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_idm_class ON idm_entries(class_num);

CREATE TABLE IF NOT EXISTS chunk_embeddings (
  embedding_id INTEGER PRIMARY KEY,
  chunk_id INTEGER NOT NULL,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  vector_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (chunk_id) REFERENCES chunks(chunk_id) ON DELETE CASCADE,
  UNIQUE (chunk_id, model)
);

CREATE INDEX IF NOT EXISTS idx_chunk_embeddings_model ON chunk_embeddings(model, created_at DESC);
"""


@dataclass(frozen=True)
class SourceRef:
    name: str
    version: str
    url: str
    tier: str = "authoritative"
    authority_score: float = 1.0


def now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


def connect_db(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path), timeout=30)
    conn.execute("PRAGMA busy_timeout=30000")
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA_SQL)
    # Backward-compatible upgrades for existing DB files.
    for stmt in [
        "ALTER TABLE sources ADD COLUMN tier TEXT NOT NULL DEFAULT 'authoritative'",
        "ALTER TABLE sources ADD COLUMN authority_score REAL NOT NULL DEFAULT 1.0",
        "ALTER TABLE documents ADD COLUMN tier TEXT NOT NULL DEFAULT 'authoritative'",
        "ALTER TABLE chunks ADD COLUMN tier TEXT NOT NULL DEFAULT 'authoritative'",
    ]:
        try:
            conn.execute(stmt)
        except sqlite3.OperationalError:
            pass
    conn.commit()


def upsert_source(conn: sqlite3.Connection, source: SourceRef) -> int:
    row = conn.execute(
        """
        SELECT source_id
        FROM sources
        WHERE name = ?
          AND IFNULL(version, '') = IFNULL(?, '')
          AND IFNULL(url, '') = IFNULL(?, '')
          AND IFNULL(tier, 'authoritative') = IFNULL(?, 'authoritative')
        ORDER BY source_id ASC
        LIMIT 1
        """,
        (source.name, source.version, source.url, source.tier),
    ).fetchone()
    if row:
        source_id = int(row[0])
        conn.execute(
            "UPDATE sources SET fetched_at = datetime('now'), authority_score = ? WHERE source_id = ?",
            (source.authority_score, source_id),
        )
        conn.commit()
        return source_id

    cur = conn.execute(
        "INSERT INTO sources(name, version, url, tier, authority_score, fetched_at) VALUES(?, ?, ?, ?, ?, datetime('now'))",
        (source.name, source.version, source.url, source.tier, source.authority_score),
    )
    conn.commit()
    return int(cur.lastrowid)


def insert_document(
    conn: sqlite3.Connection,
    *,
    source_id: int,
    external_id: str,
    title: str,
    tier: str = "authoritative",
    url: Optional[str] = None,
) -> int:
    cur = conn.execute(
        "INSERT INTO documents(source_id, external_id, title, url, tier) VALUES(?, ?, ?, ?, ?)",
        (source_id, external_id, title, url, tier),
    )
    return int(cur.lastrowid)


def insert_chunk(
    conn: sqlite3.Connection,
    *,
    doc_id: int,
    chunk_ordinal: int,
    heading: str,
    text: str,
    tier: str = "authoritative",
    metadata: Optional[dict] = None,
) -> None:
    conn.execute(
        """
        INSERT OR IGNORE INTO chunks(doc_id, chunk_ordinal, heading, text, char_count, tier, metadata_json)
        VALUES(?, ?, ?, ?, ?, ?, ?)
        """,
        (doc_id, chunk_ordinal, heading, text, len(text), tier, json.dumps(metadata or {})),
    )


def chunk_text(text: str, max_chars: int = 3500) -> Iterable[str]:
    parts = [p.strip() for p in text.split("\n\n") if p.strip()]
    buf = ""
    out = []
    for p in parts:
        if len(buf) + len(p) + 2 <= max_chars:
            buf = (buf + "\n\n" + p).strip()
        else:
            if buf:
                out.append(buf)
            buf = p
    if buf:
        out.append(buf)
    return out


def upsert_chunk_embedding(
    conn: sqlite3.Connection,
    *,
    chunk_id: int,
    model: str,
    vector: list[float],
) -> None:
    conn.execute(
        """
        INSERT INTO chunk_embeddings(chunk_id, model, dimensions, vector_json)
        VALUES(?, ?, ?, ?)
        ON CONFLICT(chunk_id, model) DO UPDATE SET
          dimensions = excluded.dimensions,
          vector_json = excluded.vector_json,
          created_at = datetime('now')
        """,
        (chunk_id, model, len(vector), json.dumps(vector)),
    )
