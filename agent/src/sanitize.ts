/**
 * Input sanitization module.
 *
 * Cleans raw user text before it enters the parsing pipeline:
 *  - Trims leading/trailing whitespace
 *  - Collapses multiple consecutive spaces into one
 *  - Strips trailing junk characters (unmatched brackets, stray punctuation)
 *  - Normalizes common punctuation noise
 *  - Preserves meaningful time/date tokens
 */

/**
 * Characters considered "trailing junk" — unmatched brackets, stray pipes, etc.
 * These appear at the end of a message due to accidental keyboard taps.
 */
const TRAILING_JUNK_RE = /[\]\[}{|\\~`]+$/;

/**
 * Collapse runs of whitespace (spaces, tabs, etc.) to a single space.
 */
const MULTI_SPACE_RE = /\s+/g;

/**
 * Smart-quote and curly-quote pairs → straight equivalents.
 */
const SMART_QUOTE_MAP: Record<string, string> = {
  '\u2018': "'", // '
  '\u2019': "'", // '
  '\u201C': '"', // "
  '\u201D': '"', // "
};
const SMART_QUOTE_RE = /[\u2018\u2019\u201C\u201D]/g;

/**
 * Em-dashes and en-dashes → regular hyphen-minus.
 */
const DASH_RE = /[\u2013\u2014]/g;

/**
 * Ellipsis character → three dots.
 */
const ELLIPSIS_RE = /\u2026/g;

/**
 * Sanitizes raw user input text.
 *
 * 1. Trim leading/trailing whitespace
 * 2. Normalize smart quotes → ASCII quotes
 * 3. Normalize dashes (em/en → hyphen)
 * 4. Normalize ellipsis character
 * 5. Collapse multiple whitespace characters to a single space
 * 6. Strip trailing junk characters (unmatched ], [, {, }, |, \, ~, `)
 *
 * Time and date tokens (e.g. "8:50", "3pm", "tomorrow") are intentionally
 * preserved so downstream parsers can extract them.
 */
export function sanitizeInput(text: string): string {
  let cleaned = text;

  // 1. Trim
  cleaned = cleaned.trim();

  // 2. Smart quotes → ASCII
  cleaned = cleaned.replace(SMART_QUOTE_RE, (ch) => SMART_QUOTE_MAP[ch] ?? ch);

  // 3. Em/en dashes → hyphen
  cleaned = cleaned.replace(DASH_RE, '-');

  // 4. Ellipsis → dots
  cleaned = cleaned.replace(ELLIPSIS_RE, '...');

  // 5. Collapse whitespace
  cleaned = cleaned.replace(MULTI_SPACE_RE, ' ');

  // 6. Strip trailing junk (may repeat after trimming)
  cleaned = cleaned.replace(TRAILING_JUNK_RE, '').trimEnd();

  return cleaned;
}
