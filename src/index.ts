import { IMessageSDK, MessageScheduler } from "@photon-ai/imessage-kit";
import type { Message, ScheduledMessage, RecurringMessage, SendResult, RecurringScheduleOptions } from "@photon-ai/imessage-kit";
import { config } from "./config";
import { logger } from "./logger";
import { classifyMessage, clarifyTime, chatReply, resolveTimeExpr, extractTimeFromText, resolveRecurringInterval } from "./parser";
import type { ConversationContext } from "./parser";
import { saveReminders, loadReminders, saveHistory, loadHistory } from "./store";
import { ConversationState } from "./state";

const MARKER = config.agentMarker;
const PHONE = config.phoneNumber;

const sdk = new IMessageSDK({
  watcher: {
    pollInterval: config.watcherPollInterval,
    excludeOwnMessages: false,
  },
});

const scheduler = new MessageScheduler(
  sdk,
  { debug: false, checkInterval: 1000 },
  {
    onSent: (_msg: ScheduledMessage | RecurringMessage, _result: SendResult) => {
      logger.info(`Reminder sent: ${typeof _msg.content === "string" ? _msg.content : _msg.content.text}`);
      persist();
    },
    onError: (_msg: ScheduledMessage | RecurringMessage, error: Error) => {
      logger.error(`Failed to send reminder: ${error.message}`);
    },
  }
);

const convo = new ConversationState();
const startTime = Date.now();

function buildContext(): ConversationContext {
  const data = scheduler.export();
  const pending = [...(data.scheduled ?? []), ...(data.recurring ?? [])].filter(
    (r: { status: string }) => r.status === "pending"
  );
  let reminders = "";
  if (pending.length > 0) {
    reminders = pending
      .map((r, i: number) => {
        const raw = typeof r.content === "string" ? r.content : (r.content.text ?? "reminder");
        const cleanContent = raw.replace(`${MARKER} Reminder: `, "");
        const sendAt = "sendAt" in r ? new Date(r.sendAt as unknown as string) : new Date();
        const time = formatDate(sendAt);
        return `${i + 1}) "${cleanContent}" at ${time}`;
      })
      .join("\n");
  }
  return { reminders, history: convo.getHistory() };
}

function findRemindersByTask(taskQuery: string): { id: string; task: string; sendAt: string }[] {
  const data = scheduler.export();
  const pending = [...(data.scheduled ?? []), ...(data.recurring ?? [])].filter(
    (r) => r.status === "pending"
  );
  const query = taskQuery.toLowerCase();
  const matches = pending.filter((r) => {
    const raw = typeof r.content === "string" ? r.content : (r.content.text ?? "");
    const task = raw.replace(`${MARKER} Reminder: `, "").toLowerCase();
    return task.includes(query) || query.includes(task);
  }).map((r) => ({
    id: r.id,
    task: (typeof r.content === "string" ? r.content : (r.content.text ?? "")).replace(`${MARKER} Reminder: `, ""),
    sendAt: ("sendAt" in r ? r.sendAt : new Date()).toString(),
  }));

  // If no matches but only one reminder exists, return it
  if (matches.length === 0 && pending.length === 1) {
    const r = pending[0]!;
    const raw = typeof r.content === "string" ? r.content : (r.content.text ?? "");
    return [{
      id: r.id,
      task: raw.replace(`${MARKER} Reminder: `, ""),
      sendAt: ("sendAt" in r ? r.sendAt : new Date()).toString(),
    }];
  }
  return matches;
}

function persist(): void {
  const data = scheduler.export();
  saveReminders(JSON.stringify(data, null, 2));
}

async function sendAgent(text: string): Promise<void> {
  try {
    await sdk.send(PHONE, `${MARKER} ${text}`);
    convo.addMessage("agent", text);
    persistHistory();
  } catch (err) {
    logger.error(`Failed to send iMessage: ${err}`);
  }
}

function persistHistory(): void {
  saveHistory(convo.exportHistory());
}

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

