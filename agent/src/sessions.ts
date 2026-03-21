import type { SupabaseClient } from '@supabase/supabase-js';
import type { ConversationSession, SessionState } from './types.js';

/**
 * Creates a new conversation session row in conversation_sessions.
 *
 * When the agent sends a follow-up question, it must include the
 * task_label_snapshot so the user knows which task is being discussed.
 */
export async function createSession(
  supabase: SupabaseClient,
  userId: string,
  chatKey: string,
  relatedTodoId: string | null,
  state: SessionState,
  taskLabel: string,
): Promise<ConversationSession> {
  const { data, error } = await supabase
    .from('conversation_sessions')
    .insert({
      user_id: userId,
      chat_key: chatKey,
      related_todo_id: relatedTodoId,
      state,
      task_label_snapshot: taskLabel,
    })
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to create session: ${error.message}`);
  }

  return data as ConversationSession;
}

/**
 * Returns all sessions where resolved_at IS NULL, ordered by updated_at DESC.
 */
export async function getActiveSessions(
  supabase: SupabaseClient,
  userId: string,
): Promise<ConversationSession[]> {
  const { data, error } = await supabase
    .from('conversation_sessions')
    .select('*')
    .eq('user_id', userId)
    .is('resolved_at', null)
    .order('updated_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to get active sessions: ${error.message}`);
  }

  return (data ?? []) as ConversationSession[];
}

/**
 * Sets resolved_at = now on a session, effectively closing it.
 */
export async function resolveSession(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<void> {
  const { error } = await supabase
    .from('conversation_sessions')
    .update({ resolved_at: new Date().toISOString() })
    .eq('id', sessionId);

  if (error) {
    throw new Error(`Failed to resolve session: ${error.message}`);
  }
}

/**
 * Updates session fields (e.g. state, last_inbound_at, etc.).
 */
export async function updateSession(
  supabase: SupabaseClient,
  sessionId: string,
  updates: Partial<
    Pick<
      ConversationSession,
      | 'state'
      | 'related_todo_id'
      | 'task_label_snapshot'
      | 'candidate_todo_ids'
      | 'prompt_type'
      | 'last_inbound_at'
      | 'last_outbound_at'
    >
  >,
): Promise<void> {
  const { error } = await supabase
    .from('conversation_sessions')
    .update(updates)
    .eq('id', sessionId);

  if (error) {
    throw new Error(`Failed to update session: ${error.message}`);
  }
}

/**
 * Given a reply and active sessions, determines which session the reply targets.
 *
 * Rules:
 * - If only one session is active, use it.
 * - If the reply contains the task_label_snapshot of a session, match by label.
 * - If ambiguous across multiple sessions, return null (triggers disambiguation).
 */
export function findSessionForReply(
  replyText: string,
  activeSessions: ConversationSession[],
): ConversationSession | null {
  if (activeSessions.length === 0) {
    return null;
  }

  // Single active session — always matches
  if (activeSessions.length === 1) {
    return activeSessions[0];
  }

  // Multiple sessions: try to match by task label in the reply text
  const normalizedReply = replyText.toLowerCase();
  const matches = activeSessions.filter((session) =>
    normalizedReply.includes(session.task_label_snapshot.toLowerCase()),
  );

  if (matches.length === 1) {
    return matches[0];
  }

  // Ambiguous: zero matches or multiple matches
  return null;
}

/**
 * Resolve sessions that have been inactive for more than maxAgeHours.
 *
 * "Inactive" means the last_inbound_at (or updated_at as fallback)
 * is older than now - maxAgeHours.
 */
export async function expireOldSessions(
  supabase: SupabaseClient,
  userId: string,
  maxAgeHours: number = 24,
): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('conversation_sessions')
    .update({ resolved_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('resolved_at', null)
    .lt('updated_at', cutoff)
    .select('id');

  if (error) {
    throw new Error(`Failed to expire old sessions: ${error.message}`);
  }

  return data?.length ?? 0;
}

/**
 * Builds a follow-up prompt that includes the task label snapshot.
 *
 * Per VAL-SESSION-003, every follow-up question must include the task name
 * so the user knows which task is being discussed.
 */
export function buildFollowUpPrompt(
  taskLabel: string,
  promptType: string,
): string {
  switch (promptType) {
    case 'awaiting_time':
      return `What time would you like to be reminded about "${taskLabel}"?`;
    case 'awaiting_date':
      return `What date should I set for "${taskLabel}"?`;
    case 'awaiting_disambiguation':
      return `Which task did you mean? I have multiple active tasks and need to know which one you're referring to.`;
    default:
      return `Regarding "${taskLabel}" — could you provide more details?`;
  }
}
