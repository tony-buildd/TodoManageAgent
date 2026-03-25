function unitToMs(unit: string, amount: number): number | null {
  if (/^seconds?$/.test(unit)) return amount * 1000;
  if (/^(mins?|minutes?)$/.test(unit)) return amount * 60_000;
  if (/^(hours?|hrs?)$/.test(unit)) return amount * 3_600_000;
  if (/^days?$/.test(unit)) return amount * 86_400_000;
  if (/^weeks?$/.test(unit)) return amount * 604_800_000;
  return null;
}

function setTime(d: Date, hourStr: string, minStr?: string, ampm?: string): Date | null {
  let hour = parseInt(hourStr, 10);
  const min = minStr ? parseInt(minStr, 10) : 0;

  if (ampm) {
    if (ampm === "pm" && hour < 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
  }

  if (hour < 0 || hour > 23 || min < 0 || min > 59) return null;
  d.setHours(hour, min, 0, 0);
  return d;
}

function nextDayOfWeek(dayName: string): Date {
  const days: Record<string, number> = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
    thursday: 4, friday: 5, saturday: 6,
  };
  const target = days[dayName]!;
  const now = new Date();
  const current = now.getDay();
  let diff = target - current;
  if (diff <= 0) diff += 7;
  const d = new Date(now);
  d.setDate(d.getDate() + diff);
  return d;
}

