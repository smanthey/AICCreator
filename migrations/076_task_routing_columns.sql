-- Migration 076: Task Routing Columns
-- Moves ensureTaskRoutingColumns() logic from dispatcher.js to a proper migration
-- This prevents DDL checks on every dispatcher run

-- Add required_tags column if it doesn't exist
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS required_tags TEXT[] DEFAULT '{}';

-- Add idempotency_key column if it doesn't exist
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

-- Add workflow_run_id column if it doesn't exist (may fail if already exists, that's ok)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'tasks' AND column_name = 'workflow_run_id'
  ) THEN
    ALTER TABLE tasks ADD COLUMN workflow_run_id TEXT;
  END IF;
END $$;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_tasks_required_tags ON tasks USING GIN (required_tags);
CREATE INDEX IF NOT EXISTS idx_tasks_idempotency_key ON tasks (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_workflow_run_id ON tasks (workflow_run_id) WHERE workflow_run_id IS NOT NULL;

COMMENT ON COLUMN tasks.required_tags IS 'Array of tags required for worker eligibility (e.g., ["ai", "gpu"])';
COMMENT ON COLUMN tasks.idempotency_key IS 'Unique key to prevent duplicate task execution';
COMMENT ON COLUMN tasks.workflow_run_id IS 'Identifier for workflow run grouping';
