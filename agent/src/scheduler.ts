/**
 * Scheduler module — periodic checks for reminder delivery,
 * grace period transitions, and end-of-day summary.
 *
 * The scheduler runs on a 30-second tick interval and performs:
 *   1. Send pending reminders whose remind_at <= now → transitions to in_progress
 *   2. Move in_progress tasks past grace (due_at + 15 min) → not_confirmed (no chat message)
 *   3. At 10 PM local time, send EOD summary of not_confirmed tasks (once per day)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Todo, User } from './types.js';
import {
  getDueReminders,
  getGracePeriodExpired,
  getNotConfirmedToday,
} from './db.js';

// ─── Constants ──────────────────────────────────────────────────────────────

/** Default grace period in minutes before transitioning to not_confirmed. */
const DEFAULT_GRACE_MINS = 15;

/** Scheduler tick interval in milliseconds (30 seconds). */
const TICK_INTERVAL_MS = 30_000;

/** The hour (in 24h format) for the end-of-day summary. */
const EOD_HOUR = 22; // 10 PM

// ─── Types ──────────────────────────────────────────────────────────────────

/** Dependencies injected into the scheduler. */
export interface SchedulerDeps {
  supabase: SupabaseClient;
  sendMessage: (text: string) => Promise<void>;
  userId: string;
  userTimezone: string;
  /** Optional grace period override (for testing). */
  graceMinutes?: number;
  /** Optional clock override (for testing). */
  now?: () => Date;
}

/** Result of a single scheduler tick. */
export interface TickResult {
  remindersSent: number;
  gracePeriodTransitions: number;
  eodSummarySent: boolean;
}

// ─── State ──────────────────────────────────────────────────────────────────

/**
 * Tracks the last date (YYYY-MM-DD in user timezone) an EOD summary was sent.
 * This prevents sending multiple summaries per day.
 */
let lastSummaryDate: string | null = null;

/**
 * Reset the last summary date tracker (exposed for testing).
 */
export function resetLastSummaryDate(): void {
  lastSummaryDate = null;
}

/**
 * Get the current last summary date (exposed for testing).
 */
export function getLastSummaryDate(): string | null {
  return lastSummaryDate;
}

// ─── Reminder sending ───────────────────────────────────────────────────────

/**
 * Send due reminders for pending tasks.
 *
 * For each pending task with remind_at <= now:
 *   - Check the task is still pending (prevents redundant send if user completed it)
 *   - Send a reminder chat message
 *   - Update status to 'in_progress' and stamp reminded_at
 *
 * Returns the number of reminders sent.
 */
export async function sendDueReminders(deps: SchedulerDeps): Promise<number> {
  const now = deps.now?.() ?? new Date();
  const dueReminders = await getDueReminders(deps.supabase, now);

  let sent = 0;
  for (const todo of dueReminders) {
    // Re-check status to prevent redundant send (VAL-EDGE-004)
    const { data: fresh } = await deps.supabase
      .from('todos')
      .select('status')
      .eq('id', todo.id)
      .single();

    if (!fresh || fresh.status !== 'pending') {
      continue; // Task was completed or changed since query
    }

    // Send reminder message
    const timeStr = todo.due_at
      ? new Date(todo.due_at).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
          timeZone: deps.userTimezone,
        })
      : 'soon';
    await deps.sendMessage(
      `⏰ Reminder: "${todo.task}" is due at ${timeStr}. Reply "done" when complete.`,
    );

    // Transition to in_progress with reminded_at
    await deps.supabase
      .from('todos')
      .update({
        status: 'in_progress',
        reminded_at: now.toISOString(),
      })
      .eq('id', todo.id);

    sent++;
  }

  return sent;
}

// ─── Grace period check ─────────────────────────────────────────────────────

/**
 * Transition in_progress tasks past their grace period to not_confirmed.
 *
 * For each in_progress task where due_at + graceMinutes < now:
 *   - Set status to 'not_confirmed' and stamp not_confirmed_at
 *   - NO chat message is sent (VAL-REMIND-005)
 *
 * Returns the number of transitions made.
 */
