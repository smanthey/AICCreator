-- 044_loyalty_webhook_conflict_fix.sql
-- ON CONFLICT (provider, event_id) requires a non-partial unique index/constraint.

DROP INDEX IF EXISTS uq_loyalty_webhook_provider_event;

CREATE UNIQUE INDEX IF NOT EXISTS uq_loyalty_webhook_provider_event
  ON loyalty_webhook_events(provider, event_id);
