/**
 * Todo mutation helpers — Supabase PATCH operations for manual controls.
 *
 * Each function uses the shared Supabase client (anon key) to update
 * a single todo row. Returns a success/error result for the caller
 * to handle UI feedback.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Supabase client (lazy, client-side only)
// ---------------------------------------------------------------------------

let cachedClient: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient {
  if (cachedClient) return cachedClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      'Supabase configuration is missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.',
    );
  }

  cachedClient = createClient(url, key);
  return cachedClient;
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface MutationResult {
  success: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Edit task text
// ---------------------------------------------------------------------------

/**
 * Update a todo's task text.
 *
 * @param todoId - The todo row ID
 * @param newText - The new task text (trimmed, non-empty)
 */
export async function editTaskText(
  todoId: string,
  newText: string,
): Promise<MutationResult> {
  const trimmed = newText.trim();

  if (!trimmed) {
    return { success: false, error: 'Task text cannot be empty.' };
  }

  const supabase = getSupabaseClient();

  const { error } = await supabase
    .from('todos')
    .update({ task: trimmed })
    .eq('id', todoId);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

// ---------------------------------------------------------------------------
// Reschedule — update due_at and recalculate remind_at
// ---------------------------------------------------------------------------

/** Default lead minutes for reminder calculation. */
const DEFAULT_LEAD_MINUTES = 30;

/**
 * Calculate remind_at based on new due_at.
 *
 * If (due_at - lead_minutes) is in the past, remind_at = due_at.
 * Otherwise, remind_at = due_at - lead_minutes.
 */
function calculateRemindAt(
  dueAt: Date,
  leadMinutes: number = DEFAULT_LEAD_MINUTES,
): Date {
  const leadMs = leadMinutes * 60 * 1000;
  const proposedRemindAt = new Date(dueAt.getTime() - leadMs);
  const now = new Date();

  const remindAtIsInPast = proposedRemindAt < now;
  return remindAtIsInPast ? dueAt : proposedRemindAt;
}

/**
 * Reschedule a todo's due time. Also recalculates remind_at.
 *
 * @param todoId - The todo row ID
 * @param newDueAt - The new due_at as an ISO string or Date
 * @param leadMinutes - Lead time for reminder (default 30)
 */
export async function rescheduleTodo(
  todoId: string,
  newDueAt: string | Date,
  leadMinutes: number = DEFAULT_LEAD_MINUTES,
): Promise<MutationResult> {
  const dueDate = newDueAt instanceof Date ? newDueAt : new Date(newDueAt);

  if (isNaN(dueDate.getTime())) {
    return { success: false, error: 'Invalid date/time.' };
  }

  const remindAt = calculateRemindAt(dueDate, leadMinutes);

  const supabase = getSupabaseClient();

  const { error } = await supabase
    .from('todos')
    .update({
      due_at: dueDate.toISOString(),
      remind_at: remindAt.toISOString(),
    })
    .eq('id', todoId);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

// ---------------------------------------------------------------------------
// Cancel task
// ---------------------------------------------------------------------------

/**
 * Cancel a todo — sets status='canceled' and canceled_at=now().
 *
 * @param todoId - The todo row ID
 */
export async function cancelTodo(
  todoId: string,
): Promise<MutationResult> {
  const supabase = getSupabaseClient();

  const canceledAt = new Date().toISOString();

  const { error } = await supabase
    .from('todos')
    .update({
      status: 'canceled',
      canceled_at: canceledAt,
    })
    .eq('id', todoId);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

// ---------------------------------------------------------------------------
// Mark done
// ---------------------------------------------------------------------------

/**
 * Mark a todo as done — sets status='done' and completed_at=now().
 *
 * @param todoId - The todo row ID
 */
export async function markTodoDone(
  todoId: string,
): Promise<MutationResult> {
  const supabase = getSupabaseClient();

  const completedAt = new Date().toISOString();

  const { error } = await supabase
    .from('todos')
    .update({
      status: 'done',
      completed_at: completedAt,
    })
    .eq('id', todoId);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}
