import ollama from "ollama";
import { config } from "./config";
import { logger } from "./logger";
import { TOOL_SCHEMAS, executeTool } from "./tools";
import type { ToolDeps } from "./tools";
import type { HistoryMessage } from "./state";

function localTimeString(): string {
  return new Date().toLocaleString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  });
}

const SYSTEM_PROMPT = `You are a personal reminder assistant that lives in iMessage. You help the user manage reminders by calling the tools available to you.

BEHAVIOR:
- Be concise and friendly. 1-3 sentences max. No markdown, no bullet points.
- When the user asks to create a reminder, call schedule_reminder.
- When the user asks to update/change/move/reschedule a reminder, call update_reminder.
- When the user asks to cancel/delete/remove a reminder, call cancel_reminder.
- When the user asks to list/show reminders or asks what reminders they have, call list_reminders.
- When the user says "snooze", call snooze.
- For recurring reminders ("every day at 9am"), call schedule_recurring.
- If you're unsure which reminder the user means, call list_reminders first to see what exists, then ask the user to clarify.
- If the user sends a casual message that isn't about reminders, reply briefly and suggest setting a reminder.
- NEVER fabricate reminder data. Only report what tools return.
- When calling tools, copy the user's time expression exactly as they wrote it.

RULES:
- Do NOT ask for confirmation before creating, updating, or cancelling a reminder. Just do it and tell the user what you did.
- For cancel_all_reminders (destructive), confirm with the user BEFORE calling it.
- If a tool returns an error about parsing time, ask the user to rephrase.
- You can call multiple tools in a single turn if the user asks for multiple things.`;

export async function runAgent(
  userMessage: string,
  conversationHistory: HistoryMessage[],
  remindersContext: string,
  deps: ToolDeps,
): Promise<string> {
  const systemContent = `${SYSTEM_PROMPT}\n\nCurrent local time: ${localTimeString()}\n\n${remindersContext}`;

  const messages: { role: string; content: string; tool_calls?: unknown[] }[] = [
    { role: "system", content: systemContent },
    ...conversationHistory.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userMessage },
  ];

  for (let turn = 0; turn < config.maxAgentTurns; turn++) {
    let response;
    try {
      response = await ollama.chat({
        model: config.ollamaModel,
        messages: messages as Parameters<typeof ollama.chat>[0]["messages"],
        tools: TOOL_SCHEMAS,
      });
    } catch (err) {
      logger.error(`Ollama error: ${err}`);
      return "Sorry, I couldn't reach my brain right now. Is Ollama running?";
    }

    messages.push(response.message as typeof messages[number]);

    const toolCalls = response.message.tool_calls ?? [];

    // No tool calls = LLM is done, return its text
    if (toolCalls.length === 0) {
      const content = response.message.content?.trim();
      if (content) {
        logger.info(`Agent response: ${content}`);
        return content;
      }
      return "I'm not sure what to do with that. Try asking me to set a reminder!";
    }

    // Execute each tool call and feed results back
    for (const call of toolCalls) {
      const toolName = call.function.name;
      const toolArgs = (call.function.arguments ?? {}) as Record<string, unknown>;
      logger.info(`Tool call: ${toolName}(${JSON.stringify(toolArgs)})`);

      const result = await executeTool(toolName, toolArgs, deps);
      logger.info(`Tool result: ${result}`);

      messages.push({
        role: "tool",
        content: result,
      } as typeof messages[number]);
    }
    // Loop continues -- LLM sees tool results and decides next action
  }

  logger.warn("Agent reached max turns");
  return "I've done a lot of work on that request. Let me know if there's anything else!";
}
