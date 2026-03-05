-- 072_bot_platform.sql
-- Bot Communication Platform Schema
-- Creates tables for bot registry, communications, and API key management

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Bot Registry
CREATE TABLE IF NOT EXISTS bot_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id TEXT NOT NULL UNIQUE,
  bot_name TEXT NOT NULL,
  bot_display_name TEXT,
  description TEXT,
  platform TEXT NOT NULL, -- discord, telegram, whatsapp, api, moltbook
  capabilities TEXT[] DEFAULT '{}', -- array of capability strings
  api_endpoint TEXT,
  webhook_url TEXT,
  public_key TEXT, -- for message verification
  reputation_score NUMERIC(5,2) DEFAULT 0,
  verified BOOLEAN DEFAULT FALSE,
  moltbook_id TEXT,
  discord_user_id TEXT,
  telegram_username TEXT,
  whatsapp_number TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  registered_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended', 'pending')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bot_registry_platform ON bot_registry(platform);
CREATE INDEX IF NOT EXISTS idx_bot_registry_capabilities ON bot_registry USING GIN(capabilities);
CREATE INDEX IF NOT EXISTS idx_bot_registry_status ON bot_registry(status);
CREATE INDEX IF NOT EXISTS idx_bot_registry_reputation ON bot_registry(reputation_score DESC);
CREATE INDEX IF NOT EXISTS idx_bot_registry_moltbook ON bot_registry(moltbook_id) WHERE moltbook_id IS NOT NULL;

-- Bot Communications
CREATE TABLE IF NOT EXISTS bot_communications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_bot_id TEXT NOT NULL,
  to_bot_id TEXT NOT NULL,
  protocol TEXT NOT NULL, -- agent-intro, commerce, collaboration, etc.
  message_type TEXT NOT NULL, -- request, response, notification
  payload JSONB NOT NULL,
  status TEXT DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'read', 'failed')),
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add foreign keys only if bot_registry exists (created by bot-registry.js)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'bot_registry') THEN
    -- Drop existing constraints if they exist
    ALTER TABLE bot_communications DROP CONSTRAINT IF EXISTS bot_communications_from_bot_id_fkey;
    ALTER TABLE bot_communications DROP CONSTRAINT IF EXISTS bot_communications_to_bot_id_fkey;
    
    -- Add foreign keys
    ALTER TABLE bot_communications 
      ADD CONSTRAINT bot_communications_from_bot_id_fkey 
      FOREIGN KEY (from_bot_id) REFERENCES bot_registry(bot_id) ON DELETE CASCADE;
    
    ALTER TABLE bot_communications 
      ADD CONSTRAINT bot_communications_to_bot_id_fkey 
      FOREIGN KEY (to_bot_id) REFERENCES bot_registry(bot_id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bot_comm_from ON bot_communications(from_bot_id);
CREATE INDEX IF NOT EXISTS idx_bot_comm_to ON bot_communications(to_bot_id);
CREATE INDEX IF NOT EXISTS idx_bot_comm_protocol ON bot_communications(protocol);
CREATE INDEX IF NOT EXISTS idx_bot_comm_status ON bot_communications(status);
CREATE INDEX IF NOT EXISTS idx_bot_comm_created ON bot_communications(created_at DESC);

-- API Keys (encrypted storage)
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_name TEXT NOT NULL,
  key_type TEXT NOT NULL, -- stripe, anthropic, openai, discord, telegram, etc.
  key_value_encrypted TEXT NOT NULL,
  key_salt TEXT NOT NULL,
  key_iv TEXT NOT NULL,
  key_auth_tag TEXT NOT NULL,
  bot_id TEXT,
  service_name TEXT,
  permissions TEXT[] DEFAULT '{}',
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  usage_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(key_name, bot_id)
);

CREATE INDEX IF NOT EXISTS idx_api_keys_type ON api_keys(key_type);
CREATE INDEX IF NOT EXISTS idx_api_keys_bot_id ON api_keys(bot_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_status ON api_keys(status);
CREATE INDEX IF NOT EXISTS idx_api_keys_expires ON api_keys(expires_at) WHERE expires_at IS NOT NULL;

-- Bot Reputation History (for audit trail)
CREATE TABLE IF NOT EXISTS bot_reputation_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id TEXT NOT NULL,
  reputation_score NUMERIC(5,2) NOT NULL,
  source TEXT NOT NULL, -- moltbook, transaction, manual, etc.
  reason TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add foreign key only if bot_registry exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'bot_registry') THEN
    ALTER TABLE bot_reputation_history DROP CONSTRAINT IF EXISTS bot_reputation_history_bot_id_fkey;
    ALTER TABLE bot_reputation_history 
      ADD CONSTRAINT bot_reputation_history_bot_id_fkey 
      FOREIGN KEY (bot_id) REFERENCES bot_registry(bot_id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bot_reputation_bot_id ON bot_reputation_history(bot_id);
CREATE INDEX IF NOT EXISTS idx_bot_reputation_created ON bot_reputation_history(created_at DESC);

-- Bot Communication Stats (for analytics)
CREATE TABLE IF NOT EXISTS bot_communication_stats (
  bot_id TEXT NOT NULL,
  protocol TEXT NOT NULL,
  message_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  last_message_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (bot_id, protocol)
);

-- Add foreign key only if bot_registry exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'bot_registry') THEN
    ALTER TABLE bot_communication_stats DROP CONSTRAINT IF EXISTS bot_communication_stats_bot_id_fkey;
    ALTER TABLE bot_communication_stats 
      ADD CONSTRAINT bot_communication_stats_bot_id_fkey 
      FOREIGN KEY (bot_id) REFERENCES bot_registry(bot_id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bot_stats_bot_id ON bot_communication_stats(bot_id);
CREATE INDEX IF NOT EXISTS idx_bot_stats_protocol ON bot_communication_stats(protocol);

COMMENT ON TABLE bot_registry IS 'Central registry for all bots in the platform';
COMMENT ON TABLE bot_communications IS 'Log of all bot-to-bot communications';
COMMENT ON TABLE api_keys IS 'Encrypted storage for API keys (requires API_KEY_MASTER_KEY to decrypt)';
COMMENT ON TABLE bot_reputation_history IS 'Audit trail of reputation changes';
COMMENT ON TABLE bot_communication_stats IS 'Aggregated statistics for bot communications';
