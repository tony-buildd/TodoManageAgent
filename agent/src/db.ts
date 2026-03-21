import type { SupabaseClient } from '@supabase/supabase-js';
import type { User, Todo } from './types.js';

/**
 * Creates or retrieves a user by phone number using an upsert pattern.
 * Safe to call multiple times with the same phone — will never create duplicates.
 *
 * Uses Supabase's upsert with onConflict on the unique `phone` column.
 * If the user already exists, the existing row is returned without modification.
 * If the user doesn't exist, a new row is created with default timezone and lead_minutes.
 */
export async function getOrCreateUser(
  supabase: SupabaseClient,
  phone: string,
  defaults?: { timezone?: string; lead_minutes?: number },
): Promise<User> {
  const timezone = defaults?.timezone ?? 'America/Los_Angeles';
  const lead_minutes = defaults?.lead_minutes ?? 30;

  const { data, error } = await supabase
    .from('users')
    .upsert(
      {
        phone,
        timezone,
        reminder_lead_minutes: lead_minutes,
      },
      {
        onConflict: 'phone',
      },
    )
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to get or create user: ${error.message}`);
  }

  return data as User;
}

/**
 * Calculate remind_at for a task.
 *
 * If due_at - lead_minutes is in the past (or now), remind_at = due_at.
 * Otherwise remind_at = due_at - lead_minutes.
 *
 * @param dueAt  - The task's due date/time.
 * @param leadMinutes - Minutes before due_at to send the reminder.
 * @param now - The current time (injectable for testing).
 * @returns The ISO string for remind_at.
 */
export function calcRemindAt(
  dueAt: Date,
  leadMinutes: number,
  now: Date = new Date(),
): string {
  const candidate = new Date(dueAt.getTime() - leadMinutes * 60 * 1000);
  if (candidate.getTime() <= now.getTime()) {
    return dueAt.toISOString();
  }
  return candidate.toISOString();
}

/**
 * Get pending todos whose remind_at is due (remind_at <= now).
 *
 * Only returns tasks with status='pending' (VAL-REMIND-003).
 * Tasks that are already done or canceled are excluded.
 */
export async function getDueReminders(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<Todo[]> {
  const { data, error } = await supabase
    .from('todos')
    .select('*')
    .eq('status', 'pending')
    .not('remind_at', 'is', null)
    .lte('remind_at', now.toISOString());

  if (error) {
    throw new Error(`Failed to get due reminders: ${error.message}`);
  }

  return (data ?? []) as Todo[];
}

/**
 * Get in_progress tasks that have exceeded the grace period.
 *
 * A task is past grace when: status='in_progress' AND due_at + graceMins < now.
 * These will be transitioned to not_confirmed (VAL-REMIND-004).
 */
export async function getGracePeriodExpired(
  supabase: SupabaseClient,
  graceMins: number = 15,
  now: Date = new Date(),
): Promise<Todo[]> {
  const cutoff = new Date(now.getTime() - graceMins * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('todos')
    .select('*')
    .eq('status', 'in_progress')
    .not('due_at', 'is', null)
    .lt('due_at', cutoff);

  if (error) {
    throw new Error(`Failed to get grace period expired tasks: ${error.message}`);
  }

  return (data ?? []) as Todo[];
}

/**
 * Get not_confirmed tasks from today for a given user and timezone.
 *
 * Used by the end-of-day summary to list unresolved tasks (VAL-EOD-001).
 *
 * @param supabase - The Supabase client.
 * @param userId - The user to query for.
 * @param timezone - The user's timezone (e.g. 'America/Los_Angeles').
 * @param now - Current time (injectable for testing).
 */
export async function getNotConfirmedToday(
  supabase: SupabaseClient,
  userId: string,
  timezone: string,
  now: Date = new Date(),
): Promise<Todo[]> {
  // Compute start and end of today in user's timezone
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const todayStr = formatter.format(now); // "YYYY-MM-DD"
  // Build start/end of day in the user's timezone using a trick:
  // Parse the date string and create UTC bounds for the timezone offset
  const startOfDay = new Date(`${todayStr}T00:00:00`);
  const endOfDay = new Date(`${todayStr}T23:59:59.999`);

  // Convert to timezone-aware bounds by using the timezone offset
  // We use the Intl API to get the actual offset for the given timezone
  const tzOffset = getTimezoneOffsetMs(timezone, now);
  const startUtc = new Date(startOfDay.getTime() + tzOffset);
  const endUtc = new Date(endOfDay.getTime() + tzOffset);

  const { data, error } = await supabase
    .from('todos')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'not_confirmed')
    .gte('not_confirmed_at', startUtc.toISOString())
    .lte('not_confirmed_at', endUtc.toISOString());

  if (error) {
    throw new Error(`Failed to get not_confirmed tasks today: ${error.message}`);
  }

  return (data ?? []) as Todo[];
}

/**
 * Get the timezone offset in milliseconds for a given timezone at a given time.
 * Returns the number of ms to ADD to local time to get UTC.
 */
function getTimezoneOffsetMs(timezone: string, date: Date): number {
  // Format the date in both UTC and the target timezone, then compute the difference
  const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' });
  const tzStr = date.toLocaleString('en-US', { timeZone: timezone });
  const utcDate = new Date(utcStr);
  const tzDate = new Date(tzStr);
  return utcDate.getTime() - tzDate.getTime();
}