function commitReminder(task: string, sendAt: Date): void {
  const content = `${MARKER} Reminder: ${task}`;
  scheduler.schedule({ to: PHONE, content, sendAt });
  persist();

  const label = friendlyTime(sendAt);
  sendAgent(`Confirmed! I'll remind you to "${task}" ${label}`);
  logger.info(`Scheduled: "${task}" at ${formatDate(sendAt)} (${sendAt.toISOString()})`);
}

function commitRecurring(task: string, startAt: Date, interval: "daily" | "weekly" | "monthly" | "hourly" | number): void {
  const content = `${MARKER} Reminder: ${task}`;
  scheduler.scheduleRecurring({ to: PHONE, content, startAt, interval });
  persist();

  const intervalLabel = typeof interval === "number"
    ? `every ${Math.round(interval / 60_000)} minutes`
    : interval;
  const label = friendlyTime(startAt);
  sendAgent(`Recurring reminder set! I'll remind you to "${task}" ${intervalLabel}, starting ${label}`);
  logger.info(`Recurring: "${task}" ${intervalLabel} starting ${formatDate(startAt)}`);
}

async function askConfirmation(task: string, sendAt: Date): Promise<void> {
  const label = friendlyTime(sendAt);
  convo.enterConfirmation(task, sendAt);
  await sendAgent(`Just to confirm:\nTask: "${task}"\nTime: ${label}\n\nIs this correct? (yes/no)`);
}

