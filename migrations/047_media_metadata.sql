-- Migration 047: deterministic media metadata enrichment
-- Stores EXIF/ffprobe outputs so deep categorization can be rule-based first.

CREATE TABLE IF NOT EXISTS media_metadata (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_index_id     UUID NOT NULL UNIQUE REFERENCES file_index(id) ON DELETE CASCADE,

  media_kind        TEXT NOT NULL CHECK (media_kind IN ('image','video','audio','unknown')),
  tool              TEXT NOT NULL, -- exiftool | ffprobe
  metadata_json     JSONB NOT NULL DEFAULT '{}',

  width             INTEGER,
  height            INTEGER,
  duration_seconds  NUMERIC(12,3),
  codec             TEXT,
  fps               NUMERIC(8,3),

  camera_make       TEXT,
  camera_model      TEXT,
  lens_model        TEXT,
  exif_datetime     TIMESTAMPTZ,
  gps_lat           NUMERIC(10,7),
  gps_lon           NUMERIC(10,7),

  extracted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_metadata_kind      ON media_metadata(media_kind);
CREATE INDEX IF NOT EXISTS idx_media_metadata_datetime  ON media_metadata(exif_datetime DESC);
CREATE INDEX IF NOT EXISTS idx_media_metadata_camera    ON media_metadata(camera_make, camera_model);
CREATE INDEX IF NOT EXISTS idx_media_metadata_file      ON media_metadata(file_index_id);
