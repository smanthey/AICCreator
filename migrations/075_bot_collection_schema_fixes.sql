-- Migration 075: Bot Collection Schema Fixes
-- Fixes schema gaps and adds missing indexes/constraints

-- 1. Create missing bot_conversion_events table
CREATE TABLE IF NOT EXISTS bot_conversion_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  event_type TEXT NOT NULL,
  value NUMERIC(10,2),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bot_conversion_events_bot_id 
  ON bot_conversion_events(bot_id);
CREATE INDEX IF NOT EXISTS idx_bot_conversion_events_platform 
  ON bot_conversion_events(platform);
CREATE INDEX IF NOT EXISTS idx_bot_conversion_events_created 
  ON bot_conversion_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_conversion_events_type 
  ON bot_conversion_events(event_type);

-- 2. Add missing composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_bot_outreach_bot_platform_status 
  ON bot_outreach_results(bot_id, platform, status);

CREATE INDEX IF NOT EXISTS idx_bot_discovery_status_priority 
  ON bot_discovery_targets(status, priority_score DESC)
  WHERE status IN ('discovered', 'contacted');

CREATE INDEX IF NOT EXISTS idx_bot_leads_status_discovered 
  ON bot_leads(status, discovered_at DESC)
  WHERE status = 'discovered';

CREATE INDEX IF NOT EXISTS idx_bot_learning_type_created 
  ON bot_learning_insights(insight_type, created_at DESC);

-- 3. Add foreign keys (only if bot_registry exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'bot_registry') THEN
    -- Add FK to bot_outreach_results
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints 
      WHERE constraint_name = 'bot_outreach_results_bot_id_fkey'
    ) THEN
      ALTER TABLE bot_outreach_results 
        ADD CONSTRAINT bot_outreach_results_bot_id_fkey 
        FOREIGN KEY (bot_id) REFERENCES bot_registry(bot_id) ON DELETE SET NULL;
    END IF;
    
    -- Add FK to bot_discovery_targets
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints 
      WHERE constraint_name = 'bot_discovery_targets_bot_id_fkey'
    ) THEN
      ALTER TABLE bot_discovery_targets 
        ADD CONSTRAINT bot_discovery_targets_bot_id_fkey 
        FOREIGN KEY (bot_id) REFERENCES bot_registry(bot_id) ON DELETE SET NULL;
    END IF;
    
    -- Add FK to bot_conversions (only if table exists)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'bot_conversions') THEN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'bot_conversions_bot_id_fkey'
      ) THEN
        ALTER TABLE bot_conversions 
          ADD CONSTRAINT bot_conversions_bot_id_fkey 
          FOREIGN KEY (bot_id) REFERENCES bot_registry(bot_id) ON DELETE SET NULL;
      END IF;
    END IF;
    
    -- Add FK to bot_conversion_events
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints 
      WHERE constraint_name = 'bot_conversion_events_bot_id_fkey'
    ) THEN
      ALTER TABLE bot_conversion_events 
        ADD CONSTRAINT bot_conversion_events_bot_id_fkey 
        FOREIGN KEY (bot_id) REFERENCES bot_registry(bot_id) ON DELETE SET NULL;
    END IF;
  END IF;
END $$;

-- 4. Add missing index on bot_outreach_results for time-based queries
CREATE INDEX IF NOT EXISTS idx_bot_outreach_platform_sent 
  ON bot_outreach_results(platform, sent_at DESC);

-- 5. Add index for conversion tracking queries (only if table exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'bot_conversions') THEN
    CREATE INDEX IF NOT EXISTS idx_bot_conversions_platform_converted 
      ON bot_conversions(platform, converted_at DESC);
  END IF;
END $$;

COMMENT ON TABLE bot_conversion_events IS 'Individual conversion events for detailed tracking and analytics';
