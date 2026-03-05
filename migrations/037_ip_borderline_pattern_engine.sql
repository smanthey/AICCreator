-- Migration 037: Borderline pattern engine for examiner/class/category learning.

ALTER TABLE ip_case_outcomes
  ADD COLUMN IF NOT EXISTS class_number INTEGER,
  ADD COLUMN IF NOT EXISTS mark_category TEXT,
  ADD COLUMN IF NOT EXISTS strategy_mode TEXT CHECK (strategy_mode IN ('argue','narrow','hybrid','other')),
  ADD COLUMN IF NOT EXISTS similarity_score NUMERIC(5,4),
  ADD COLUMN IF NOT EXISTS goods_overlap_score NUMERIC(5,4),
  ADD COLUMN IF NOT EXISTS marketplace_overlap_score NUMERIC(5,4),
  ADD COLUMN IF NOT EXISTS mark_strength_score NUMERIC(5,4),
  ADD COLUMN IF NOT EXISTS prior_registration_strength_score NUMERIC(5,4),
  ADD COLUMN IF NOT EXISTS examiner_strictness_index NUMERIC(5,4),
  ADD COLUMN IF NOT EXISTS borderline_classification TEXT CHECK (borderline_classification IN ('clear_conflict','clear_distinguishable','borderline')),
  ADD COLUMN IF NOT EXISTS borderline_confidence NUMERIC(5,4),
  ADD COLUMN IF NOT EXISTS scope_shrink_delta NUMERIC(8,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS scope_shrink_ratio NUMERIC(8,4) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_ip_case_outcomes_examiner_issue
  ON ip_case_outcomes (examiner, issue_type, result, resolved_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_ip_case_outcomes_class_category
  ON ip_case_outcomes (class_number, mark_category, issue_type, result, resolved_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_ip_case_outcomes_borderline
  ON ip_case_outcomes (borderline_classification, similarity_score, goods_overlap_score, resolved_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS ip_examiner_profiles (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  examiner_name                TEXT NOT NULL UNIQUE,
  total_cases                  INTEGER NOT NULL DEFAULT 0,
  acceptance_rate              NUMERIC(8,4) NOT NULL DEFAULT 0,
  avg_cycles                   NUMERIC(8,4) NOT NULL DEFAULT 0,
  avg_days_to_resolution       NUMERIC(10,2) NOT NULL DEFAULT 0,
  strictness_score             NUMERIC(8,4) NOT NULL DEFAULT 0,
  specimen_rejection_rate      NUMERIC(8,4) NOT NULL DEFAULT 0,
  argument_success_rate        NUMERIC(8,4) NOT NULL DEFAULT 0,
  narrowing_success_rate       NUMERIC(8,4) NOT NULL DEFAULT 0,
  hybrid_success_rate          NUMERIC(8,4) NOT NULL DEFAULT 0,
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata_json                JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS ip_class_profiles (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_number                 INTEGER NOT NULL UNIQUE,
  total_cases                  INTEGER NOT NULL DEFAULT 0,
  acceptance_rate              NUMERIC(8,4) NOT NULL DEFAULT 0,
  avg_cycles                   NUMERIC(8,4) NOT NULL DEFAULT 0,
  avg_days_to_resolution       NUMERIC(10,2) NOT NULL DEFAULT 0,
  likelihood_2d_density        NUMERIC(8,4) NOT NULL DEFAULT 0,
  descriptiveness_2e1_rate     NUMERIC(8,4) NOT NULL DEFAULT 0,
  specimen_refusal_rate        NUMERIC(8,4) NOT NULL DEFAULT 0,
  disclaimer_rate              NUMERIC(8,4) NOT NULL DEFAULT 0,
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata_json                JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS ip_category_profiles (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_name                TEXT NOT NULL UNIQUE,
  total_cases                  INTEGER NOT NULL DEFAULT 0,
  acceptance_rate              NUMERIC(8,4) NOT NULL DEFAULT 0,
  avg_cycles                   NUMERIC(8,4) NOT NULL DEFAULT 0,
  avg_days_to_resolution       NUMERIC(10,2) NOT NULL DEFAULT 0,
  narrowing_success_rate       NUMERIC(8,4) NOT NULL DEFAULT 0,
  argument_success_rate        NUMERIC(8,4) NOT NULL DEFAULT 0,
  hybrid_success_rate          NUMERIC(8,4) NOT NULL DEFAULT 0,
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata_json                JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS ip_borderline_matrix (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_type                   TEXT NOT NULL,
  class_number                 INTEGER,
  mark_category                TEXT,
  examiner_name                TEXT,
  similarity_band              TEXT NOT NULL,
  goods_overlap_band           TEXT NOT NULL,
  strictness_band              TEXT NOT NULL,
  strategy_mode                TEXT NOT NULL,
  sample_size                  INTEGER NOT NULL DEFAULT 0,
  acceptance_rate              NUMERIC(8,4) NOT NULL DEFAULT 0,
  avg_cycles                   NUMERIC(8,4) NOT NULL DEFAULT 0,
  avg_days_to_resolution       NUMERIC(10,2) NOT NULL DEFAULT 0,
  scope_shrink_penalty         NUMERIC(10,4) NOT NULL DEFAULT 0,
  score                        NUMERIC(10,4) NOT NULL DEFAULT 0,
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata_json                JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (issue_type, class_number, mark_category, examiner_name, similarity_band, goods_overlap_band, strictness_band, strategy_mode)
);
