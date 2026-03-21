/**
 * Todo status values as defined in the spec.
 */
export type TodoStatus =
  | 'pending'
  | 'in_progress'
  | 'done'
  | 'not_confirmed'
  | 'canceled';

/**
 * Todo record from the database.
 */
export interface Todo {
  id: string;
  user_id: string;
  task: string;
  due_at: string | null;
  remind_at: string | null;
  status: TodoStatus;
  reminded_at: string | null;
  completed_at: string | null;
  canceled_at: string | null;
  not_confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * User record from the database.
 */
export interface User {
  id: string;
  phone: string;
  timezone: string;
  lead_minutes: number;
  created_at: string;
}

/**
 * Conversation session states.
 */
export type SessionState =
  | 'awaiting_time'
  | 'awaiting_date'
  | 'awaiting_disambiguation'
  | 'awaiting_completion'
  | 'awaiting_edit_target'
  | 'awaiting_edit_value';

/**
 * Conversation session record from the database.
 */
export interface ConversationSession {
  id: string;
  user_id: string;
  chat_key: string;
  related_todo_id: string | null;
  state: SessionState;
  task_label_snapshot: string;
  candidate_todo_ids: string[] | null;
  prompt_type: string;
  last_inbound_at: string;
  last_outbound_at: string;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Message log record from the database.
 */
export interface MessageLog {
  id: string;
  user_id: string;
  direction: 'inbound' | 'outbound';
  raw_message: string;
  created_at: string;
}
