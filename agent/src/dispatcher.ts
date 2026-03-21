/**
 * Rule-first inbound message dispatcher.
 *
 * Implements the full pipeline from the SPEC section 3 (Dispatcher flow):
 *   (a) skip [PT] messages
 *   (b) sanitize input via sanitize.ts
 *   (c) persist raw inbound log
 *   (d) check greeting rules
 *   (e) check recurring reminder patterns
 *   (f) load active sessions via sessions.ts
 *   (g) attempt deterministic follow-up resolution
 *   (h) attempt deterministic edit/cancel/done matching
 *   (i) attempt new-task extraction via time-parser.ts
 *   (j) only if still unclassified, call LLM
 *   (k) if still ambiguous, ask the user
 *
 * The LLM is ONLY called as a fallback (VAL-DISPATCH-004).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ConversationSession, Todo } from './types.js';
import { sanitizeInput } from './sanitize.js';
import { parseTime } from './time-parser.js';
import {
  getActiveSessions,
  findSessionForReply,
  resolveSession,
  updateSession,
} from './sessions.js';
import {
  respondGreeting,
  respondRecurringUnsupported,
  respondTaskCreated,
  respondFollowUp,
  respondDisambiguate,
  respondTaskDone,
  respondTaskCanceled,
  respondNoActiveTasks,
  respondResendClearer,
  respondGeneric,
  respondAck,
  type ResponderDeps,
} from './responder.js';

// ─── Regex patterns ─────────────────────────────────────────────────────────

/** Matches the [PT] prefix used by agent-sent messages. */
const AGENT_PREFIX_RE = /^\[PT\]/;

/**
 * Matches common greeting messages.
 * Anchored to start/end to avoid false positives on substrings.
 */
