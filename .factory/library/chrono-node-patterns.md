# chrono-node Parsing Patterns

## Bare numbers don't parse reliably

Bare numbers like `"9"` or `"3"` are not parsed by chrono-node as time references. You need an `"at"` prefix: `"at 9"` works, `"9"` alone does not.

**Workaround in dispatcher.ts:** Before passing to `parseTime()`, check for bare number input with `/^\d{1,2}$/` and prepend `"at "`.

## Timezone option uses minute offsets, not IANA strings

The `timezones` option in `chrono.parse()` expects a map of abbreviation → minute offset (e.g., `{ EST: -300, PST: -480 }`), not IANA timezone strings.

## AM/PM defaults

chrono-node has internal AM/PM heuristics. The project adds a custom refiner (in `time-parser.ts`) that applies a binary rule:
- Before noon → default to AM
- Noon or later → default to PM

This is applied only when `meridiem` is not certain and the hour is in the 1-12 ambiguous range.

## Reference date timezone

Pass `{ instant, timezone }` as the reference to `chrono.parse()` to ensure relative expressions ("today", "tomorrow") are interpreted in the user's timezone.