export function resolveTimeExpr(expr: string): Date | null {
  const now = new Date();
  const lower = expr.toLowerCase().trim();

  // "in X minutes/hours/days/seconds"
  const relMatch = lower.match(/^in\s+(\d+)\s*(seconds?|mins?|minutes?|hours?|hrs?|days?|weeks?)$/);
  if (relMatch) {
    const amount = parseInt(relMatch[1]!, 10);
    const unit = relMatch[2]!;
    const ms = unitToMs(unit, amount);
    if (ms !== null) return new Date(now.getTime() + ms);
  }

  // "in 1.5 hours" (decimal)
  const decimalRelMatch = lower.match(/^in\s+(\d+(?:\.\d+))\s*(seconds?|mins?|minutes?|hours?|hrs?|days?|weeks?)$/);
  if (decimalRelMatch) {
    const amount = parseFloat(decimalRelMatch[1]!);
    const unit = decimalRelMatch[2]!;
    const ms = unitToMs(unit, amount);
    if (ms !== null) return new Date(now.getTime() + ms);
  }

  // "in an hour", "in a minute"
  if (/^in\s+an?\s+hour$/.test(lower)) return new Date(now.getTime() + 3_600_000);
  if (/^in\s+an?\s+minute$/.test(lower)) return new Date(now.getTime() + 60_000);

  // "in half an hour"
  if (/^in\s+half\s+an?\s+hour$/.test(lower)) return new Date(now.getTime() + 1_800_000);

  // "in a few minutes"
  if (/^in\s+a\s+few\s+minutes$/.test(lower)) return new Date(now.getTime() + 5 * 60_000);

  // "in an hour and a half"
  if (/^in\s+an?\s+hour\s+and\s+a\s+half$/.test(lower)) return new Date(now.getTime() + 90 * 60_000);

  // "in an hour and N minutes"
  const hourAndMinMatch = lower.match(/^in\s+an?\s+hour\s+and\s+(\d+)\s*(mins?|minutes?)$/);
  if (hourAndMinMatch) {
    const mins = parseInt(hourAndMinMatch[1]!, 10);
    return new Date(now.getTime() + (60 + mins) * 60_000);
  }

  // "in X hours and Y minutes"
  const hoursAndMinMatch = lower.match(/^in\s+(\d+)\s*(?:hours?|hrs?)\s+and\s+(\d+)\s*(mins?|minutes?)$/);
  if (hoursAndMinMatch) {
    const hours = parseInt(hoursAndMinMatch[1]!, 10);
    const mins = parseInt(hoursAndMinMatch[2]!, 10);
    return new Date(now.getTime() + (hours * 60 + mins) * 60_000);
  }

  // "in X hours and a half"
  const hoursAndHalfMatch = lower.match(/^in\s+(\d+)\s*(?:hours?|hrs?)\s+and\s+a\s+half$/);
  if (hoursAndHalfMatch) {
    const hours = parseInt(hoursAndHalfMatch[1]!, 10);
    return new Date(now.getTime() + (hours * 60 + 30) * 60_000);
  }

  // "noon"
  if (lower === "noon") {
    const d = new Date(now);
    d.setHours(12, 0, 0, 0);
    if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
    return d;
  }

  // "midnight"
  if (lower === "midnight") {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  // "end of day" / "eod"
  if (/^(end\s+of\s+day|eod)$/.test(lower)) {
    const d = new Date(now);
    d.setHours(18, 0, 0, 0);
    if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
    return d;
  }

  // "tonight at X" / "this evening at X"
  const tonightAtMatch = lower.match(/^(?:tonight|this\s+evening)\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (tonightAtMatch) {
    const d = new Date(now);
    return setTime(d, tonightAtMatch[1]!, tonightAtMatch[2], tonightAtMatch[3] || "pm");
  }

  // "tonight" / "this evening"
  if (/^(tonight|this\s+evening)$/.test(lower)) {
    const d = new Date(now);
    d.setHours(20, 0, 0, 0);
    if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
    return d;
  }

  // "this morning"
  if (/^this\s+morning$/.test(lower)) {
    const d = new Date(now);
    d.setHours(9, 0, 0, 0);
    if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
    return d;
  }

  // "this afternoon"
  if (/^this\s+afternoon$/.test(lower)) {
    const d = new Date(now);
    d.setHours(14, 0, 0, 0);
    if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
    return d;
  }

  // "today at X" / "today X"
  const todayMatch = lower.match(/^today\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (todayMatch) {
    const d = new Date(now);
    const result = setTime(d, todayMatch[1]!, todayMatch[2], todayMatch[3]);
    if (result && result.getTime() <= now.getTime()) result.setDate(result.getDate() + 1);
    return result;
  }

  // "tomorrow at X"
  const tomorrowMatch = lower.match(/^tomorrow\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (tomorrowMatch) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return setTime(d, tomorrowMatch[1]!, tomorrowMatch[2], tomorrowMatch[3]);
  }

  // "next tuesday at 3pm"
  const nextDayMatch = lower.match(/^next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?$/);
  if (nextDayMatch) {
    const d = nextDayOfWeek(nextDayMatch[1]!);
    if (nextDayMatch[2]) return setTime(d, nextDayMatch[2]!, nextDayMatch[3], nextDayMatch[4]);
    d.setHours(9, 0, 0, 0);
    return d;
  }

  // "monday 3pm", "friday at 2:30 pm"
  const dayMatch = lower.match(/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (dayMatch) {
    const d = nextDayOfWeek(dayMatch[1]!);
    return setTime(d, dayMatch[2]!, dayMatch[3], dayMatch[4]);
  }

  // Bare time: "8:30 PM", "3pm", "at 8:30 PM"
  const timeMatch = lower.match(/^(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (timeMatch) {
    const d = new Date(now);
    const result = setTime(d, timeMatch[1]!, timeMatch[2], timeMatch[3]);
    if (result && result.getTime() <= now.getTime()) result.setDate(result.getDate() + 1);
    return result;
  }

  return null;
}

export function resolveRecurringInterval(expr: string): "daily" | "weekly" | "monthly" | "hourly" | number | null {
  const lower = expr.toLowerCase().trim();

  if (/^(daily|every\s*day)$/i.test(lower)) return "daily";
  if (/^(weekly|every\s*week)$/i.test(lower)) return "weekly";
  if (/^(monthly|every\s*month)$/i.test(lower)) return "monthly";
  if (/^(hourly|every\s*hour)$/i.test(lower)) return "hourly";

  const everyMatch = lower.match(/^every\s+(\d+)\s*(hours?|hrs?|mins?|minutes?)$/);
  if (everyMatch) {
    const amount = parseInt(everyMatch[1]!, 10);
    const unit = everyMatch[2]!;
    if (/^(hours?|hrs?)$/.test(unit)) return amount * 3_600_000;
    return amount * 60_000;
  }

  return null;
}
