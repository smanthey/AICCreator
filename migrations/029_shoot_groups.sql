-- Migration 029: deterministic media clustering groups.

CREATE TABLE IF NOT EXISTS shoot_groups (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hostname      TEXT,
  camera_make   TEXT,
  camera_model  TEXT,
  gps_lat       NUMERIC(10,7),
  gps_lon       NUMERIC(10,7),
  start_at      TIMESTAMPTZ,
  end_at        TIMESTAMPTZ,
  files_count   INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shoot_group_members (
  shoot_group_id UUID NOT NULL REFERENCES shoot_groups(id) ON DELETE CASCADE,
  file_index_id  UUID NOT NULL UNIQUE REFERENCES file_index(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (shoot_group_id, file_index_id)
);

CREATE INDEX IF NOT EXISTS idx_shoot_groups_start ON shoot_groups(start_at DESC);
CREATE INDEX IF NOT EXISTS idx_shoot_groups_host  ON shoot_groups(hostname);
CREATE INDEX IF NOT EXISTS idx_shoot_groups_cam   ON shoot_groups(camera_model);
CREATE INDEX IF NOT EXISTS idx_shoot_members_file ON shoot_group_members(file_index_id);
