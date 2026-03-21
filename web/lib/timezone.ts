/**
 * Shared timezone utilities for the web dashboard.
 *
 * Centralises getUserTimezone() so every component uses the same
 * implementation and avoids code duplication.
 */

/** User timezone — defaults to browser timezone. */
export function getUserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'America/Los_Angeles';
  }
}
