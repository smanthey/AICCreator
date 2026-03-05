-- Migration 066: Visual catalog enrichment for image files.
-- Adds a structured table for deterministic + AI-assisted visual labeling
-- that complements filename/location semantics from file_index.

CREATE TABLE IF NOT EXISTS media_visual_catalog (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_index_id      UUID NOT NULL UNIQUE REFERENCES file_index(id) ON DELETE CASCADE,
  source             TEXT NOT NULL, -- deterministic | openai_vision | hybrid
  model_used         TEXT,
  visual_labels      TEXT[] NOT NULL DEFAULT '{}',
  scene_type         TEXT,
  primary_subject    TEXT,
  visual_summary     TEXT,
  location_signals   TEXT[] NOT NULL DEFAULT '{}',
  filename_signals   TEXT[] NOT NULL DEFAULT '{}',
  dominant_color_hex TEXT,
  brightness         NUMERIC(8,5),
  orientation        TEXT, -- portrait | landscape | square | unknown
  confidence         NUMERIC(6,5),
  analysis_json      JSONB NOT NULL DEFAULT '{}'::jsonb,
  analyzed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_visual_catalog_file
  ON media_visual_catalog(file_index_id);

CREATE INDEX IF NOT EXISTS idx_media_visual_catalog_scene
  ON media_visual_catalog(scene_type);

CREATE INDEX IF NOT EXISTS idx_media_visual_catalog_labels
  ON media_visual_catalog USING GIN (visual_labels);

CREATE INDEX IF NOT EXISTS idx_media_visual_catalog_location_signals
  ON media_visual_catalog USING GIN (location_signals);

CREATE INDEX IF NOT EXISTS idx_media_visual_catalog_analyzed_at
  ON media_visual_catalog(analyzed_at DESC);
