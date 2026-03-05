-- Migration 038: pre-filing prediction + strategy recommendation storage.

CREATE TABLE IF NOT EXISTS ip_prefiling_assessments (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mark_text                  TEXT NOT NULL,
  filing_basis               TEXT CHECK (filing_basis IN ('1a','1b','unknown')),
  class_numbers              INTEGER[] NOT NULL DEFAULT '{}'::INTEGER[],
  mark_category              TEXT,
  goods_text                 TEXT,
  id_specificity_score       NUMERIC(8,4) NOT NULL DEFAULT 0,
  crowding_score             NUMERIC(8,4) NOT NULL DEFAULT 0,
  similarity_score           NUMERIC(8,4) NOT NULL DEFAULT 0,
  goods_overlap_score        NUMERIC(8,4) NOT NULL DEFAULT 0,
  marketplace_overlap_score  NUMERIC(8,4) NOT NULL DEFAULT 0,
  risk_2d                    NUMERIC(8,4) NOT NULL DEFAULT 0,
  risk_2e1                   NUMERIC(8,4) NOT NULL DEFAULT 0,
  risk_id_indefinite         NUMERIC(8,4) NOT NULL DEFAULT 0,
  risk_specimen              NUMERIC(8,4) NOT NULL DEFAULT 0,
  predicted_cycles           INTEGER NOT NULL DEFAULT 1,
  recommended_strategy       TEXT NOT NULL,
  recommended_split          BOOLEAN NOT NULL DEFAULT FALSE,
  strategy_options_json      JSONB NOT NULL DEFAULT '[]'::jsonb,
  top_drivers_json           JSONB NOT NULL DEFAULT '[]'::jsonb,
  conflict_candidates_json   JSONB NOT NULL DEFAULT '[]'::jsonb,
  model_used                 TEXT NOT NULL DEFAULT 'deterministic-prefiling-v1',
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ip_prefiling_assessments_created
  ON ip_prefiling_assessments (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ip_prefiling_assessments_mark
  ON ip_prefiling_assessments (mark_text, created_at DESC);
