-- migrations/012_telegram_users.sql
-- Creates the telegram_users authorization table.
-- Referenced by gateway/telegram.js for role-based access control.
--
-- Run on NAS Postgres:
--   psql -h 192.168.1.164 -p 15432 -U claw -d claw_architect -f migrations/012_telegram_users.sql

-- ── Telegram operator whitelist ───────────────────────────────
-- Roles: owner (all commands), operator (read + approve), viewer (read-only)
CREATE TABLE IF NOT EXISTS telegram_users (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id  TEXT        UNIQUE NOT NULL,
  telegram_chat_id  TEXT,
  username          TEXT,
  role              TEXT        NOT NULL DEFAULT 'viewer'
                                CHECK (role IN ('owner', 'operator', 'viewer')),
  added_by          TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  last_seen         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_telegram_users_user_id ON telegram_users(telegram_user_id);

-- ── Idempotent column additions (handles pre-existing tables) ─
ALTER TABLE telegram_users ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;
ALTER TABLE telegram_users ADD COLUMN IF NOT EXISTS username          TEXT;
ALTER TABLE telegram_users ADD COLUMN IF NOT EXISTS added_by          TEXT;
ALTER TABLE telegram_users ADD COLUMN IF NOT EXISTS last_seen         TIMESTAMPTZ;

-- ── Add seed: add your own Telegram user ID here ──────────────
-- Get your user ID by messaging @userinfobot on Telegram.
-- Uncomment and replace 000000000 with your real Telegram user ID:
--
-- INSERT INTO telegram_users (telegram_user_id, username, role, added_by)
-- VALUES ('000000000', '<USER>', 'owner', 'seed')
-- ON CONFLICT (telegram_user_id) DO NOTHING;

-- ── Back-fill chat_id from existing plan_approvals ────────────
-- Any user who has approved plans already has a chat_id recorded.
INSERT INTO telegram_users (telegram_user_id, telegram_chat_id, role, added_by)
SELECT DISTINCT telegram_user_id, telegram_chat_id, 'operator', 'backfill'
FROM plan_approvals
WHERE telegram_user_id IS NOT NULL
ON CONFLICT (telegram_user_id) DO NOTHING;
