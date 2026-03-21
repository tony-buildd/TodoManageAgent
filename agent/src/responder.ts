/**
 * Responder module — a collection of action handlers.
 *
 * The dispatcher calls these functions as needed to send responses
 * back to the user. Each handler encapsulates a specific type of reply.
 *
 * All outbound messages are prefixed with [PT] via the agentSend helper.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Todo, ConversationSession } from './types.js';

/** Dependency bag passed to responder functions. */
export interface ResponderDeps {
  supabase: SupabaseClient;
  sendMessage: (text: string) => Promise<void>;
  userId: string;
  userTimezone: string;
}

/**
 * Send a friendly greeting response.
 */
export async function respondGreeting(deps: ResponderDeps): Promise<void> {
  const greetings = [
    "Hey! 👋 What can I help you with?",
    "Hi there! Need to set a reminder?",
    "Hello! What's on your mind?",
  ];
  const reply = greetings[Math.floor(Math.random() * greetings.length)];
  await deps.sendMessage(reply);
}

/**
 * Send an unsupported-feature response for recurring reminders.
 */
export async function respondRecurringUnsupported(deps: ResponderDeps): Promise<void> {
  await deps.sendMessage(
    "Recurring reminders aren't supported yet — that feature is planned for a future version. " +
    "For now, I can help with one-time reminders!",
  );
}

/**
 * Send a confirmation after creating a new task.
 */
export async function respondTaskCreated(
  deps: ResponderDeps,
  task: string,
  dueAt: string | null,
): Promise<void> {
  if (dueAt) {
    const d = new Date(dueAt);
    const timeStr = d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: deps.userTimezone,
    });
    await deps.sendMessage(`Got it! I'll remind you to "${task}" at ${timeStr}.`);
  } else {
    await deps.sendMessage(`Got it! I've noted "${task}". When should I remind you?`);
  }
}

/**
 * Confirm a task has been updated with a new time.
 */
export async function respondTaskUpdated(
  deps: ResponderDeps,
  task: string,
  dueAt: string,
): Promise<void> {
  const d = new Date(dueAt);
  const timeStr = d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: deps.userTimezone,
  });
  const dateStr = d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: deps.userTimezone,
  });
  await deps.sendMessage(
    `Updated "${task}" to ${dateStr} at ${timeStr}.`,
  );
}

/**
 * Ask the user for disambiguation when multiple sessions/tasks match.
 */
export async function respondDisambiguate(
  deps: ResponderDeps,
  taskLabels: string[],
): Promise<void> {
  const list = taskLabels.map((label, i) => `${i + 1}. ${label}`).join('\n');
  await deps.sendMessage(
    `Which task did you mean?\n${list}\nPlease reply with the task name or number.`,
  );
}

/**
 * Send a follow-up question (time, date, etc.) including the task name.
 */
export async function respondFollowUp(
  deps: ResponderDeps,
  taskLabel: string,
  promptType: string,
): Promise<void> {
  let message: string;
  switch (promptType) {
    case 'awaiting_time':
      message = `What time would you like to be reminded about "${taskLabel}"?`;
      break;
    case 'awaiting_date':
      message = `What date should I set for "${taskLabel}"?`;
      break;
    default:
      message = `Regarding "${taskLabel}" — could you provide more details?`;
  }
  await deps.sendMessage(message);
}

/**
 * Confirm a task has been marked as done.
 */
export async function respondTaskDone(
  deps: ResponderDeps,
  taskLabel: string,
): Promise<void> {
  await deps.sendMessage(`Nice! "${taskLabel}" marked as done. ✅`);
}

/**
 * Confirm a task has been canceled.
 */
export async function respondTaskCanceled(
  deps: ResponderDeps,
  taskLabel: string,
): Promise<void> {
  await deps.sendMessage(`"${taskLabel}" has been canceled.`);
}

/**
 * Respond when there are no active tasks to edit/cancel.
 */
export async function respondNoActiveTasks(deps: ResponderDeps): Promise<void> {
  await deps.sendMessage("You don't have any active tasks to update.");
}

/**
 * Ask the user to resend a partially ambiguous multi-task message.
 */
export async function respondResendClearer(deps: ResponderDeps): Promise<void> {
  await deps.sendMessage(
    "I wasn't able to parse all the tasks clearly. Could you resend them one at a time or more clearly?",
  );
}

/**
 * Send a generic LLM-generated or fallback response.
 */
export async function respondGeneric(
  deps: ResponderDeps,
  message: string,
): Promise<void> {
  await deps.sendMessage(message);
}

/**
 * Respond with a brief acknowledgment for lightweight replies like "ok", "got it".
 */
export async function respondAck(
  deps: ResponderDeps,
  taskLabel: string,
): Promise<void> {
  await deps.sendMessage(`Got it, I'll keep tracking "${taskLabel}".`);
}
