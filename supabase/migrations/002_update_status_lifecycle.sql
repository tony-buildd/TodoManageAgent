-- 002_update_status_lifecycle.sql
-- Updates the todos table for the new reliability spec status lifecycle.
-- Adds new status values, timestamp columns, and updated indexes.

-- Step 1: Drop the existing CHECK constraint on status (idempotent via DO block)
DO $$
BEGIN
  -- Try to drop the old constraint; ignore if it doesn't exist
  ALTER TABLE todos DROP CONSTRAINT IF EXISTS todos_status_check;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

-- Step 2: Add new CHECK constraint allowing both new and legacy status values
-- New: pending, in_progress, done, not_confirmed, canceled
-- Legacy (temporary): reminded, archived
ALTER TABLE todos
  ADD CONSTRAINT todos_status_check
  CHECK (status IN ('pending', 'in_progress', 'done', 'not_confirmed', 'canceled', 'reminded', 'archived'));

-- Step 3: Add new timestamp columns (idempotent with IF NOT EXISTS pattern)
DO $$
BEGIN
  -- Add reminded_at column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'todos' AND column_name = 'reminded_at'
  ) THEN
    ALTER TABLE todos ADD COLUMN reminded_at TIMESTAMPTZ;
  END IF;

  -- Add canceled_at column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'todos' AND column_name = 'canceled_at'
  ) THEN
    ALTER TABLE todos ADD COLUMN canceled_at TIMESTAMPTZ;
  END IF;

  -- Add not_confirmed_at column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'todos' AND column_name = 'not_confirmed_at'
  ) THEN
    ALTER TABLE todos ADD COLUMN not_confirmed_at TIMESTAMPTZ;
  END IF;

  -- Ensure updated_at column exists (should already exist from 001, but be safe)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'todos' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE todos ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
  END IF;
END $$;

-- Step 4: Create or replace trigger to auto-update updated_at on row change
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists, then re-create (idempotent)
DROP TRIGGER IF EXISTS set_updated_at_todos ON todos;
CREATE TRIGGER set_updated_at_todos
  BEFORE UPDATE ON todos
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Step 5: Update indexes for new status values
-- Drop old single-column status index and create a composite one
DROP INDEX IF EXISTS idx_todos_status;
CREATE INDEX IF NOT EXISTS idx_todos_status_due ON todos(status, due_at);

-- Index for scheduler queries: pending reminders
CREATE INDEX IF NOT EXISTS idx_todos_pending_remind ON todos(status, remind_at)
  WHERE status = 'pending';

-- Index for grace period queries: in_progress past due
CREATE INDEX IF NOT EXISTS idx_todos_in_progress_due ON todos(status, due_at)
  WHERE status = 'in_progress';

-- Index for not_confirmed tasks (EOD summary)
CREATE INDEX IF NOT EXISTS idx_todos_not_confirmed ON todos(status, user_id)
  WHERE status = 'not_confirmed';
