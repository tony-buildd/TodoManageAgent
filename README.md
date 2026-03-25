# TodoManageAgent

A personal reminder agent that lives in iMessage. Text yourself to create, update, cancel, and manage reminders -- powered by a local Ollama LLM for natural language understanding.

## Features

- **Natural language reminders** -- "Remind me to go to bed at 11:45 PM", "in half an hour", "next tuesday at 3pm"
- **Update reminders** -- "Change it to 11:51 PM", "actually make it 3pm"
- **Cancel reminders** -- "Cancel go to bed", "delete reminder 1", "cancel all reminders"
- **Recurring reminders** -- "Remind me every day at 9am", "every monday at 3pm"
- **List reminders** -- "List reminders", "show my reminders"
- **Snooze** -- Reply "snooze" or "snooze 10 min" after a reminder fires
- **Smart time parsing** -- Understands "tonight", "noon", "midnight", "eod", "in 1.5 hours", "this afternoon", and more
- **Conversation memory** -- Remembers context across messages and restarts so "actually change it to 3pm" works
- **Disambiguation** -- When multiple reminders match, asks you to pick by number
- **Missed reminder recovery** -- Notifies you of any reminders that fired while the agent was offline

## Prerequisites

- macOS (uses iMessage via AppleScript)
- [Bun](https://bun.sh)
- [Ollama](https://ollama.ai) running locally with a model installed (default: `llama3.2:3b`)

## Setup

1. Install dependencies:

```bash
bun install
```

2. Create a `.env` file from the example:

```bash
cp .env.example .env
```

3. Edit `.env` with your phone number:

```
PHONE_NUMBER=+1234567890
OLLAMA_MODEL=llama3.2:3b
OLLAMA_URL=http://localhost:11434
```

4. Make sure Ollama is running:

```bash
ollama serve
```

## Usage

```bash
bun run start
```

Then text yourself in iMessage. The agent watches for your messages and responds in the same conversation thread.

### Example Commands

| Message | What happens |
|---|---|
| "Remind me to take medicine at 9am" | Creates a reminder with confirmation |
| "Remind me every day at 10pm to journal" | Sets up a recurring daily reminder |
| "Change it to 9:30am" | Updates the most recent reminder's time |
| "Cancel the medicine reminder" | Cancels it by name |
| "Cancel reminder 2" | Cancels by index |
| "List reminders" | Shows all active reminders |
| "Snooze 15 min" | Reschedules a just-fired reminder |
| "What reminders do I have?" | Lists reminders (LLM-aware) |

### Supported Time Formats

- Absolute: `8:30 PM`, `3pm`, `noon`, `midnight`
- Relative: `in 5 minutes`, `in an hour`, `in half an hour`, `in 1.5 hours`
- Named: `tonight`, `this morning`, `this afternoon`, `this evening`, `eod`
- Days: `tomorrow 9am`, `friday 2pm`, `next tuesday at 3pm`
- Compound: `in an hour and 30 minutes`, `in 2 hours and a half`

## Architecture

- **`src/index.ts`** -- Entry point, message handling, command routing
- **`src/parser.ts`** -- LLM classification, time parsing, text extraction
- **`src/state.ts`** -- Conversation state machine (confirmation, clarification, disambiguation)
- **`src/store.ts`** -- Persistence for reminders and conversation history
- **`src/config.ts`** -- Environment configuration
- **`src/logger.ts`** -- Structured logging
