import { config } from "./config";
import { logger } from "./logger";

import type { HistoryEntry } from "./state";

export interface ConversationContext {
  reminders: string;
  history: HistoryEntry[];
}

function formatHistory(history: HistoryEntry[]): string {
  if (history.length === 0) return "";
  return history
    .slice(-10)
    .map((h) => `${h.role === "user" ? "User" : "Agent"}: ${h.text}`)
    .join("\n");
}

function formatContextBlock(ctx?: ConversationContext): string {
  if (!ctx) return "";
  const parts: string[] = [];

  const hist = formatHistory(ctx.history);
  if (hist) parts.push(`Recent conversation:\n${hist}`);

  if (ctx.reminders) parts.push(`Currently scheduled reminders:\n${ctx.reminders}`);
  else parts.push("No reminders currently scheduled.");

  return "\n\n" + parts.join("\n\n");
}

export interface ClassifyResult {
  isReminder: boolean;
  isUpdate?: boolean;
  task?: string;
  timeExpr?: string | null; // raw expression like "8:30 PM", "in 2 hours", "tomorrow 9am"
}

export interface ClarifyResult {
  timeExpr: string | null;
}

function localTimeString(): string {
  return new Date().toLocaleString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  });
}

const CLASSIFY_SYSTEM_PROMPT = `You extract reminders from messages. Respond with ONLY valid JSON.

You will receive recent conversation history and currently scheduled reminders as context.
Use the conversation history to understand what the user is referring to. For example, if the user previously set a reminder for "go to bed" and now says "actually remind me at 11:43 PM", the task is still "go to bed" -- just with a new time.

Rules for timeExpr:
- COPY the time EXACTLY as the user wrote it. Do NOT rephrase, calculate, or convert.
- "remind me at 8:38 PM" -> timeExpr: "8:38 PM"
- "remind me in 2 hours" -> timeExpr: "in 2 hours"
- "remind me tomorrow 9am" -> timeExpr: "tomorrow 9am"
- "remind me friday 2pm" -> timeExpr: "friday 2pm"

If it's a reminder with a time:
{ "isReminder": true, "task": "<task>", "timeExpr": "<EXACT time words from user>" }

If it's a reminder with no time:
{ "isReminder": true, "task": "<task>", "timeExpr": null }

If NOT a reminder:
{ "isReminder": false }`;

const CLARIFY_SYSTEM_PROMPT = `The user was asked when they want to be reminded about: "{TASK}".
They replied with a time. Current local time: {LOCAL_TIME}

Respond with ONLY valid JSON (no markdown):
If you can extract a time expression:
{ "timeExpr": "<the time exactly as the user said it>" }
If still ambiguous:
{ "timeExpr": null }

IMPORTANT: Just copy the user's time words. Do NOT convert to ISO or do any date math.`;

