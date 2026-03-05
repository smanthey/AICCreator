-- Migration 073: Bot Collection System Tables
-- Creates all tables needed for the aggressive bot collection system

-- Bot discovery targets (created by bot-discovery-aggressive.js)
CREATE TABLE IF NOT EXISTS bot_discovery_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL,
  source TEXT NOT NULL, -- discord, telegram, moltbook, github, etc.
  priority_score NUMERIC(5,2) DEFAULT 0,
  discovered_at TIMESTAMPTZ DEFAULT NOW(),
  contacted_at TIMESTAMPTZ,
  responded_at TIMESTAMPTZ,
  converted_at TIMESTAMPTZ,
  status TEXT DEFAULT 'discovered' CHECK (status IN ('discovered', 'contacted', 'responded', 'converted', 'rejected', 'invalid')),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discovery_status ON bot_discovery_targets(status);
CREATE INDEX IF NOT EXISTS idx_discovery_priority ON bot_discovery_targets(priority_score DESC);
CREATE INDEX IF NOT EXISTS idx_discovery_source ON bot_discovery_targets(source);
CREATE INDEX IF NOT EXISTS idx_discovery_bot_id ON bot_discovery_targets(bot_id);

-- Bot outreach results (created by bot-learning-system.js and bot-outreach-coordinator.js)
CREATE TABLE IF NOT EXISTS bot_outreach_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  message_variant TEXT NOT NULL,
  message_content TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  responded_at TIMESTAMPTZ,
  converted_at TIMESTAMPTZ,
  response_time_seconds INTEGER,
  conversion_value NUMERIC(10,2) DEFAULT 0,
  status TEXT DEFAULT 'sent' CHECK (status IN ('sent', 'opened', 'responded', 'converted', 'rejected', 'ignored')),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outreach_bot_id ON bot_outreach_results(bot_id);
CREATE INDEX IF NOT EXISTS idx_outreach_status ON bot_outreach_results(status);
CREATE INDEX IF NOT EXISTS idx_outreach_variant ON bot_outreach_results(message_variant);
CREATE INDEX IF NOT EXISTS idx_outreach_platform ON bot_outreach_results(platform);
CREATE INDEX IF NOT EXISTS idx_outreach_sent_at ON bot_outreach_results(sent_at DESC);

-- Bot conversions (created by bot-conversion-tracker.js)
CREATE TABLE IF NOT EXISTS bot_conversions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  value NUMERIC(10,2) NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  converted_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(bot_id, converted_at)
);

CREATE INDEX IF NOT EXISTS idx_conversions_bot_id ON bot_conversions(bot_id);
CREATE INDEX IF NOT EXISTS idx_conversions_platform ON bot_conversions(platform);
CREATE INDEX IF NOT EXISTS idx_conversions_converted_at ON bot_conversions(converted_at DESC);

-- Bot learning insights (created by bot-learning-system.js)
CREATE TABLE IF NOT EXISTS bot_learning_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  insight_type TEXT NOT NULL, -- message_effectiveness, timing, platform, etc.
  insight_data JSONB NOT NULL,
  confidence_score NUMERIC(5,2) DEFAULT 0,
  applied_at TIMESTAMPTZ,
  impact_score NUMERIC(5,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_learning_type ON bot_learning_insights(insight_type);
CREATE INDEX IF NOT EXISTS idx_learning_created_at ON bot_learning_insights(created_at DESC);

-- Bot leads (created by bot-lead-discovery.js)
CREATE TABLE IF NOT EXISTS bot_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL,
  bot_id TEXT NOT NULL,
  bot_username TEXT,
  bot_display_name TEXT,
  contact_info TEXT,
  guild_id TEXT,
  guild_name TEXT,
  discovered_at TIMESTAMPTZ DEFAULT NOW(),
  contacted_at TIMESTAMPTZ,
  responded_at TIMESTAMPTZ,
  status TEXT DEFAULT 'discovered' CHECK (status IN ('discovered', 'contacted', 'responded', 'converted', 'rejected', 'ignored')),
  opt_out BOOLEAN DEFAULT FALSE,
  notes JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(platform, bot_id)
);

CREATE INDEX IF NOT EXISTS idx_leads_platform ON bot_leads(platform);
CREATE INDEX IF NOT EXISTS idx_leads_status ON bot_leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_discovered_at ON bot_leads(discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_contacted_at ON bot_leads(contacted_at);
