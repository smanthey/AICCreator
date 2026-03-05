-- 049_loyalty_event_backfill.sql
-- Backfills webhook metadata/version fields and missing order IDs for historical rows.

UPDATE loyalty_webhook_events
SET
  source_system = COALESCE(NULLIF(source_system, ''), provider),
  event_version = COALESCE(NULLIF(event_version, ''), 'v1'),
  schema_version = COALESCE(NULLIF(schema_version, ''), 'v1')
WHERE
  source_system IS NULL OR source_system = ''
  OR event_version IS NULL OR event_version = ''
  OR schema_version IS NULL OR schema_version = '';

UPDATE loyalty_order_events
SET order_id = COALESCE(NULLIF(order_id, ''), event_id, id::text),
    updated_at = NOW()
WHERE order_id IS NULL OR order_id = '';
