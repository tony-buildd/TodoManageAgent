# JavaScript Date Parsing — Timezone Gotcha

## The Bug Pattern

`new Date('YYYY-MM-DDThh:mm:ss')` **without a Z suffix** parses as **browser-local time**.
`new Date('YYYY-MM-DDThh:mm:ss' + 'Z')` parses as **UTC**.

If you construct a local-time string and then manually add a UTC offset, you **double-apply** the offset.

## Example (PDT, UTC-7)

```js
// WRONG — double offset
const dateStr = '2026-03-21T00:00:00'; // midnight local
const d = new Date(dateStr); // JS parses as midnight PDT = 07:00 UTC ✓
const offset = d.getTimezoneOffset(); // -420 min (PDT = UTC-7)
const utc = new Date(d.getTime() + offset * 60000); // adds -7h → 00:00 UTC ✗ (should be 07:00 UTC)
```

```js
// CORRECT — let JS handle the conversion
const dateStr = '2026-03-21T00:00:00'; // midnight local
return new Date(dateStr).toISOString(); // '2026-03-21T07:00:00.000Z' ✓
```

## When This Matters

- Converting user-local datetime inputs (e.g., `<input type="datetime-local">`) to UTC for Supabase queries
- Computing day boundaries (todayStart / todayEnd) in UTC from user's local date
- Any place you build a date string from components and need the UTC equivalent

## Rule

If the source time is already in browser-local time, use `new Date(localString).toISOString()` directly. Do not manually calculate or add timezone offsets.
