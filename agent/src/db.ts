import type { SupabaseClient } from '@supabase/supabase-js';
import type { User } from './types.js';

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
        lead_minutes,
      },
      {
        onConflict: 'phone',
        ignoreDuplicates: true,
      },
    )
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to get or create user: ${error.message}`);
  }

  return data as User;
}
