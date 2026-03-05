-- Migration 028: perceptual hashes for near-duplicate media detection.
-- Deterministic first-pass hashing layer (no LLM required).

CREATE TABLE IF NOT EXISTS media_hashes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_index_id  UUID NOT NULL UNIQUE REFERENCES file_index(id) ON DELETE CASCADE,

  method         TEXT NOT NULL DEFAULT 'ffmpeg-gray-9x8-8x8',
  dhash_hex      CHAR(16) NOT NULL,
  ahash_hex      CHAR(16) NOT NULL,
  frame_second   NUMERIC(8,3) DEFAULT 1,

  extracted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_hashes_dhash ON media_hashes(dhash_hex);
CREATE INDEX IF NOT EXISTS idx_media_hashes_ahash ON media_hashes(ahash_hex);
CREATE INDEX IF NOT EXISTS idx_media_hashes_file  ON media_hashes(file_index_id);
