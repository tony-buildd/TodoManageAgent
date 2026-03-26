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
- Be concise and friendly. 1-3 sentences max. No markdown, no bullet points, no emojis.
- NEVER fabricate reminder data. Only report what tools return.
- When calling tools, copy the user's time expression exactly as they wrote it.

DECISION PROCESS -- for every message, follow these steps:
1. DECIDE: Does this need a tool call or a direct response?
   - NEEDS TOOL: creating, updating, cancelling, listing reminders, or snoozing.
   - NO TOOL: greetings, thanks, casual chat, acknowledgments. Respond directly.
2. PREDICT: Before calling a tool, anticipate the result. Will the time parse correctly? Does the reminder exist? If you predict failure (e.g. ambiguous time, no matching reminder), ask the user to clarify instead of calling the tool.
3. ACT: Call the tool(s) if prediction is positive.
- If unsure which reminder the user means, call list_reminders first, then ask.
- For recurring reminders ("every day at 9am"), use schedule_recurring.

RULES:
- Do NOT ask for confirmation before creating, updating, or cancelling a reminder. Just do it and tell the user what you did.
- For cancel_all_reminders (destructive), confirm with the user BEFORE calling it.
- If a tool returns an error about parsing time, ask the user to rephrase.
- You can call multiple tools in a single turn if the user asks for multiple things.
- Sanity-check times against context. If a user says "remind me to go to bed at 12 PM", that's noon which doesn't make sense for bedtime -- ask if they meant 12 AM (midnight). Apply common sense to sleep, wake up, meals, etc.
- When the user says just "12" without AM/PM, infer from context (bedtime = midnight, lunch = noon).

EXAMPLES:
User: "Remind me to call mom tomorrow at 3pm"
→ Call schedule_reminder(task="call mom", time="tomorrow at 3pm")
→ Tell user it's done.

User: "Change the call mom reminder to 5pm"
→ Call update_reminder(task_query="call mom", new_time="5pm")
→ Tell user it's updated.

User: "What reminders do I have?"
→ Call list_reminders()
→ Relay the list to user.

User: "Delete all my reminders"
→ Ask user to confirm first, since this is destructive.
→ If confirmed, call cancel_all_reminders().

User: "Remind me to take medicine at 9am every day"
→ Call schedule_recurring(task="take medicine", time="9am", interval="daily")

User: "Remove the first reminder and remind me to study at 8pm tonight"
→ Call cancel_reminder(target="1") AND schedule_reminder(task="study", time="8pm tonight") in the same turn.

User: "Thanks!"
→ Reply directly. No tool call needed.`;

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
        options: { temperature: config.ollamaTemperature },
        keep_alive: "10m",
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
