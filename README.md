# TodoManageAgent

A personal reminder agent that lives in iMessage. Text yourself to create, update, cancel, and manage reminders -- powered by a local LLM with tool calling for natural language understanding.

## Architecture

LLM-first agent design: the model (Ollama `qwen3:8b`) is the orchestrator. It receives your message, decides what to do by calling tools, sees the results, and responds naturally. No regex routing, no state machine.

```
iMessage → Watcher → Agent Loop (LLM + tools) → Tool execution → LLM response → iMessage
                         ↑                                             |
                         └──────────── loop until done ────────────────┘
```

### Project Structure

```
src/
├── index.ts    # Entry point: iMessage watcher, startup/shutdown
├── agent.ts    # ReAct agent loop with Ollama tool calling
├── tools.ts    # 7 tool schemas + executeTool() registry
├── parser.ts   # Time parsing via chrono-node
├── state.ts    # MessageHistory for conversation persistence
├── store.ts    # Disk persistence (reminders.json, history.json)
├── config.ts   # Environment configuration
└── logger.ts   # Structured logging
```

### Design Principles

Based on research from recent papers on small LLM agents:

- **Few-shot examples** in system prompt for better tool selection (ReAct Brittle Foundations)
- **Concise tool descriptions** to reduce token usage (EASYTOOL)
- **Decision token** -- explicit "does this need a tool?" step before acting (Function-Calling Strategies)
- **PreAct prediction** -- anticipate tool results before executing (PreAct)
- **Tool overuse mitigation** -- skip tool calls for casual messages (SMART)
- **Error recovery** -- feed tool errors back to LLM for self-correction (Granite)

## Features

- **Natural language reminders** -- "Remind me to call mom tomorrow at 3pm"
- **Update reminders** -- "Change the call mom reminder to 5pm"
- **Cancel reminders** -- "Cancel call mom", "delete reminder 1", "cancel all"
- **Recurring reminders** -- "Remind me every day at 9am to take medicine"
- **List reminders** -- "What reminders do I have?"
- **Snooze** -- "Snooze" or "snooze 15 min" after a reminder fires
- **Multi-command** -- "Cancel the first one and remind me to study at 8pm"
- **Conversation memory** -- Remembers context across messages and restarts
- **Missed reminder recovery** -- Notifies you of reminders that fired while offline

## Tools

| Tool | Purpose |
|---|---|
| `schedule_reminder` | Create a one-time reminder |
| `schedule_recurring` | Create a recurring reminder |
| `update_reminder` | Change time of an existing reminder |
| `cancel_reminder` | Cancel a specific reminder by name or number |
| `cancel_all_reminders` | Cancel all reminders (destructive) |
| `list_reminders` | List all pending reminders |
| `snooze` | Snooze the last fired reminder |

## Prerequisites

- macOS (uses iMessage via AppleScript)
- [Bun](https://bun.sh)
- [Ollama](https://ollama.ai) with `qwen3:8b` (or any model supporting tool calling)

## Setup

```bash
bun install
```

Create `.env`:

```
PHONE_NUMBER=+1234567890
OLLAMA_MODEL=qwen3:8b
OLLAMA_URL=http://localhost:11434
```

Pull the model and start Ollama:

```bash
ollama pull qwen3:8b
ollama serve
```

## Usage

```bash
bun run start
```

Text yourself in iMessage. The agent watches for your messages and responds in the same conversation thread.

### Examples

| Message | What happens |
|---|---|
| "Remind me to take medicine at 9am" | Creates reminder |
| "Remind me every day at 10pm to journal" | Creates recurring reminder |
| "Change it to 9:30am" | Updates most recent reminder |
| "Cancel the medicine reminder" | Cancels by name |
| "Cancel reminder 2" | Cancels by number |
| "List reminders" | Shows all active reminders |
| "Snooze 15 min" | Reschedules just-fired reminder |
| "Delete all and remind me to sleep at 11pm" | Multi-command |

### Supported Time Formats

- Absolute: `8:30 PM`, `3pm`, `noon`, `midnight`
- Relative: `in 5 minutes`, `in an hour`, `in 1.5 hours`
- Named: `tonight`, `this morning`, `this afternoon`, `eod`
- Days: `tomorrow 9am`, `friday 2pm`, `next tuesday at 3pm`
- Dates: `december 25th at 3pm`, `march 1st at noon`

## Configuration

| Variable | Default | Description |
|---|---|---|
| `PHONE_NUMBER` | required | Your phone number |
| `OLLAMA_MODEL` | `qwen3:8b` | Ollama model name |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama server URL |

Internal defaults (in `config.ts`): max 10 agent turns, 0.7 temperature, 500 char message limit, 2s watcher poll interval, 10m model keep-alive.
