-- Migration 051: enforce allowed task lifecycle statuses
-- Adds a check constraint so runtime + schema audit agree on valid states.

ALTER TABLE tasks
  DROP CONSTRAINT IF EXISTS tasks_status_check;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_status_check
  CHECK (
    status IN (
      'CREATED',
      'PENDING',
      'QUEUED',
      'DISPATCHED',
      'RUNNING',
      'RETRY',
      'COMPLETED',
      'FAILED',
      'DEAD_LETTER',
      'SKIPPED',
      'CANCELLED'
    )
  ) NOT VALID;

ALTER TABLE tasks
  VALIDATE CONSTRAINT tasks_status_check;