async function handleNewMessage(msg: Message): Promise<void> {
  if (!msg.isFromMe) return;
  if (!msg.text) return;

  // Only respond in the self-conversation thread
  const normalizedPhone = PHONE.replace(/\D/g, "");
  const normalizedChatId = msg.chatId.replace(/\D/g, "");
  if (!normalizedChatId.includes(normalizedPhone)) return;

  if (msg.text.includes(MARKER)) return;
  if (/\[.+?\]/.test(msg.text)) return;
  if (msg.date.getTime() < startTime) return;

  const text = msg.text.trim();
  if (!text) return;

  logger.info(`Received: "${text}"`);
  convo.addMessage("user", text);
  persistHistory();
  const lower = text.toLowerCase();

  // --- Hardcoded commands ---
  if (/^(list|show|my)\s*(reminders?|todos?)$/i.test(lower) || /^what.*reminder/i.test(lower) || /^reminders?$/i.test(lower)) {
    const ctx = buildContext();
    if (ctx.reminders) {
      await sendAgent(`Your reminders:\n${ctx.reminders}`);
    } else {
      await sendAgent("You don't have any reminders right now. Send me one to get started!");
    }
    return;
  }

  // Cancel/delete commands: "cancel go to bed", "delete all reminders", "cancel reminder 1"
  const cancelAllMatch = /^(cancel|delete|remove|clear)\s+(all)\s*(reminders?|todos?)?$/i.test(lower);
  const cancelMatch = lower.match(/^(?:cancel|delete|remove)\s+(?:the\s+)?(?:reminder\s+(?:for\s+)?)?(.+)$/i);
  if (cancelAllMatch) {
    const data = scheduler.export();
    const pending = [...(data.scheduled ?? []), ...(data.recurring ?? [])].filter(
      (r) => r.status === "pending"
    );
    if (pending.length === 0) {
      await sendAgent("No reminders to cancel.");
    } else {
      let cancelled = 0;
      for (const r of pending) {
        if (scheduler.cancel(r.id)) cancelled++;
      }
      persist();
      await sendAgent(`Cancelled ${cancelled} reminder${cancelled !== 1 ? "s" : ""}. You're all clear!`);
    }
    return;
  }
  if (cancelMatch && !cancelAllMatch) {
    const query = cancelMatch[1]!.trim();
    // Try to match by number (e.g. "cancel reminder 1")
    const numMatch = query.match(/^#?(\d+)$/);
    const data = scheduler.export();
    const pending = [...(data.scheduled ?? []), ...(data.recurring ?? [])].filter(
      (r) => r.status === "pending"
    );
    if (pending.length === 0) {
      await sendAgent("No reminders to cancel.");
      return;
    }
    let target: typeof pending[number] | undefined;
    if (numMatch) {
      const idx = parseInt(numMatch[1]!, 10) - 1;
      target = pending[idx];
    } else {
      const q = query.toLowerCase();
      target = pending.find((r) => {
        const raw = typeof r.content === "string" ? r.content : (r.content.text ?? "");
        const task = raw.replace(`${MARKER} Reminder: `, "").toLowerCase();
        return task.includes(q) || q.includes(task);
      });
    }
    if (target) {
      const raw = typeof target.content === "string" ? target.content : (target.content.text ?? "");
      const task = raw.replace(`${MARKER} Reminder: `, "");
      scheduler.cancel(target.id);
      persist();
      await sendAgent(`Cancelled reminder: "${task}"`);
    } else {
      await sendAgent(`Couldn't find a reminder matching "${query}". Try "list reminders" to see what you have.`);
    }
    return;
  }

  // --- Handle pending disambiguation (pick a number) ---
  if (convo.getKind() === "disambiguation") {
    const numMatch = lower.match(/^#?(\d+)$/);
    if (numMatch) {
      const idx = parseInt(numMatch[1]!, 10) - 1;
      const candidates = convo.getCandidates();
      const action = convo.getAction();
      const picked = candidates[idx];
      if (picked) {
        if (action === "cancel") {
          scheduler.cancel(picked.id);
          persist();
          convo.clear();
          await sendAgent(`Cancelled reminder: "${picked.task}"`);
        } else if (action === "update") {
          const timeExpr = convo.getNewTimeExpr();
          if (timeExpr) {
            const resolved = resolveTimeExpr(timeExpr);
            if (resolved) {
              scheduler.reschedule(picked.id, resolved);
              persist();
              convo.clear();
              await sendAgent(`Updated! "${picked.task}" is now set for ${friendlyTime(resolved)}`);
            } else {
              convo.clear();
              await sendAgent(`Couldn't parse the time "${timeExpr}". Try again.`);
            }
          } else {
            convo.clear();
            await sendAgent(`No time provided for the update. Try again.`);
          }
        }
      } else {
        await sendAgent(`Invalid choice. Pick a number between 1 and ${candidates.length}.`);
      }
    } else if (/^(cancel|nevermind|nvm|back)$/i.test(lower)) {
      convo.clear();
      await sendAgent("No problem, cancelled.");
    } else {
      await sendAgent(`Please reply with a number (1-${convo.getCandidates().length}) or "cancel".`);
    }
    return;
  }

  // --- Handle pending confirmation (yes/no/modification) ---
  if (convo.getKind() === "confirmation") {
    const task = convo.getTask()!;
    const sendAt = convo.getSendAt()!;

    if (/^(yes|y|yep|yeah|yup|confirm|ok|sure|correct)$/i.test(lower)) {
      convo.clear();
      commitReminder(task, sendAt);
    } else if (/^(no|n|nope|nah|cancel|wrong)$/i.test(lower)) {
      convo.clear();
      await sendAgent("Cancelled. Send me a new reminder anytime.");
    } else {
      // User might be modifying the reminder instead of confirming
      // Try to extract a new time or re-classify the message
      const directTime = extractTimeFromText(text);
      if (directTime) {
        const resolved = resolveTimeExpr(directTime);
        if (resolved) {
          convo.clear();
          await askConfirmation(task, resolved);
          return;
        }
      }

      // Fall back to full classification with context
      try {
        const ctx = buildContext();
        const result = await classifyMessage(text, ctx);
        if (result.isReminder && result.timeExpr) {
          const newTask = result.task?.trim() || task;
          const resolved = resolveTimeExpr(result.timeExpr);
          if (resolved) {
            convo.clear();
            await askConfirmation(newTask, resolved);
            return;
          }
        }
        if (result.isReminder && !result.timeExpr) {
          const newTask = result.task?.trim() || task;
          convo.clear();
          convo.enterClarification(newTask);
          await sendAgent(`When should I remind you to "${newTask}"? (e.g. "3pm", "in 2 hours", "tomorrow 9am")`);
          return;
        }
      } catch (err) {
        logger.error(`Re-classify during confirmation failed: ${err}`);
      }

      await sendAgent(`Please reply "yes" to confirm, "no" to cancel, or tell me the new time.`);
    }
    return;
  }

  // --- Handle pending clarification (awaiting time) ---
  if (convo.getKind() === "clarification") {
    const task = convo.getTask()!;

    try {
      const result = await clarifyTime(task, text);

      if (result.timeExpr) {
        const resolved = resolveTimeExpr(result.timeExpr);
        if (resolved) {
          convo.clear();
          await askConfirmation(task, resolved);
        } else if (convo.canRetry()) {
          convo.incrementAttempt();
          await sendAgent(`I still couldn't figure out the time. When should I remind you to "${task}"? (e.g. "3pm", "in 2 hours", "tomorrow 9am")`);
        } else {
          convo.clear();
          await sendAgent(`I couldn't parse the time after 2 attempts. Please try again with a new message.`);
        }
      } else if (convo.canRetry()) {
        convo.incrementAttempt();
        await sendAgent(`I still couldn't figure out the time. When should I remind you to "${task}"? (e.g. "3pm", "in 2 hours", "tomorrow 9am")`);
      } else {
        convo.clear();
        await sendAgent(`I couldn't parse the time after 2 attempts. Please try again with a new message.`);
      }
    } catch (err) {
      logger.error(`Ollama clarify error: ${err}`);
      convo.clear();
      await sendAgent("Error: couldn't reach Ollama. Is it running?");
    }
    return;
  }

  // --- Normal message: classify with Ollama ---
  logger.info("Processing...");

  try {
    const ctx = buildContext();
    const result = await classifyMessage(text, ctx);

    if (!result.isReminder) {
      try {
        const reply = await chatReply(text, ctx);
        await sendAgent(reply);
      } catch (err) {
        logger.error(`Chat reply error: ${err}`);
      }
      return;
    }

    const task = result.task?.trim() || text;

    // Handle recurring reminders
    if (result.isRecurring && result.timeExpr) {
      const resolved = resolveTimeExpr(result.timeExpr);
      const intervalStr = result.interval || "daily";
      const recurring = resolveRecurringInterval(intervalStr);
      if (resolved && recurring) {
        commitRecurring(task, resolved, recurring.interval);
      } else if (resolved) {
        commitRecurring(task, resolved, "daily");
      } else {
        await sendAgent(`I couldn't parse the time "${result.timeExpr}". When should the recurring reminder start?`);
      }
      return;
    }

    // Handle update/reschedule of an existing reminder
    if (result.isUpdate && result.timeExpr) {
      const matches = findRemindersByTask(task);
      if (matches.length === 1) {
        const match = matches[0]!;
        const resolved = resolveTimeExpr(result.timeExpr);
        if (resolved) {
          scheduler.reschedule(match.id, resolved);
          persist();
          const label = friendlyTime(resolved);
          await sendAgent(`Updated! "${match.task}" is now set for ${label}`);
          logger.info(`Rescheduled: "${match.task}" to ${formatDate(resolved)} (${resolved.toISOString()})`);
        } else {
          logger.warn(`Could not resolve update timeExpr: "${result.timeExpr}"`);
          await sendAgent(`I couldn't understand the time "${result.timeExpr}". Try something like "3pm" or "in 2 hours".`);
        }
      } else if (matches.length > 1) {
        const list = matches.map((m, i) => `${i + 1}) "${m.task}" at ${formatDate(new Date(m.sendAt))}`).join("\n");
        convo.enterDisambiguation("update", matches, result.timeExpr);
        await sendAgent(`Which reminder do you want to update?\n${list}\n\nReply with the number.`);
      } else {
        await sendAgent(`I couldn't find a matching reminder to update. Here are your current reminders:\n${buildContext().reminders || "None"}`);
      }
      return;
    }

    if (result.timeExpr) {
      const resolved = resolveTimeExpr(result.timeExpr);
      if (resolved) {
        await askConfirmation(task, resolved);
      } else {
        logger.warn(`Could not resolve timeExpr: "${result.timeExpr}"`);
        convo.enterClarification(task);
        await sendAgent(`I couldn't understand "${result.timeExpr}". When should I remind you to "${task}"? (e.g. "3pm", "in 2 hours", "tomorrow 9am")`);
      }
    } else {
      convo.enterClarification(task);
      await sendAgent(`When should I remind you to "${task}"? (e.g. "3pm", "in 2 hours", "tomorrow 9am")`);
    }
  } catch (err) {
    if (err instanceof SyntaxError) {
      logger.error(`Ollama returned invalid JSON: ${err.message}`);
      try {
        const result = await classifyMessage(text, buildContext());
        if (result.isReminder && result.timeExpr) {
          const resolved = resolveTimeExpr(result.timeExpr);
          if (resolved) {
            await askConfirmation(result.task?.trim() || text, resolved);
          } else {
            await sendAgent("Error: couldn't understand that. Try again?");
          }
        } else {
          await sendAgent("Error: couldn't understand that. Try again?");
        }
      } catch {
        await sendAgent("Error: couldn't understand that. Try again?");
      }
    } else {
      logger.error(`Ollama error: ${err}`);
      await sendAgent("Error: couldn't reach Ollama. Is it running?");
    }
  }
}

convo.onTimeout(async () => {
  await sendAgent("Timed out waiting for your response. Send a new message if you'd like to set a reminder.");
});

// Startup: restore persisted reminders and handle missed ones
async function startup(): Promise<void> {
  logger.info("Starting todo-agent...");
  logger.info(`Phone: ${PHONE}`);
  logger.info(`Ollama: ${config.ollamaUrl} (${config.ollamaModel})`);

  const saved = loadReminders();
  if (saved) {
    try {
      const data = JSON.parse(saved);
      const pending = [...(data.scheduled ?? []), ...(data.recurring ?? [])];
      const now = Date.now();

      // Find missed reminders (past due)
      const missed = pending.filter(
        (r: { sendAt: string; status: string }) =>
          r.status === "pending" && new Date(r.sendAt).getTime() <= now
      );

      // Find future reminders
      const future = {
        scheduled: (data.scheduled ?? []).filter(
          (r: { sendAt: string; status: string }) =>
            r.status === "pending" && new Date(r.sendAt).getTime() > now
        ),
        recurring: data.recurring ?? [],
      };

      // Import future reminders
      const result = scheduler.import(future);
      logger.info(`Restored ${result.imported} reminders (skipped ${result.skipped}).`);
      persist();

      // Send missed reminders summary
      if (missed.length > 0) {
        const summary = missed
          .map((r: { content: string; sendAt: string }, i: number) => {
            const content = typeof r.content === "string" ? r.content : "reminder";
            const cleanContent = content.replace(`${MARKER} Reminder: `, "");
            const time = formatDate(new Date(r.sendAt));
            return `${i + 1}) ${cleanContent} (was ${time})`;
          })
          .join("\n");

        await sendAgent(
          `You missed ${missed.length} reminder${missed.length > 1 ? "s" : ""} while offline:\n${summary}`
        );
      }
    } catch (err) {
      logger.error(`Failed to restore reminders: ${err}`);
    }
  }

  // Restore conversation history
  const savedHistory = loadHistory();
  if (savedHistory) {
    convo.importHistory(savedHistory);
  }

  // Start watching
  await sdk.startWatching({
    onMessage: handleNewMessage,
    onError: (error) => {
      logger.error(`Watcher error: ${error.message}`);
    },
  });

  logger.info("Watching for messages. Send yourself a text to create a reminder.");
}

// Graceful shutdown
process.on("SIGINT", async () => {
  logger.info("Shutting down...");
  persist();
  persistHistory();
  scheduler.destroy();
  sdk.stopWatching();
  await sdk.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  logger.info("Shutting down...");
  persist();
  persistHistory();
  scheduler.destroy();
  sdk.stopWatching();
  await sdk.close();
  process.exit(0);
});

startup().catch((err) => {
  logger.error(`Startup failed: ${err}`);
  process.exit(1);
});
