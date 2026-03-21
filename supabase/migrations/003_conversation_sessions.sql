-- 003_conversation_sessions.sql
-- Creates the conversation_sessions table for multi-thread follow-up state management.

-- Create conversation_sessions table
CREATE TABLE IF NOT EXISTS conversation_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_key TEXT NOT NULL,
  related_todo_id UUID REFERENCES todos(id) ON DELETE SET NULL,
  state TEXT NOT NULL CHECK (state IN (
    'awaiting_time',
    'awaiting_date',
    'awaiting_disambiguation',
    'awaiting_completion',
    'awaiting_edit_target',
    'awaiting_edit_value'
  )),
  task_label_snapshot TEXT NOT NULL,
  candidate_todo_ids JSONB,
  prompt_type TEXT,
  last_inbound_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_outbound_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-update updated_at trigger (reuses function from 002 migration)
DROP TRIGGER IF EXISTS set_updated_at_conversation_sessions ON conversation_sessions;
CREATE TRIGGER set_updated_at_conversation_sessions
  BEFORE UPDATE ON conversation_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Index for active session lookups: user_id + resolved_at
CREATE INDEX IF NOT EXISTS idx_conversation_sessions_active
  ON conversation_sessions(user_id, resolved_at)
  WHERE resolved_at IS NULL;

-- Index for cleanup queries on last_inbound_at
CREATE INDEX IF NOT EXISTS idx_conversation_sessions_last_inbound
  ON conversation_sessions(last_inbound_at)
  WHERE resolved_at IS NULL;

-- Row Level Security
ALTER TABLE conversation_sessions ENABLE ROW LEVEL SECURITY;

-- RLS Policies: service_role full access, anon read
DO $$
BEGIN
  -- Drop policies if they exist, then recreate (idempotent)
  DROP POLICY IF EXISTS "service_role_full_conversation_sessions" ON conversation_sessions;
  DROP POLICY IF EXISTS "anon_read_conversation_sessions" ON conversation_sessions;
END $$;

CREATE POLICY "service_role_full_conversation_sessions" ON conversation_sessions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_conversation_sessions" ON conversation_sessions
  FOR SELECT TO anon USING (true);
