import { IMessageSDK, MessageScheduler } from "@photon-ai/imessage-kit";
import type { Message, ScheduledMessage, RecurringMessage, SendResult } from "@photon-ai/imessage-kit";
import { config } from "./config";
import { logger } from "./logger";
import { runAgent } from "./agent";
import type { ToolDeps } from "./tools";
import { saveReminders, loadReminders, saveHistory, loadHistory } from "./store";
import { MessageHistory } from "./state";

const MARKER = config.agentMarker;
const PHONE = config.phoneNumber;

const sdk = new IMessageSDK({
  watcher: {
    pollInterval: config.watcherPollInterval,
    excludeOwnMessages: false,
  },
});

let lastFiredReminder: { task: string; firedAt: Date } | null = null;

const scheduler = new MessageScheduler(
  sdk,
  { debug: false, checkInterval: 1000 },
  {
    onSent: (_msg: ScheduledMessage | RecurringMessage, _result: SendResult) => {
      const raw = typeof _msg.content === "string" ? _msg.content : (_msg.content.text ?? "");
      const task = raw.replace(`${MARKER} Reminder: `, "");
      logger.info(`Reminder sent: ${task}`);
      lastFiredReminder = { task, firedAt: new Date() };
      persist();
    },
    onError: (_msg: ScheduledMessage | RecurringMessage, error: Error) => {
      logger.error(`Failed to send reminder: ${error.message}`);
    },
  }
);

const history = new MessageHistory();
const startTime = Date.now();

function persist(): void {
  const data = scheduler.export();
  saveReminders(JSON.stringify(data, null, 2));
}

function persistHistory(): void {
  saveHistory(history.export());
}

async function sendAgent(text: string): Promise<void> {
  try {
    await sdk.send(PHONE, `${MARKER} ${text}`);
    history.add("assistant", text);
    persistHistory();
  } catch (err) {
    logger.error(`Failed to send iMessage: ${err}`);
  }
}

function buildRemindersContext(): string {
  const data = scheduler.export();
  const pending = [...(data.scheduled ?? []), ...(data.recurring ?? [])].filter(
    (r) => r.status === "pending"
  );
  if (pending.length === 0) return "No reminders currently scheduled.";

  const list = pending.map((r, i) => {
    const raw = typeof r.content === "string" ? r.content : (r.content.text ?? "reminder");
    const task = raw.replace(`${MARKER} Reminder: `, "");
    const sendAt = "sendAt" in r ? new Date(r.sendAt as unknown as string) : new Date();
    const time = sendAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
      + " on " + sendAt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    const type = r.type === "recurring" ? " (recurring)" : "";
    return `${i + 1}) "${task}" at ${time}${type}`;
  }).join("\n");

  return `Currently scheduled reminders:\n${list}`;
}

const toolDeps: ToolDeps = {
  scheduler,
  phone: PHONE,
  marker: MARKER,
  persist,
  get lastFiredReminder() { return lastFiredReminder; },
  clearLastFired: () => { lastFiredReminder = null; },
};

async function handleNewMessage(msg: Message): Promise<void> {
  if (!msg.isFromMe) return;
  if (!msg.text) return;

  const normalizedPhone = PHONE.replace(/\D/g, "");
  const normalizedChatId = msg.chatId.replace(/\D/g, "");
  if (!normalizedChatId.includes(normalizedPhone)) return;

  if (msg.text.includes(MARKER)) return;
  if (/\[.+?\]/.test(msg.text)) return;
  if (msg.date.getTime() < startTime) return;

  const text = msg.text.trim();
  if (!text) return;

  // Guardrail: message length
  if (text.length > config.maxMessageLength) {
    await sendAgent("That message is too long. Please keep it under 500 characters.");
    return;
  }

  logger.info(`Received: "${text}"`);
  history.add("user", text);
  persistHistory();

  const remindersContext = buildRemindersContext();
  const reply = await runAgent(text, history.getMessages(), remindersContext, toolDeps);

  await sendAgent(reply);
}

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

      const missed = pending.filter(
        (r: { sendAt: string; status: string }) =>
          r.status === "pending" && new Date(r.sendAt).getTime() <= now
      );

      const future = {
        scheduled: (data.scheduled ?? []).filter(
          (r: { sendAt: string; status: string }) =>
            r.status === "pending" && new Date(r.sendAt).getTime() > now
        ),
        recurring: data.recurring ?? [],
      };

      const result = scheduler.import(future);
      logger.info(`Restored ${result.imported} reminders (skipped ${result.skipped}).`);
      persist();

      if (missed.length > 0) {
        const summary = missed
          .map((r: { content: string; sendAt: string }, i: number) => {
            const content = typeof r.content === "string" ? r.content : "reminder";
            const cleanContent = content.replace(`${MARKER} Reminder: `, "");
            const time = new Date(r.sendAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
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

  const savedHistory = loadHistory();
  if (savedHistory) {
    history.import(savedHistory);
  }

  await sdk.startWatching({
    onMessage: handleNewMessage,
    onError: (error) => {
      logger.error(`Watcher error: ${error.message}`);
    },
  });

  logger.info("Watching for messages. Send yourself a text to create a reminder.");
}

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
