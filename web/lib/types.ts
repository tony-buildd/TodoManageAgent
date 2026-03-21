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
 * Message log record from the database.
 */
export interface MessageLog {
  id: string;
  user_id: string;
  direction: 'inbound' | 'outbound';
  raw_message: string;
  created_at: string;
}