const GREETING_RE =
  /^(hi|hello|hey|sup|yo|good\s+morning|good\s+evening|good\s+afternoon|howdy|what'?s\s+up|hiya|heya)[\s!?.]*$/i;

/**
 * Matches recurring reminder patterns that are not yet supported.
 * e.g. "every day", "every friday", "every week", "every weekday", "daily", "weekly"
 */
const RECURRING_RE =
  /\bevery\s+(day|week|weekday|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday|month|morning|evening|night|hour)\b|\b(daily|weekly|monthly)\b/i;

/**
 * Matches "done" / "finished" commands.
 */
const DONE_RE = /^(done|finished|complete|completed|i'?m\s+done)[\s!.]*$/i;

/**
 * Matches cancel commands: "cancel that", "cancel [task name]", "nevermind", etc.
 */
const CANCEL_RE = /^(cancel\s+that|cancel\s+it|nevermind|never\s*mind)[\s!.]*$/i;

/**
 * Matches edit/reschedule commands.
 * "actually make that 9", "change it to 5pm", "not today tomorrow"
 */
const EDIT_TIME_RE =
  /^(actually\s+)?make\s+(that|it)\s+(.+)$|^change\s+(it\s+)?to\s+(.+)$|^not\s+today[\s,]+(.+)$/i;

/**
 * Non-task chatter that should be silently ignored when no session is active.
 */
const CHATTER_RE =
  /^(lol|lmao|hmm+|haha+|yeah|ok|okay|wha|mhm|heh|ha|k|nice|cool|ah|oh|true|yep|nah|nope|ikr|tbh|idk)[\s!?.]*$/i;

/**
 * Lightweight acknowledgment replies that keep an in_progress task unchanged.
 */
const ACK_RE =
  /^(ok|okay|got\s+it|on\s+it|will\s+do|sure|alright|yep|yeah)[\s!?.]*$/i;

/**
 * Detects multi-task patterns joined by "and" or commas.
 * Simple heuristic: presence of " and " with multiple time-parseable segments.
 */
const MULTI_TASK_SPLIT_RE = /\band\b|,/i;

/**
 * Common "remind me to" prefix.
 */
const REMIND_PREFIX_RE = /^remind\s+me\s+to\s+/i;

// ─── Types ──────────────────────────────────────────────────────────────────

/** Result of the dispatcher pipeline. */
export interface DispatchResult {
  /** Whether the message was handled (a response was or will be sent). */
  handled: boolean;
  /** Classification of what happened. */
  action:
    | 'skipped_agent_message'
    | 'greeting'
    | 'recurring_unsupported'
    | 'follow_up_resolved'
    | 'edit_cancel_done'
    | 'new_task'
    | 'multi_task'
    | 'llm_fallback'
    | 'ambiguous'
    | 'chatter_ignored'
    | 'ack';
}

/** Dependencies injected into the dispatcher. */
export interface DispatcherDeps {
  supabase: SupabaseClient;
  sendMessage: (text: string) => Promise<void>;
  userId: string;
  userTimezone: string;
  chatKey: string;
  /** LLM fallback — called only when rules can't classify the message. */
  llmParse?: (text: string) => Promise<string | null>;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Persist a raw inbound message log to the database.
 */
async function persistInboundLog(
  supabase: SupabaseClient,
  userId: string,
  rawMessage: string,
): Promise<void> {
  await supabase.from('message_logs').insert({
    user_id: userId,
    direction: 'inbound',
    raw_message: rawMessage,
  });
}

/**
 * Get active (non-done, non-canceled) todos for a user.
 */
async function getActiveTodos(
  supabase: SupabaseClient,
  userId: string,
): Promise<Todo[]> {
  const { data, error } = await supabase
    .from('todos')
    .select('*')
    .eq('user_id', userId)
    .in('status', ['pending', 'in_progress'])
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to get active todos: ${error.message}`);
  }

  return (data ?? []) as Todo[];
}

/**
 * Create a new todo record.
 */
async function createTodo(
  supabase: SupabaseClient,
  userId: string,
  task: string,
  dueAt: string | null,
): Promise<Todo> {
  const { data, error } = await supabase
    .from('todos')
    .insert({
      user_id: userId,
      task,
      due_at: dueAt,
      status: 'pending',
    })
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to create todo: ${error.message}`);
  }

  return data as Todo;
}

/**
 * Mark a todo as done.
 */
async function markTodoDone(
  supabase: SupabaseClient,
  todoId: string,
): Promise<void> {
  await supabase
    .from('todos')
    .update({
      status: 'done',
      completed_at: new Date().toISOString(),
    })
    .eq('id', todoId);
}

/**
 * Mark a todo as canceled.
 */
async function markTodoCanceled(
  supabase: SupabaseClient,
  todoId: string,
): Promise<void> {
  await supabase
    .from('todos')
    .update({
      status: 'canceled',
      canceled_at: new Date().toISOString(),
    })
    .eq('id', todoId);
}

/**
 * Update a todo's due_at.
 */
async function updateTodoDueAt(
  supabase: SupabaseClient,
  todoId: string,
  dueAt: string,
): Promise<void> {
  await supabase
    .from('todos')
    .update({ due_at: dueAt })
    .eq('id', todoId);
}

// ─── Main dispatcher ────────────────────────────────────────────────────────

/**
 * Process an inbound message through the rule-first pipeline.
 *
 * @param rawText - The raw message text from the user.
 * @param deps    - Injected dependencies (supabase, send, LLM, etc).
 * @returns A DispatchResult indicating what action was taken.
 */
export async function dispatch(
  rawText: string,
  deps: DispatcherDeps,
): Promise<DispatchResult> {
  const responderDeps: ResponderDeps = {
    supabase: deps.supabase,
    sendMessage: deps.sendMessage,
    userId: deps.userId,
  };

  // ── (a) Skip [PT] agent messages ─────────────────────────────────────
  if (AGENT_PREFIX_RE.test(rawText)) {
    return { handled: false, action: 'skipped_agent_message' };
  }

  // ── (b) Sanitize input ───────────────────────────────────────────────
  const text = sanitizeInput(rawText);
  if (!text) {
    return { handled: false, action: 'skipped_agent_message' };
  }

  // ── (c) Persist raw inbound log ──────────────────────────────────────
  await persistInboundLog(deps.supabase, deps.userId, rawText);

  // ── (d) Check greeting rules ─────────────────────────────────────────
  if (GREETING_RE.test(text)) {
    await respondGreeting(responderDeps);
    return { handled: true, action: 'greeting' };
  }

  // ── (e) Check recurring reminder patterns ────────────────────────────
  if (RECURRING_RE.test(text)) {
    await respondRecurringUnsupported(responderDeps);
    return { handled: true, action: 'recurring_unsupported' };
  }

  // ── (f) Load active sessions ─────────────────────────────────────────
  const activeSessions = await getActiveSessions(deps.supabase, deps.userId);

  // ── (g) Attempt deterministic follow-up resolution ───────────────────
  if (activeSessions.length > 0) {
    const matchedSession = findSessionForReply(text, activeSessions);

    if (matchedSession) {
      const result = await handleFollowUp(
        text,
        matchedSession,
        deps,
        responderDeps,
      );
      if (result) return result;
    } else if (activeSessions.length > 1) {
      // Ambiguous — need disambiguation
      const labels = activeSessions.map((s) => s.task_label_snapshot);
      await respondDisambiguate(responderDeps, labels);
      return { handled: true, action: 'follow_up_resolved' };
    }
    // If only 1 session and no match from findSessionForReply (shouldn't happen),
    // or if follow-up handling returned null, fall through to next steps
  }

  // ── (h) Attempt deterministic edit/cancel/done matching ──────────────
  if (DONE_RE.test(text)) {
    const activeTodos = await getActiveTodos(deps.supabase, deps.userId);
    if (activeTodos.length === 0) {
      await respondNoActiveTasks(responderDeps);
      return { handled: true, action: 'edit_cancel_done' };
    }
    if (activeTodos.length === 1) {
      await markTodoDone(deps.supabase, activeTodos[0].id);
      await respondTaskDone(responderDeps, activeTodos[0].task);
      return { handled: true, action: 'edit_cancel_done' };
    }
    // Multiple tasks — disambiguate
    await respondDisambiguate(
      responderDeps,
      activeTodos.map((t) => t.task),
    );
    return { handled: true, action: 'edit_cancel_done' };
  }

  if (CANCEL_RE.test(text)) {
    const activeTodos = await getActiveTodos(deps.supabase, deps.userId);
    if (activeTodos.length === 0) {
      await respondNoActiveTasks(responderDeps);
      return { handled: true, action: 'edit_cancel_done' };
    }
    if (activeTodos.length === 1) {
      await markTodoCanceled(deps.supabase, activeTodos[0].id);
      await respondTaskCanceled(responderDeps, activeTodos[0].task);
      return { handled: true, action: 'edit_cancel_done' };
    }
    // Multiple tasks — disambiguate
    await respondDisambiguate(
      responderDeps,
      activeTodos.map((t) => t.task),
    );
    return { handled: true, action: 'edit_cancel_done' };
  }

  const editMatch = EDIT_TIME_RE.exec(text);
  if (editMatch) {
    // Extract the time portion from whichever capture group matched
    const newTimeText = editMatch[3] ?? editMatch[5] ?? editMatch[6] ?? '';
    const activeTodos = await getActiveTodos(deps.supabase, deps.userId);

    if (activeTodos.length === 0) {
      await respondNoActiveTasks(responderDeps);
      return { handled: true, action: 'edit_cancel_done' };
    }

    if (activeTodos.length === 1 && newTimeText) {
      const parsed = parseTime(newTimeText, deps.userTimezone);
      if (parsed.date) {
        await updateTodoDueAt(
          deps.supabase,
          activeTodos[0].id,
          parsed.date.toISOString(),
        );
        await respondTaskCreated(
          responderDeps,
          activeTodos[0].task,
          parsed.date.toISOString(),
        );
        return { handled: true, action: 'edit_cancel_done' };
      }
    }

    if (activeTodos.length > 1) {
      await respondDisambiguate(
        responderDeps,
        activeTodos.map((t) => t.task),
      );
      return { handled: true, action: 'edit_cancel_done' };
    }
  }

  // ── (h.5) Lightweight ack for in_progress tasks ──────────────────────
  if (ACK_RE.test(text) && activeSessions.length > 0) {
    // Find in_progress task from sessions
    const session = activeSessions[0];
    if (session) {
      await respondAck(responderDeps, session.task_label_snapshot);
      return { handled: true, action: 'ack' };
    }
  }

  // ── Chatter with no session → ignore ─────────────────────────────────
  if (CHATTER_RE.test(text) && activeSessions.length === 0) {
    return { handled: false, action: 'chatter_ignored' };
  }

  // ── (i) Attempt new-task extraction ──────────────────────────────────
  const newTaskResult = await tryNewTaskExtraction(text, deps, responderDeps);
  if (newTaskResult) return newTaskResult;

  // ── (j) LLM fallback ────────────────────────────────────────────────
  if (deps.llmParse) {
    const llmResponse = await deps.llmParse(text);
    if (llmResponse) {
      await respondGeneric(responderDeps, llmResponse);
      return { handled: true, action: 'llm_fallback' };
    }
  }

  // ── (k) Ambiguous — ask the user ────────────────────────────────────
  // If we get here and there's content that doesn't match anything, just
  // silently ignore (non-task chatter without sessions)
  if (!activeSessions.length) {
    return { handled: false, action: 'chatter_ignored' };
  }

  await respondGeneric(
    responderDeps,
    "I'm not sure what you mean. Could you rephrase that?",
  );
  return { handled: true, action: 'ambiguous' };
}

// ─── Follow-up handling ─────────────────────────────────────────────────────

/**
 * Handle a matched follow-up session reply.
 *
 * Time replies → update due_at via time-parser.
 * "done" / "finished" → mark task done.
 * Other → depends on session state.
 */
async function handleFollowUp(
  text: string,
  session: ConversationSession,
  deps: DispatcherDeps,
  responderDeps: ResponderDeps,
): Promise<DispatchResult | null> {
  // Done/finished replies
  if (DONE_RE.test(text) && session.related_todo_id) {
    await markTodoDone(deps.supabase, session.related_todo_id);
    await resolveSession(deps.supabase, session.id);
    await respondTaskDone(responderDeps, session.task_label_snapshot);
    return { handled: true, action: 'follow_up_resolved' };
  }

  // Lightweight ack replies
  if (ACK_RE.test(text)) {
    await respondAck(responderDeps, session.task_label_snapshot);
    return { handled: true, action: 'ack' };
  }

  // Time replies for awaiting_time / awaiting_date sessions
  if (
    session.state === 'awaiting_time' ||
    session.state === 'awaiting_date'
  ) {
    const parsed = parseTime(text, deps.userTimezone);
    if (parsed.date && session.related_todo_id) {
      await updateTodoDueAt(
        deps.supabase,
        session.related_todo_id,
        parsed.date.toISOString(),
      );
      await resolveSession(deps.supabase, session.id);
      await respondTaskCreated(
        responderDeps,
        session.task_label_snapshot,
        parsed.date.toISOString(),
      );
      return { handled: true, action: 'follow_up_resolved' };
    }
  }

  // Cancel in the context of a session
  if (CANCEL_RE.test(text) && session.related_todo_id) {
    await markTodoCanceled(deps.supabase, session.related_todo_id);
    await resolveSession(deps.supabase, session.id);
    await respondTaskCanceled(responderDeps, session.task_label_snapshot);
    return { handled: true, action: 'follow_up_resolved' };
  }

  // Couldn't handle — return null to let pipeline continue
  return null;
}

// ─── New-task extraction ────────────────────────────────────────────────────

/**
 * Attempt to extract and create new tasks from the message text.
 *
 * Handles:
 * - Single tasks with or without time
 * - Multi-task patterns ("X and Y")
 * - Partially ambiguous multi-task messages
 */
async function tryNewTaskExtraction(
  text: string,
  deps: DispatcherDeps,
  responderDeps: ResponderDeps,
): Promise<DispatchResult | null> {
  // Strip "remind me to" prefix for cleaner parsing
  const cleanedText = text.replace(REMIND_PREFIX_RE, '');

  // Check for multi-task patterns
  if (MULTI_TASK_SPLIT_RE.test(cleanedText)) {
    const parts = cleanedText.split(MULTI_TASK_SPLIT_RE).map((p) => p.trim()).filter(Boolean);

    if (parts.length >= 2) {
      // Parse each part separately
      const parsedParts = parts.map((part) => parseTime(part, deps.userTimezone));

      // Check if ALL parts have clear time extraction
      const allClear = parsedParts.every(
        (p) => p.date !== null && p.taskText.trim().length > 0,
      );

      if (allClear) {
        // Create separate todos for each task
        for (const parsed of parsedParts) {
          await createTodo(
            deps.supabase,
            deps.userId,
            parsed.taskText,
            parsed.date!.toISOString(),
          );
          await respondTaskCreated(
            responderDeps,
            parsed.taskText,
            parsed.date!.toISOString(),
          );
        }
        return { handled: true, action: 'multi_task' };
      }

      // Check if some parts are ambiguous
      const someClear = parsedParts.some((p) => p.date !== null);
      if (someClear && !allClear) {
        // Partially ambiguous — ask to resend
        await respondResendClearer(responderDeps);
        return { handled: true, action: 'multi_task' };
      }
    }
  }

  // Single-task extraction
  const parsed = parseTime(cleanedText, deps.userTimezone);

  if (parsed.date) {
    const taskText = parsed.taskText || cleanedText.replace(/at\s+\S+/i, '').trim();
    if (taskText) {
      await createTodo(
        deps.supabase,
        deps.userId,
        taskText,
        parsed.date.toISOString(),
      );
      await respondTaskCreated(responderDeps, taskText, parsed.date.toISOString());
      return { handled: true, action: 'new_task' };
    }
  }

  // Check if it looks like a task even without time (has verb-like content)
  // but only if it's not chatter
  if (
    !CHATTER_RE.test(text) &&
    parsed.taskText.length > 3 &&
    /\b(remind|get|buy|call|text|pick\s*up|do|make|send|write|read|clean|cook|meet|go|take|bring|finish|start|stop|check|fix|update|submit|review|book|schedule|prepare|organize|plan)\b/i.test(text)
  ) {
    // Looks like a task without a time — create it and ask for time
    const taskText = text.replace(REMIND_PREFIX_RE, '').trim();
    await createTodo(deps.supabase, deps.userId, taskText, null);
    await respondTaskCreated(responderDeps, taskText, null);
    return { handled: true, action: 'new_task' };
  }

  return null;
}

// ─── Exported for testing ───────────────────────────────────────────────────

export const _testExports = {
  GREETING_RE,
  RECURRING_RE,
  DONE_RE,
  CANCEL_RE,
  EDIT_TIME_RE,
  CHATTER_RE,
  ACK_RE,
  AGENT_PREFIX_RE,
  persistInboundLog,
  getActiveTodos,
  createTodo,
  markTodoDone,
  markTodoCanceled,
  updateTodoDueAt,
};
