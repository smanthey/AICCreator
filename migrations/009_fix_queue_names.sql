-- migrations/009_fix_queue_names.sql
-- BullMQ 5.x prohibits colons in queue names.
-- Rename all worker_queue values from colon-separated to underscore-separated.
-- Safe to run multiple times.

UPDATE tasks SET worker_queue = 'claw_tasks_io'       WHERE worker_queue = 'claw_tasks:io';
UPDATE tasks SET worker_queue = 'claw_tasks_io_heavy'  WHERE worker_queue = 'claw_tasks:io_heavy';
UPDATE tasks SET worker_queue = 'claw_tasks_llm'       WHERE worker_queue = 'claw_tasks:llm';
UPDATE tasks SET worker_queue = 'claw_tasks_qa'        WHERE worker_queue = 'claw_tasks:qa';

-- Also fix the default / index
ALTER TABLE tasks ALTER COLUMN worker_queue SET DEFAULT 'claw_tasks';
