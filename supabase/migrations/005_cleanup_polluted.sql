-- 005_cleanup_polluted.sql
-- Identify and soft-delete polluted rows from earlier watcher bugs.
-- Two categories of polluted data:
--   1) Agent messages incorrectly processed as inbound todos (raw_message contains [PT])
--   2) Duplicate todos created within seconds of each other with the same task text
--
-- Strategy: reversible soft-delete using status = 'cleanup_deleted'.
-- We first widen the CHECK constraint to allow this marker value, then mark rows.

-- Step 1: Widen the status CHECK constraint to include 'cleanup_deleted'.
-- Drop the existing constraint and re-create with the new value.
DO $$
BEGIN
  ALTER TABLE todos DROP CONSTRAINT IF EXISTS todos_status_check;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

ALTER TABLE todos
  ADD CONSTRAINT todos_status_check
  CHECK (status IN (
    'pending', 'in_progress', 'done', 'not_confirmed', 'canceled',
    'reminded', 'archived',
    'cleanup_deleted'
  ));

-- Step 2: Soft-delete todos whose task text contains the [PT] agent prefix.
-- These are agent outbound messages that were incorrectly processed as inbound todos.
-- Only mark rows that are not already cleaned up (idempotent).
UPDATE todos
SET status = 'cleanup_deleted'
WHERE task LIKE '%[PT]%'
  AND status != 'cleanup_deleted';

-- Step 3: Soft-delete duplicate todos created within 5 seconds of each other
-- with the same user_id and task text.
-- Keep the earliest duplicate (lowest created_at), mark later ones as cleanup_deleted.
-- Uses a self-join to find duplicates.
UPDATE todos AS t
SET status = 'cleanup_deleted'
FROM todos AS dup
WHERE t.user_id = dup.user_id
  AND t.task = dup.task
  AND t.id != dup.id
  AND t.created_at > dup.created_at
  AND (t.created_at::timestamptz - dup.created_at::timestamptz) < INTERVAL '5 seconds'
  AND t.status != 'cleanup_deleted';
