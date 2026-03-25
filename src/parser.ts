import * as chrono from "chrono-node";

export function resolveTimeExpr(expr: string): Date | null {
  const result = chrono.parseDate(expr, new Date(), { forwardDate: true });
  return result;
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