export async function checkGracePeriod(deps: SchedulerDeps): Promise<number> {
  const now = deps.now?.() ?? new Date();
  const graceMins = deps.graceMinutes ?? DEFAULT_GRACE_MINS;
  const expired = await getGracePeriodExpired(deps.supabase, graceMins, now);

  let transitioned = 0;
  for (const todo of expired) {
    await deps.supabase
      .from('todos')
      .update({
        status: 'not_confirmed',
        not_confirmed_at: now.toISOString(),
      })
      .eq('id', todo.id);

    transitioned++;
  }

  return transitioned;
}

// ─── End-of-day summary ─────────────────────────────────────────────────────

/**
 * Get the current local date string (YYYY-MM-DD) in the user's timezone.
 */
function getLocalDateStr(timezone: string, date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * Get the current hour in the user's timezone.
 */
function getLocalHour(timezone: string, date: Date): number {
  return parseInt(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    }).format(date),
    10,
  );
}

/**
 * Send end-of-day summary at 10 PM local time if there are not_confirmed tasks.
 *
 * - Only triggers when the current local hour is EOD_HOUR (22 / 10 PM)
 * - Only sends once per day (tracked via lastSummaryDate)
 * - If no not_confirmed tasks exist, no message is sent (VAL-EOD-002)
 *
 * Returns whether a summary was sent.
 */
export async function checkEodSummary(deps: SchedulerDeps): Promise<boolean> {
  const now = deps.now?.() ?? new Date();
  const localHour = getLocalHour(deps.userTimezone, now);
  const todayStr = getLocalDateStr(deps.userTimezone, now);

  // Only run during the 10 PM hour
  if (localHour !== EOD_HOUR) {
    return false;
  }

  // Only send once per day
  if (lastSummaryDate === todayStr) {
    return false;
  }

  // Query not_confirmed tasks from today
  const notConfirmed = await getNotConfirmedToday(
    deps.supabase,
    deps.userId,
    deps.userTimezone,
    now,
  );

  if (notConfirmed.length === 0) {
    // Mark as sent so we don't re-check this day
    lastSummaryDate = todayStr;
    return false;
  }

  // Build summary message
  const items = notConfirmed.map((t, i) => {
    const timeStr = t.due_at
      ? new Date(t.due_at).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
          timeZone: deps.userTimezone,
        })
      : 'no time set';
    return `${i + 1}. ${t.task} (was due ${timeStr})`;
  });

  const message =
    `End of day summary: You have ${notConfirmed.length} unresolved task${notConfirmed.length === 1 ? '' : 's'} today:\n` +
    items.join('\n') +
    '\nReply "done [task]" to mark them complete.';

  await deps.sendMessage(message);

  // Mark today's summary as sent
  lastSummaryDate = todayStr;
  return true;
}

// ─── Main tick ──────────────────────────────────────────────────────────────

/**
 * Execute one scheduler tick — runs all three checks in sequence.
 *
 * 1. Send due reminders (pending → in_progress)
 * 2. Check grace period (in_progress → not_confirmed, no chat)
 * 3. Check EOD summary (10 PM not_confirmed listing)
 */
export async function tick(deps: SchedulerDeps): Promise<TickResult> {
  const remindersSent = await sendDueReminders(deps);
  const gracePeriodTransitions = await checkGracePeriod(deps);
  const eodSummarySent = await checkEodSummary(deps);

  return {
    remindersSent,
    gracePeriodTransitions,
    eodSummarySent,
  };
}

/**
 * Start the scheduler loop.
 *
 * Returns a cleanup function to stop the interval.
 */
export function startScheduler(deps: SchedulerDeps): () => void {
  const intervalId = setInterval(async () => {
    try {
      await tick(deps);
    } catch (err) {
      console.error('[Scheduler] Tick error:', err);
    }
  }, TICK_INTERVAL_MS);

  return () => {
    clearInterval(intervalId);
  };
}
