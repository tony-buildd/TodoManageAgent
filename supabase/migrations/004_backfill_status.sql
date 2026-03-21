-- 004_backfill_status.sql
-- Backfill legacy status values to the new lifecycle.
-- Maps: reminded -> in_progress (with reminded_at set)
--       archived -> canceled
-- Idempotent: only updates rows that still have the old status values.

-- Step 1: Map 'reminded' rows to 'in_progress'.
-- Set reminded_at to updated_at so we preserve the approximate reminder timestamp.
-- The WHERE clause ensures idempotency — only rows still marked 'reminded' are touched.
UPDATE todos
SET
  status = 'in_progress',
  reminded_at = updated_at
WHERE status = 'reminded';

-- Step 2: Map 'archived' rows to 'canceled'.
-- The WHERE clause ensures idempotency — only rows still marked 'archived' are touched.
UPDATE todos
SET
  status = 'canceled'
WHERE status = 'archived';
