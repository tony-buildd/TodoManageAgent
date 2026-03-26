---
name: imessage-reminder-agent
description: Build, extend, and debug an LLM-first iMessage reminder agent powered by Ollama tool calling and @photon-ai/imessage-kit. Use when working on the TodoManageAgent project -- creating tools, modifying the agent loop, updating prompts, adding features, or debugging message handling.
---

# iMessage Reminder Agent

An LLM-first personal reminder agent that lives in iMessage. The model (Ollama `qwen3:8b`) is the orchestrator -- it decides what to do by calling tools, sees results, and responds naturally. No regex routing, no state machine.

## Architecture: Agent = Model + Harness

```
User iMessage → Watcher → Agent Loop (LLM + tools) → Tool execution → LLM response → Send iMessage
                              ↑                                              |
                              └────────────── loop until done ───────────────┘
```

**Model**: `qwen3:8b` via Ollama `/api/chat` with native tool calling
**Harness**: Tool definitions, execution registry, persistence, guardrails, message history

## Project Structure

```
src/
├── index.ts    # Entry point: iMessage watcher, startup/shutdown, delegates to agent
├── agent.ts    # Agent loop: system prompt + Ollama chat with tools in a ReAct loop
├── tools.ts    # 7 tool schemas (Ollama format) + executeTool() registry
├── parser.ts   # Time parsing via chrono-node (resolveTimeExpr, resolveRecurringInterval)
├── state.ts    # MessageHistory class for conversation persistence
├── store.ts    # Disk persistence (reminders.json, history.json)
├── config.ts   # Environment config (phone, model, temperature, guardrails)
└── logger.ts   # Structured logging
```

## Key Dependencies

- `@photon-ai/imessage-kit` -- iMessage SDK (send, receive, schedule, watch)
- `ollama` -- Official Ollama JS client with tool calling support
- `chrono-node` -- Natural language date/time parsing
- Runtime: **Bun** (not Node.js)

## Tools (defined in tools.ts)

The agent has 7 tools. Each returns a result string that the LLM reads to compose its response.

| Tool | Purpose | Parameters |
|---|---|---|
| `schedule_reminder` | Create a one-time reminder | `task`, `time` |
| `schedule_recurring` | Create a recurring reminder | `task`, `time`, `interval` |
| `update_reminder` | Reschedule an existing reminder | `task_query`, `new_time` |
| `cancel_reminder` | Cancel a specific reminder by name or number | `target` |
| `cancel_all_reminders` | Cancel all reminders (destructive) | none |
| `list_reminders` | List all pending reminders | none |
| `snooze` | Snooze last fired reminder | `duration` (optional) |

### Adding a New Tool

1. Add the schema to `TOOL_SCHEMAS` array in `tools.ts` following the Ollama tool format:
```ts
{
  type: "function",
  function: {
    name: "my_tool",
    description: "What this tool does and when to use it",
    parameters: {
      type: "object",
      required: ["param1"],
      properties: {
        param1: { type: "string", description: "..." },
      },
    },
  },
}
```

2. Add a `case` to the `executeTool()` switch statement that handles execution and returns a result string.

3. Update the system prompt in `agent.ts` if the tool needs specific behavioral instructions.

## Agent Loop (agent.ts)

```ts
for (let turn = 0; turn < MAX_TURNS; turn++) {
  response = await ollama.chat({ model, messages, tools, options: { temperature } });
  if (!response.message.tool_calls?.length) return response.message.content; // done
  for (const call of response.message.tool_calls) {
    result = await executeTool(call.function.name, call.function.arguments, deps);
    messages.push({ role: "tool", content: result });
  }
}
```

- Max 10 turns per message to prevent infinite loops
- LLM can call multiple tools in one turn (parallel tool calling)
- Tool results are fed back so the LLM can chain actions or self-correct

## System Prompt Rules

Key behavioral rules in the system prompt:
- No emojis, no markdown, 1-3 sentences max
- Create/update/cancel reminders immediately without asking for confirmation
- For `cancel_all_reminders`, confirm with user first (destructive)
- Sanity-check times against task context (e.g. "go to bed at 12 PM" should ask if they meant midnight)
- Copy user's time expression exactly when calling tools

## Time Parsing (parser.ts)

Uses `chrono-node` with `forwardDate: true`. Handles:
- "8 am tomorrow", "in 2 weeks", "next friday at 3pm"
- "december 25th at 3pm", "tonight", "noon", "midnight"
- Any natural language date expression

Recurring intervals are parsed separately: "daily", "weekly", "monthly", "hourly", "every N hours/minutes".

## Persistence

- `reminders.json` -- Scheduler state (via `@photon-ai/imessage-kit` MessageScheduler export/import)
- `history.json` -- Last 20 conversation messages in `{ role, content }` format
- Both use atomic write (write to `.tmp`, rename) to prevent corruption

## iMessage Integration

Uses `@photon-ai/imessage-kit`:
- `IMessageSDK` with watcher polling at 2s intervals, `excludeOwnMessages: false`
- `MessageScheduler` for scheduling with `onSent`/`onError` callbacks
- Messages filtered to self-conversation thread only (phone number matching)
- Agent messages prefixed with `[todo-agent]` marker to avoid echo loops

## Guardrails

- **Input**: Max 500 character message length
- **Agent loop**: Max 10 turns per message
- **Tool safety**: `cancel_all_reminders` requires LLM to confirm with user first
- **Error handling**: try/catch around agent loop with fallback message

## Config (environment variables)

```
PHONE_NUMBER=+1234567890    # Required
OLLAMA_MODEL=qwen3:8b       # Default
OLLAMA_URL=http://localhost:11434
```

## Common Tasks

### Running the agent
```bash
bun run start
```

### Typechecking
```bash
bun x tsc --noEmit
```

### Changing the model
Update `OLLAMA_MODEL` in `.env` and ensure it's pulled: `ollama pull <model>`
The model must support tool calling (qwen3, llama3.1+, mistral).

### Debugging
All tool calls and results are logged. Look for:
- `Tool call: <name>(<args>)` -- what the LLM decided to do
- `Tool result: <string>` -- what the tool returned
- `Agent response: <text>` -- final response sent to user
