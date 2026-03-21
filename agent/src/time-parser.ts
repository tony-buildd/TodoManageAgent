/**
 * Deterministic time parsing module.
 *
 * Uses chrono-node for rule-based date/time extraction from natural language.
 * This runs BEFORE any LLM call — if chrono-node succeeds, the LLM is skipped
 * for time parsing (see VAL-PARSE-007).
 */

import * as chrono from 'chrono-node';

import type { ParseTimeResult } from './types.js';

/**
 * Mapping of common timezone abbreviations to minute offsets.
 * chrono-node handles most, but we ensure the common US ones are explicit.
 */
const TIMEZONE_OFFSETS: Record<string, number> = {
  EST: -300, // UTC-5
  EDT: -240, // UTC-4
  CST: -360, // UTC-6
  CDT: -300, // UTC-5
  MST: -420, // UTC-7
  MDT: -360, // UTC-6
  PST: -480, // UTC-8
  PDT: -420, // UTC-7
  AKST: -540, // UTC-9
  AKDT: -480, // UTC-8
  HST: -600, // UTC-10
};

/**
 * Regex to detect explicit timezone abbreviations in the text.
 */
const EXPLICIT_TZ_RE =
  /\b(EST|EDT|CST|CDT|MST|MDT|PST|PDT|AKST|AKDT|HST)\b/i;

/**
 * Build a reference instant for chrono-node in the user's timezone.
 *
 * We create a Date whose wall-clock time in the user's timezone matches
 * the current moment, so chrono-node interprets relative expressions
 * ("today", "tomorrow", bare times) in the user's local time.
 */
function buildReference(
  userTimezone: string,
  referenceDate?: Date,
): { instant: Date; timezone: string } {
  const instant = referenceDate ?? new Date();
  return { instant, timezone: userTimezone };
}

/**
 * Determine the current hour (0-23) in the user's timezone.
 */
function getCurrentHourInTz(
  userTimezone: string,
  referenceDate?: Date,
): number {
  const now = referenceDate ?? new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    hour12: false,
    timeZone: userTimezone,
  });
  return parseInt(formatter.format(now), 10);
}

/**
 * Create a customised chrono instance with AM/PM contextual refinement.
 *
 * When a bare hour (e.g. "8") has no AM/PM, we apply context:
 *  - If current time is before noon → default to AM
 *  - If current time is noon or later → default to PM
 */
function createChronoInstance(
  userTimezone: string,
  referenceDate?: Date,
): chrono.Chrono {
  const custom = chrono.casual.clone();

  custom.refiners.push({
    refine: (_context, results) => {
      const currentHour = getCurrentHourInTz(userTimezone, referenceDate);

      for (const result of results) {
        if (
          !result.start.isCertain('meridiem') &&
          result.start.get('hour') !== null
        ) {
          const hour = result.start.get('hour')!;
          // Only apply contextual default for hours 1-12 (ambiguous range)
          if (hour >= 1 && hour <= 12) {
            if (currentHour >= 12) {
              // Afternoon/evening context → default to PM
              result.start.assign('meridiem', 1);
              if (hour < 12) {
                result.start.assign('hour', hour + 12);
              }
            } else {
              // Morning context → default to AM
              result.start.assign('meridiem', 0);
              if (hour === 12) {
                result.start.assign('hour', 0);
              }
            }
          }
        }
      }
      return results;
    },
  });

  return custom;
}

/**
 * Check if the parsed date is in the past relative to the reference moment
 * in the user's timezone, and if so, advance it by one day.
 *
 * This handles the spec rule: "defaults to tomorrow if extracted time
 * is already past for today".
 */
function adjustPastTimeToTomorrow(
  parsedDate: Date,
  referenceDate: Date,
  result: chrono.ParsedResult,
): Date {
  // Only adjust if no explicit day/date was mentioned
  const hasCertainDay =
    result.start.isCertain('day') ||
    result.start.isCertain('weekday');

  if (!hasCertainDay && parsedDate.getTime() < referenceDate.getTime()) {
    // Advance by 24 hours
    return new Date(parsedDate.getTime() + 24 * 60 * 60 * 1000);
  }
  return parsedDate;
}

/**
 * Remove the matched time/date text from the original string and clean up.
 */
function extractTaskText(
  originalText: string,
  results: chrono.ParsedResult[],
): string {
  let taskText = originalText;

  // Remove matched fragments from right to left to preserve indices
  const sortedResults = [...results].sort((a, b) => b.index - a.index);

  for (const result of sortedResults) {
    const before = taskText.slice(0, result.index);
    const after = taskText.slice(result.index + result.text.length);
    taskText = before + after;
  }

  // Clean up common prepositions left dangling after removal
  taskText = taskText
    .replace(/\b(at|on|by|from|until|before|after|around)\s*$/i, '')
    .replace(/\b(at|on|by|from|until|before|after|around)\s+(at|on|by|from|until|before|after|around)\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Remove trailing prepositions left over
  taskText = taskText.replace(/\s+(at|on|by|from|until|before|after|around)\s*$/i, '').trim();

  return taskText;
}

/**
 * Parse date/time from natural language text using chrono-node.
 *
 * @param text - The input text to parse (should already be sanitized).
 * @param userTimezone - IANA timezone string (e.g. "America/Los_Angeles").
 * @param referenceDate - Optional reference date (defaults to now).
 * @returns Object with parsed date (or null) and cleaned task text.
 */
export function parseTime(
  text: string,
  userTimezone: string,
  referenceDate?: Date,
): ParseTimeResult {
  const ref = buildReference(userTimezone, referenceDate);
  const refDate = referenceDate ?? new Date();

  // Detect if there's an explicit timezone in the text
  const explicitTzMatch = text.match(EXPLICIT_TZ_RE);

  // Build chrono instance with AM/PM contextual refinement
  const chronoInstance = createChronoInstance(userTimezone, referenceDate);

  // Parse with chrono-node using the user's timezone as reference
  const results = chronoInstance.parse(text, ref, {
    forwardDate: false, // We handle forward-dating ourselves
    timezones: TIMEZONE_OFFSETS,
  });

  if (results.length === 0) {
    return { date: null, taskText: text };
  }

  // Use the first (most prominent) result
  const result = results[0];
  let parsedDate = result.start.date();

  // If there's an explicit timezone, chrono-node should have handled it
  // via the timezones option. If no explicit TZ, chrono used the user's
  // default timezone from the reference — which is what we want.

  // Adjust past times to tomorrow (only when no day was specified)
  parsedDate = adjustPastTimeToTomorrow(parsedDate, refDate, result);

  // Extract clean task text
  const taskText = extractTaskText(text, results);

  return { date: parsedDate, taskText };
}