async function callOllama(system: string, prompt: string, json = true): Promise<string> {
  const url = `${config.ollamaUrl}/api/generate`;

  const body: Record<string, unknown> = {
    model: config.ollamaModel,
    system,
    prompt,
    stream: false,
  };
  if (json) body.format = "json";

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Ollama returned ${response.status}: ${response.statusText}`);
  }

  const data = (await response.json()) as { response: string };
  return data.response;
}

// --- Time resolution (no LLM, pure TypeScript) ---

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

  // "in 1.5 hours", "in 2.5 minutes" (decimal relative)
  const decimalRelMatch = lower.match(/^in\s+(\d+(?:\.\d+))\s*(seconds?|mins?|minutes?|hours?|hrs?|days?|weeks?)$/);
  if (decimalRelMatch) {
    const amount = parseFloat(decimalRelMatch[1]!);
    const unit = decimalRelMatch[2]!;
    const ms = unitToMs(unit, amount);
    if (ms !== null) return new Date(now.getTime() + ms);
  }

  // "in an hour", "in a minute"
  if (/^in\s+an?\s+hour$/.test(lower)) {
    return new Date(now.getTime() + 3_600_000);
  }
  if (/^in\s+an?\s+minute$/.test(lower)) {
    return new Date(now.getTime() + 60_000);
  }

  // "in half an hour"
  if (/^in\s+half\s+an?\s+hour$/.test(lower)) {
    return new Date(now.getTime() + 1_800_000);
  }

  // "in a few minutes" (default ~5 minutes)
  if (/^in\s+a\s+few\s+minutes$/.test(lower)) {
    return new Date(now.getTime() + 5 * 60_000);
  }

  // "in an hour and a half", "in an hour and 30 minutes"
  const hourAndHalfMatch = lower.match(/^in\s+an?\s+hour\s+and\s+a\s+half$/);
  if (hourAndHalfMatch) {
    return new Date(now.getTime() + 90 * 60_000);
  }

  const hourAndMinMatch = lower.match(/^in\s+an?\s+hour\s+and\s+(\d+)\s*(mins?|minutes?)$/);
  if (hourAndMinMatch) {
    const mins = parseInt(hourAndMinMatch[1]!, 10);
    return new Date(now.getTime() + (60 + mins) * 60_000);
  }

  // "in X hours and Y minutes", "in X hours and a half"
  const hoursAndMinMatch = lower.match(/^in\s+(\d+)\s*(?:hours?|hrs?)\s+and\s+(\d+)\s*(mins?|minutes?)$/);
  if (hoursAndMinMatch) {
    const hours = parseInt(hoursAndMinMatch[1]!, 10);
    const mins = parseInt(hoursAndMinMatch[2]!, 10);
    return new Date(now.getTime() + (hours * 60 + mins) * 60_000);
  }
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

  // "end of day" / "eod" (default 6pm)
  if (/^(end\s+of\s+day|eod)$/.test(lower)) {
    const d = new Date(now);
    d.setHours(18, 0, 0, 0);
    if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
    return d;
  }

  // "tonight" or "tonight at X" or "this evening" / "this evening at X"
  const tonightAtMatch = lower.match(/^(?:tonight|this\s+evening)\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (tonightAtMatch) {
    const d = new Date(now);
    return setTime(d, tonightAtMatch[1]!, tonightAtMatch[2], tonightAtMatch[3] || "pm");
  }
  if (/^(tonight|this\s+evening)$/.test(lower)) {
    const d = new Date(now);
    d.setHours(20, 0, 0, 0);
    if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
    return d;
  }

  // "this morning" (default 9am)
  if (/^this\s+morning$/.test(lower)) {
    const d = new Date(now);
    d.setHours(9, 0, 0, 0);
    if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
    return d;
  }

  // "this afternoon" (default 2pm)
  if (/^this\s+afternoon$/.test(lower)) {
    const d = new Date(now);
    d.setHours(14, 0, 0, 0);
    if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
    return d;
  }

  // "tomorrow Xam/pm" or "tomorrow at X"
  const tomorrowMatch = lower.match(/^tomorrow\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (tomorrowMatch) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return setTime(d, tomorrowMatch[1]!, tomorrowMatch[2], tomorrowMatch[3]);
  }

  // "next tuesday", "next friday at 3pm"
  const nextDayMatch = lower.match(/^next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?$/);
  if (nextDayMatch) {
    const d = nextDayOfWeek(nextDayMatch[1]!);
    if (nextDayMatch[2]) {
      return setTime(d, nextDayMatch[2]!, nextDayMatch[3], nextDayMatch[4]);
    }
    // No time specified -- default to 9am
    d.setHours(9, 0, 0, 0);
    return d;
  }

  // Day of week: "monday 3pm", "friday at 2:30 pm"
  const dayMatch = lower.match(/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (dayMatch) {
    const d = nextDayOfWeek(dayMatch[1]!);
    return setTime(d, dayMatch[2]!, dayMatch[3], dayMatch[4]);
  }

  // Bare time: "8:30 PM", "3pm", "17:30", "at 8:30 PM"
  const timeMatch = lower.match(/^(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (timeMatch) {
    const d = new Date(now);
    const result = setTime(d, timeMatch[1]!, timeMatch[2], timeMatch[3]);
    if (result && result.getTime() <= now.getTime()) {
      // If the time already passed today, schedule for tomorrow
      result.setDate(result.getDate() + 1);
    }
    return result;
  }

  return null;
}

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
  } else if (hour <= 12) {
    // No am/pm given -- assume next occurrence; heuristic: if hour <= 6 assume PM
    // For ambiguous cases this is imperfect but reasonable
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

// Try to extract a time expression directly from user text as fallback
export function extractTimeFromText(text: string): string | null {
  const lower = text.toLowerCase();

  // "at 8:30 PM" or "at 3pm"
  const atMatch = lower.match(/\bat\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i);
  if (atMatch) return atMatch[1]!.trim();

  // "in an hour and a half", "in an hour and 30 minutes"
  const inHourAndMatch = lower.match(/\b(in\s+an?\s+hour\s+and\s+(?:a\s+half|\d+\s*(?:mins?|minutes?)))\b/i);
  if (inHourAndMatch) return inHourAndMatch[1]!.trim();

  // "in X hours and Y minutes", "in X hours and a half"
  const inHoursAndMatch = lower.match(/\b(in\s+\d+\s*(?:hours?|hrs?)\s+and\s+(?:a\s+half|\d+\s*(?:mins?|minutes?)))\b/i);
  if (inHoursAndMatch) return inHoursAndMatch[1]!.trim();

  // "in 1.5 hours", "in 2.5 minutes" (decimal)
  const inDecimalMatch = lower.match(/\b(in\s+\d+(?:\.\d+)\s*(?:seconds?|mins?|minutes?|hours?|hrs?|days?|weeks?))\b/i);
  if (inDecimalMatch) return inDecimalMatch[1]!.trim();

  // "in an hour", "in a minute"
  const inAnMatch = lower.match(/\b(in\s+an?\s+(?:hour|minute))\b/i);
  if (inAnMatch) return inAnMatch[1]!.trim();

  // "in half an hour"
  const inHalfMatch = lower.match(/\b(in\s+half\s+an?\s+hour)\b/i);
  if (inHalfMatch) return inHalfMatch[1]!.trim();

  // "in a few minutes"
  const inFewMatch = lower.match(/\b(in\s+a\s+few\s+minutes)\b/i);
  if (inFewMatch) return inFewMatch[1]!.trim();

  // "in 2 hours", "in 30 minutes"
  const inMatch = lower.match(/\b(in\s+\d+\s*(?:seconds?|mins?|minutes?|hours?|hrs?|days?|weeks?))\b/i);
  if (inMatch) return inMatch[1]!.trim();

  // "tonight at 9", "tonight", "this evening", "this evening at 8"
  const tonightAtMatch = lower.match(/\b((?:tonight|this\s+evening)\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i);
  if (tonightAtMatch) return tonightAtMatch[1]!.trim();
  const tonightMatch = lower.match(/\b(tonight|this\s+evening)\b/i);
  if (tonightMatch) return tonightMatch[1]!.trim();

  // "this morning", "this afternoon"
  const periodMatch = lower.match(/\b(this\s+(?:morning|afternoon))\b/i);
  if (periodMatch) return periodMatch[1]!.trim();

  // "noon", "midnight"
  const noonMidMatch = lower.match(/\b(noon|midnight)\b/i);
  if (noonMidMatch) return noonMidMatch[1]!.trim();

  // "end of day", "eod"
  const eodMatch = lower.match(/\b(end\s+of\s+day|eod)\b/i);
  if (eodMatch) return eodMatch[1]!.trim();

  // "tomorrow 9am", "tomorrow at 3pm"
  const tmrMatch = lower.match(/\b(tomorrow\s+(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i);
  if (tmrMatch) return tmrMatch[1]!.trim();

  // "next tuesday", "next friday at 3pm"
  const nextDayMatch = lower.match(/\b(next\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?)\b/i);
  if (nextDayMatch) return nextDayMatch[1]!.trim();

  // Day of week: "friday 2pm", "monday at 9am"
  const dayMatch = lower.match(/\b((?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i);
  if (dayMatch) return dayMatch[1]!.trim();

  return null;
}

// --- Ollama calls ---

export async function classifyMessage(text: string, ctx?: ConversationContext): Promise<ClassifyResult> {
  const system = CLASSIFY_SYSTEM_PROMPT + formatContextBlock(ctx);
  const raw = await callOllama(system, text);

  logger.info(`Ollama classify response: ${raw}`);
  const result = JSON.parse(raw) as ClassifyResult;

  // If Ollama returned a timeExpr that doesn't resolve, try extracting directly from text
  if (result.isReminder && result.timeExpr) {
    const resolved = resolveTimeExpr(result.timeExpr);
    if (!resolved) {
      const fallback = extractTimeFromText(text);
      if (fallback) {
        logger.info(`Ollama timeExpr "${result.timeExpr}" didn't resolve, using fallback: "${fallback}"`);
        result.timeExpr = fallback;
      }
    }
  }

  // If Ollama missed the time, try extracting directly
  if (result.isReminder && !result.timeExpr) {
    const fallback = extractTimeFromText(text);
    if (fallback) {
      logger.info(`Ollama returned no timeExpr, using fallback: "${fallback}"`);
      result.timeExpr = fallback;
    }
  }

  return result;
}

const CHAT_SYSTEM_PROMPT = `You are a reminder agent that lives in iMessage. Your main job is to help the user schedule reminders -- they text you a task and time, and you remind them later. If they ask what you do, tell them that. If they send something that isn't a reminder, keep your reply short and friendly (1-3 sentences), and gently nudge them to try setting a reminder. Don't use markdown.

You will receive the user's currently scheduled reminders and recent conversation history as context. If the user asks about their reminders, list them accurately. If there are no reminders, say so.`;

export async function chatReply(text: string, ctx?: ConversationContext): Promise<string> {
  const system = CHAT_SYSTEM_PROMPT + formatContextBlock(ctx);
  const raw = await callOllama(system, text, false);
  logger.info(`Ollama chat response: ${raw}`);
  return raw.trim();
}

export async function clarifyTime(task: string, userReply: string): Promise<ClarifyResult> {
  const system = CLARIFY_SYSTEM_PROMPT
    .replace("{TASK}", task)
    .replace("{LOCAL_TIME}", localTimeString());
  const raw = await callOllama(system, userReply);

  logger.info(`Ollama clarify response: ${raw}`);
  return JSON.parse(raw) as ClarifyResult;
}
