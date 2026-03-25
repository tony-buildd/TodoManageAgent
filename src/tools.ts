import type { MessageScheduler } from "@photon-ai/imessage-kit";
import type { Tool } from "ollama";
import { resolveTimeExpr, resolveRecurringInterval } from "./parser";
import { logger } from "./logger";

export const TOOL_SCHEMAS: Tool[] = [
  {
    type: "function",
    function: {
      name: "schedule_reminder",
      description: "Create a new one-time reminder for the user.",
      parameters: {
        type: "object",
        required: ["task", "time"],
        properties: {
          task: { type: "string", description: "What to remind about" },
          time: { type: "string", description: "When to remind. Copy the user's time expression exactly, e.g. '3pm', 'tomorrow 9am', 'in 2 hours', 'tonight', 'noon'" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "schedule_recurring",
      description: "Create a recurring reminder that repeats on a schedule.",
      parameters: {
        type: "object",
        required: ["task", "time", "interval"],
        properties: {
          task: { type: "string", description: "What to remind about" },
          time: { type: "string", description: "When the first reminder should fire, e.g. '9am', '3pm'" },
          interval: { type: "string", description: "How often to repeat: 'daily', 'weekly', 'monthly', 'hourly', or 'every N hours/minutes'" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_reminder",
      description: "Change the time of an existing reminder. Use the task name to identify which reminder to update.",
      parameters: {
        type: "object",
        required: ["task_query", "new_time"],
        properties: {
          task_query: { type: "string", description: "The name or partial name of the reminder to update" },
          new_time: { type: "string", description: "The new time, e.g. '3pm', 'tomorrow 9am'" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_reminder",
      description: "Cancel/delete a specific reminder by name or number.",
      parameters: {
        type: "object",
        required: ["target"],
        properties: {
          target: { type: "string", description: "The task name, partial name, or number (e.g. '1', '2') of the reminder to cancel" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_all_reminders",
      description: "Cancel ALL reminders. This is destructive and cannot be undone.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_reminders",
      description: "List all currently scheduled reminders with their times.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "snooze",
      description: "Snooze the most recently fired reminder. Only works within 30 minutes of a reminder firing.",
      parameters: {
        type: "object",
        properties: {
          duration: { type: "string", description: "How long to snooze, e.g. '10 minutes', '1 hour'. Defaults to '10 minutes'." },
        },
      },
    },
  },
];

function formatDate(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }) + " on " + date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function friendlyTime(sendAt: Date): string {
  const formatted = formatDate(sendAt);
  const now = new Date();
  const isToday = sendAt.toLocaleDateString() === now.toLocaleDateString();
  const tmr = new Date(now); tmr.setDate(tmr.getDate() + 1);
  const isTomorrow = sendAt.toLocaleDateString() === tmr.toLocaleDateString();

  if (isToday) return `today at ${formatted.split(" on ")[0]}`;
  if (isTomorrow) return `tomorrow at ${formatted.split(" on ")[0]}`;
  return formatted;
}

export interface ToolDeps {
  scheduler: MessageScheduler;
  phone: string;
  marker: string;
  persist: () => void;
  lastFiredReminder: { task: string; firedAt: Date } | null;
  clearLastFired: () => void;
}

function getPendingReminders(deps: ToolDeps) {
  const data = deps.scheduler.export();
  return [...(data.scheduled ?? []), ...(data.recurring ?? [])].filter(
    (r) => r.status === "pending"
  );
}

function extractTask(r: { content: string | { text?: string } }, marker: string): string {
  const raw = typeof r.content === "string" ? r.content : (r.content.text ?? "");
  return raw.replace(`${marker} Reminder: `, "");
}

export async function executeTool(name: string, args: Record<string, unknown>, deps: ToolDeps): Promise<string> {
  switch (name) {
    case "schedule_reminder": {
      const task = args.task as string;
      const time = args.time as string;
      const sendAt = resolveTimeExpr(time);
      if (!sendAt) return `Could not parse time "${time}". Ask the user to rephrase with something like "3pm", "in 2 hours", or "tomorrow 9am".`;
      const content = `${deps.marker} Reminder: ${task}`;
      deps.scheduler.schedule({ to: deps.phone, content, sendAt });
      deps.persist();
      logger.info(`Scheduled: "${task}" at ${formatDate(sendAt)}`);
      return `Scheduled reminder "${task}" for ${friendlyTime(sendAt)}.`;
    }

    case "schedule_recurring": {
      const task = args.task as string;
      const time = args.time as string;
      const intervalStr = args.interval as string;
      const sendAt = resolveTimeExpr(time);
      if (!sendAt) return `Could not parse time "${time}". Ask the user to rephrase.`;
      const interval = resolveRecurringInterval(intervalStr);
      if (!interval) return `Could not parse interval "${intervalStr}". Use "daily", "weekly", "monthly", "hourly", or "every N hours".`;
      const content = `${deps.marker} Reminder: ${task}`;
      deps.scheduler.scheduleRecurring({ to: deps.phone, content, startAt: sendAt, interval });
      deps.persist();
      const label = typeof interval === "number" ? `every ${Math.round(interval / 60_000)} minutes` : interval;
      logger.info(`Recurring: "${task}" ${label} starting ${formatDate(sendAt)}`);
      return `Recurring reminder set: "${task}" ${label}, starting ${friendlyTime(sendAt)}.`;
    }

    case "update_reminder": {
      const query = (args.task_query as string).toLowerCase();
      const newTime = args.new_time as string;
      const pending = getPendingReminders(deps);
      if (pending.length === 0) return "No reminders to update.";

      const matches = pending.filter((r) => {
        const task = extractTask(r, deps.marker).toLowerCase();
        return task.includes(query) || query.includes(task);
      });

      // If no name match but only one reminder, use it
      const targets = matches.length > 0 ? matches : (pending.length === 1 ? [pending[0]!] : []);

      if (targets.length === 0) {
        const list = pending.map((r, i) => `${i + 1}) "${extractTask(r, deps.marker)}" at ${formatDate(new Date(("sendAt" in r ? r.sendAt : new Date()) as unknown as string))}`).join(", ");
        return `No match for "${query}". Current reminders: ${list}. Ask the user which one.`;
      }

      if (targets.length > 1) {
        const list = targets.map((r, i) => `${i + 1}) "${extractTask(r, deps.marker)}"`).join(", ");
        return `Multiple matches: ${list}. Ask the user which one to update.`;
      }

      const target = targets[0]!;
      const sendAt = resolveTimeExpr(newTime);
      if (!sendAt) return `Could not parse time "${newTime}". Ask the user to rephrase.`;
      deps.scheduler.reschedule(target.id, sendAt);
      deps.persist();
      const task = extractTask(target, deps.marker);
      logger.info(`Rescheduled: "${task}" to ${formatDate(sendAt)}`);
      return `Updated "${task}" to ${friendlyTime(sendAt)}.`;
    }

    case "cancel_reminder": {
      const target = args.target as string;
      const pending = getPendingReminders(deps);
      if (pending.length === 0) return "No reminders to cancel.";

      // Try by number
      const numMatch = target.match(/^#?(\d+)$/);
      if (numMatch) {
        const idx = parseInt(numMatch[1]!, 10) - 1;
        const r = pending[idx];
        if (r) {
          const task = extractTask(r, deps.marker);
          deps.scheduler.cancel(r.id);
          deps.persist();
          return `Cancelled reminder: "${task}".`;
        }
        return `No reminder at position ${parseInt(numMatch[1]!, 10)}. There are ${pending.length} reminders.`;
      }

      // Try by name
      const query = target.toLowerCase();
      const match = pending.find((r) => {
        const task = extractTask(r, deps.marker).toLowerCase();
        return task.includes(query) || query.includes(task);
      });

      if (match) {
        const task = extractTask(match, deps.marker);
        deps.scheduler.cancel(match.id);
        deps.persist();
        return `Cancelled reminder: "${task}".`;
      }

      const list = pending.map((r, i) => `${i + 1}) "${extractTask(r, deps.marker)}"`).join(", ");
      return `No match for "${target}". Current reminders: ${list}. Ask the user which one.`;
    }

    case "cancel_all_reminders": {
      const pending = getPendingReminders(deps);
      if (pending.length === 0) return "No reminders to cancel.";
      let cancelled = 0;
      for (const r of pending) {
        if (deps.scheduler.cancel(r.id)) cancelled++;
      }
      deps.persist();
      return `Cancelled ${cancelled} reminder${cancelled !== 1 ? "s" : ""}. All clear.`;
    }

    case "list_reminders": {
      const pending = getPendingReminders(deps);
      if (pending.length === 0) return "No reminders currently scheduled.";
      const list = pending.map((r, i) => {
        const task = extractTask(r, deps.marker);
        const sendAt = "sendAt" in r ? new Date(r.sendAt as unknown as string) : new Date();
        const type = r.type === "recurring" ? " (recurring)" : "";
        return `${i + 1}) "${task}" at ${formatDate(sendAt)}${type}`;
      }).join("\n");
      return `Current reminders:\n${list}`;
    }

    case "snooze": {
      const last = deps.lastFiredReminder;
      if (!last || (Date.now() - last.firedAt.getTime() > 30 * 60_000)) {
        return "Nothing to snooze. Snooze only works within 30 minutes of a fired reminder.";
      }
      const duration = (args.duration as string) || "10 minutes";
      const timeExpr = duration.startsWith("in ") ? duration : `in ${duration}`;
      const sendAt = resolveTimeExpr(timeExpr);
      if (!sendAt) return `Could not parse snooze duration "${duration}". Try "10 minutes" or "1 hour".`;
      const content = `${deps.marker} Reminder: ${last.task}`;
      deps.scheduler.schedule({ to: deps.phone, content, sendAt });
      deps.persist();
      deps.clearLastFired();
      logger.info(`Snoozed "${last.task}" to ${formatDate(sendAt)}`);
      return `Snoozed "${last.task}" until ${friendlyTime(sendAt)}.`;
    }

    default:
      return `Unknown tool: ${name}`;
  }
}
