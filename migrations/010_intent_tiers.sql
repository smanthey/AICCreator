-- migrations/010_intent_tiers.sql
-- Adds intent tier + category governance columns to plans.
-- Adds confirm_token to plan_approvals for Tier 3 two-step flow.

ALTER TABLE plans ADD COLUMN IF NOT EXISTS intent_tier       INTEGER DEFAULT 2;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS intent_categories TEXT[]  DEFAULT '{}';
ALTER TABLE plans ADD COLUMN IF NOT EXISTS rollback_plan     TEXT;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS machines_involved TEXT[]  DEFAULT '{}';
ALTER TABLE plans ADD COLUMN IF NOT EXISTS resource_estimates JSONB  DEFAULT '{}';

ALTER TABLE plan_approvals ADD COLUMN IF NOT EXISTS confirm_token TEXT;

-- Index for tier-based filtering
CREATE INDEX IF NOT EXISTS idx_plans_intent_tier ON plans(intent_tier);
