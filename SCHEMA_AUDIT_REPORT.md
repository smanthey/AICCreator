# Database Schema Audit Report

## Issues Found

### 1. Missing Table: `bot_conversion_events`

**Location**: Referenced in `migrations/072_bot_platform.sql` line 160 (comment) but table is never created.

**Impact**: High - Code may reference this table but it doesn't exist.

**Fix**: Add table creation to migration 072 or create new migration.

```sql
CREATE TABLE IF NOT EXISTS bot_conversion_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  event_type TEXT NOT NULL,
  value NUMERIC(10,2),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 2. Schema Duplication: Multiple `CREATE TABLE IF NOT EXISTS` in Code

**Location**: Multiple bot scripts create tables directly instead of relying on migrations:
- `scripts/bot-learning-system.js` - Creates `bot_outreach_results`, `bot_learning_insights`
- `scripts/bot-outreach-coordinator.js` - Creates `bot_outreach_results`
- `scripts/bot-conversion-tracker.js` - Creates `bot_discovery_targets`, `bot_outreach_results`, `bot_conversions`
- `scripts/bot-discovery-aggressive.js` - Creates `bot_discovery_targets`
- `scripts/bot-lead-discovery.js` - Creates `bot_leads`
- `scripts/bot-registry.js` - Creates `bot_registry`, `bot_communications`

**Impact**: Medium - Can lead to schema drift if definitions differ between code and migrations.

**Fix**: Remove `CREATE TABLE IF NOT EXISTS` from code, rely on migrations only. Add proper error handling if tables don't exist.

### 3. Missing Indexes

**Tables needing additional indexes:**

- `bot_outreach_results`: Missing composite index on `(bot_id, platform, status)` for common queries
- `bot_discovery_targets`: Missing index on `(status, priority_score DESC)` for priority queries
- `bot_leads`: Missing index on `(status, discovered_at DESC)` for uncontacted leads query
- `bot_learning_insights`: Missing index on `(insight_type, created_at DESC)` for type-based queries

### 4. Foreign Key Gaps

**Issues:**
- `bot_outreach_results.bot_id` should reference `bot_registry.bot_id` but no FK exists
- `bot_discovery_targets.bot_id` should reference `bot_registry.bot_id` but no FK exists
- `bot_conversions.bot_id` should reference `bot_registry.bot_id` but no FK exists

**Impact**: Medium - Data integrity not enforced at database level.

**Fix**: Add foreign key constraints (with proper handling for existing data).

### 5. Column Mismatches

**Potential issues:**
- `bot_outreach_results` in code vs migration: Need to verify all columns match
- `bot_learning_insights` in code vs migration: Need to verify all columns match

### 6. Missing Tables Referenced in Comments/Docs

- `bot_message_variants` - Mentioned in bot system but no table exists
- `bot_daily_reports` - Used by `bot-daily-improvement.js` but stored as JSON files, not in DB

**Recommendation**: Consider creating these tables for better queryability.

## Recommended Fixes

### Migration 075: Fix Bot Collection Schema Gaps

```sql
-- 075_bot_collection_schema_fixes.sql

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

-- 2. Add missing composite indexes
CREATE INDEX IF NOT EXISTS idx_bot_outreach_bot_platform_status 
  ON bot_outreach_results(bot_id, platform, status);

CREATE INDEX IF NOT EXISTS idx_bot_discovery_status_priority 
  ON bot_discovery_targets(status, priority_score DESC);

CREATE INDEX IF NOT EXISTS idx_bot_leads_status_discovered 
  ON bot_leads(status, discovered_at DESC);

CREATE INDEX IF NOT EXISTS idx_bot_learning_type_created 
  ON bot_learning_insights(insight_type, created_at DESC);

-- 3. Add foreign keys (only if bot_registry exists and has data)
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
    
    -- Add FK to bot_conversions
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints 
      WHERE constraint_name = 'bot_conversions_bot_id_fkey'
    ) THEN
      ALTER TABLE bot_conversions 
        ADD CONSTRAINT bot_conversions_bot_id_fkey 
        FOREIGN KEY (bot_id) REFERENCES bot_registry(bot_id) ON DELETE SET NULL;
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
```

### Code Cleanup

1. **Remove `CREATE TABLE IF NOT EXISTS` from scripts** - Rely on migrations only
2. **Add proper error handling** - Check if tables exist before querying
3. **Add schema validation** - Run on startup to ensure tables exist

## Summary

- **High Priority**: 1 issue (missing `bot_conversion_events` table)
- **Medium Priority**: 4 issues (schema duplication, missing indexes, missing FKs)
- **Low Priority**: 2 issues (missing optional tables)

**Total Issues**: 7

**Recommended Action**: Create migration 075 to fix all identified issues.
