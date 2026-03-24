# iMessage Reminder Agent -- MVP Specification

## Overview

A long-running Bun process on macOS that watches your self-iMessage thread, uses Ollama (llama3.2:3b) to classify incoming messages as reminders or not, extracts task + time, schedules reminders via `@photon-ai/imessage-kit`, and sends you an iMessage at the specified time.

---

## Architecture

```
You (iMessage to yourself)
        |
        v
  iMessage SDK Watcher (polls every 2s)
        |
        v
  Loop Prevention Filter (skip messages containing [todo-agent])
        |
        v
  Startup Filter (ignore messages from before agent start time)
        |
        v
  Clarification State Check (is this a follow-up to a pending clarification?)
        |
   [yes] \             [no]
          v               v
   Ollama: parse      Ollama: classify + parse
   time only           (reminder or not?)
        |                   |
        v                   v
  Schedule reminder    [reminder] -> Schedule + confirm
  or retry clarify     [not reminder] -> "[todo-agent] Not a reminder -- ignoring."
```

---

## User Flow

### Happy Path

1. You text yourself: `"call mom at 3pm"`
2. Agent sends `[todo-agent] Processing...`
3. Agent sends message to Ollama with current datetime/timezone injected
4. Ollama returns `{ isReminder: true, task: "call mom", time: "2026-03-22T15:00:00-07:00" }`
5. Agent schedules reminder, persists state
6. Agent sends `[todo-agent] Got it -- I'll remind you to "call mom" at 3:00 PM on Sat, Mar 22`
7. At 3:00 PM, agent sends `[todo-agent] Reminder: call mom`

### Non-Reminder Flow

1. You text yourself: `"grocery list: milk, eggs"`
2. Agent sends `[todo-agent] Processing...`
3. Ollama returns `{ isReminder: false }`
4. Agent sends `[todo-agent] Not a reminder -- ignoring.`

### Ambiguous Flow (Multi-Turn Clarification)

1. You text: `"do the thing later"`
2. Agent sends `[todo-agent] Processing...`
3. Ollama returns `{ isReminder: true, task: "do the thing", time: null }`
4. Agent sends `[todo-agent] When should I remind you to "do the thing"?`
5. Agent enters clarification state (5 min timeout, max 2 attempts)
6. You reply: `"5pm"`
7. Agent parses "5pm" via Ollama -> schedules -> confirms

---

## Decisions Log

| Decision | Choice | Rationale |
|---|---|---|
| **Scope** | Pure reminder agent (no task management, cancel, list) | MVP -- keep it simple |
| **Parsing** | LLM-based via Ollama (llama3.2:3b) | Flexible natural language, runs locally, no API keys |
| **iMessage setup** | Text own number (agent watches own messages) | No second Apple ID needed |
| **Runtime** | Bun | Zero dependencies for imessage-kit, recommended by the library |
| **Persistence** | Atomic JSON file writes (temp + rename) | Simple and sufficient for single-process |
| **Clarification** | Multi-turn, 5 min timeout, max 2 attempts, new reminder cancels pending | Good UX without complexity |
| **Reminder delivery** | Fire once and done | No nag/repeat |
| **Missed reminders** | Single summary on restart | Not noisy, still informative |
| **Ollama availability** | Assume always running, fail with error if down | User runs it as service |
| **Message filtering** | Send ALL self-texts to Ollama for classification | Maximum flexibility, no trigger prefix needed |
| **Time parsing** | Ollama outputs ISO 8601, we construct Date objects | Most reliable approach |
| **Acknowledgment UX** | Immediate "Processing..." then confirmation (2 messages) | Responsive feedback |
| **Agent message format** | Bracket prefix: `[todo-agent]` | Clear, consistent, enables loop prevention |
| **Non-reminder behavior** | Agent replies `[todo-agent] Not a reminder -- ignoring.` | Confirms agent is alive |
| **Deployment** | Foreground terminal process | Simple, manual start |
| **Error reporting** | Both terminal logs AND iMessage notifications | Full visibility |
| **Logging** | stdout only, no file | Keep it simple |
| **Config** | Environment variables (.env) | Standard approach |

---

## Configuration

All config via environment variables:

| Variable | Required | Default | Description |
|---|---|---|---|
| `PHONE_NUMBER` | Yes | -- | Your iMessage phone number (e.g. `+1234567890`) |
| `OLLAMA_MODEL` | No | `llama3.2:3b` | Ollama model name |
| `OLLAMA_URL` | No | `http://localhost:11434` | Ollama API endpoint |

---

## Loop Prevention

All agent-sent messages are prefixed with `[todo-agent]`. The watcher skips any message containing this marker. This prevents the agent from processing its own replies.

---

## Startup Behavior

- On start, the agent records `Date.now()` as `startTime`
- The watcher ignores all messages with `date < startTime`
- On start, the agent loads `reminders.json` and checks for past-due reminders
- Past-due reminders are NOT fired individually; instead a single summary is sent:
  ```
  [todo-agent] You missed 3 reminders while offline:
  1) call mom (was 3:00 PM on Sat, Mar 22)
  2) submit report (was 5:00 PM on Sat, Mar 22)
  ```

---

## Ollama Integration

### Classification Prompt

System prompt (injected with every request):
```
You are a reminder extraction assistant. The current date/time is {ISO_DATETIME} in timezone {TIMEZONE}.

Analyze the user's message and respond with ONLY valid JSON:

If it's a reminder request:
{ "isReminder": true, "task": "<what to remind>", "time": "<ISO 8601 datetime>" }

If the task is clear but the time is ambiguous or missing:
{ "isReminder": true, "task": "<what to remind>", "time": null }

If it's NOT a reminder:
{ "isReminder": false }
```

### Clarification Prompt

```
The user was asked when they want to be reminded about: "{task}".
They replied: "{user_reply}".
Current date/time: {ISO_DATETIME}, timezone: {TIMEZONE}.

Respond with ONLY valid JSON:
{ "time": "<ISO 8601 datetime>" }
Or if still ambiguous:
{ "time": null }
```

API call: `POST {OLLAMA_URL}/api/generate` with `model`, `prompt`, `system`, `stream: false`, `format: "json"`.

---

## Clarification State Machine

```
States: IDLE | AWAITING_CLARIFICATION

IDLE:
  - New message arrives -> send to Ollama for classification
  - If isReminder + has time -> schedule, go to IDLE
  - If isReminder + no time -> ask user, go to AWAITING_CLARIFICATION (attempt=1)
  - If not reminder -> send "Not a reminder -- ignoring."

AWAITING_CLARIFICATION (attempt N, max 2):
  - Message arrives within 5 min timeout:
    - Send to Ollama for time-only parsing
    - If time parsed -> schedule, go to IDLE
    - If time null AND attempt < 2 -> ask again, stay (attempt++)
    - If time null AND attempt >= 2 -> give up, send error, go to IDLE
  - 5 min timeout expires -> send "[todo-agent] Clarification timed out.", go to IDLE
  - (New unrelated reminder while in this state: NOT supported in MVP -- all messages
    in clarification state are treated as time responses)
```

---

## Persistence

- File: `reminders.json` in project root
- Written via atomic writes (write to `reminders.json.tmp`, then `rename()`)
- Written on every schedule event, on send completion, and on shutdown
- Format: direct output of `MessageScheduler.export()`
- Loaded on startup via `MessageScheduler.import()`

---

## Error Handling

| Error | iMessage Response | Terminal Log |
|---|---|---|
| Ollama unreachable | `[todo-agent] Error: couldn't reach Ollama. Is it running?` | Yes |
| Ollama returns invalid JSON | Retry once, then `[todo-agent] Error: couldn't understand that. Try again?` | Yes |
| iMessage send failure | N/A (can't send if sending is broken) | Yes |
| Invalid/past time from Ollama | Treated as `time: null`, triggers clarification flow | Yes |

---

## Project Structure

```
todo-agent/
  package.json
  .env                    # PHONE_NUMBER, optional OLLAMA_MODEL, OLLAMA_URL
  .env.example            # Template
  docs/
    spec.md               # This file
  src/
    index.ts              # Entry point: starts watcher, loads persistence, main loop
    parser.ts             # Ollama API calls: classify message, parse time, parse clarification
    store.ts              # Atomic read/write of reminders.json
    config.ts             # Reads env vars, exports typed config
    state.ts              # Clarification state machine (IDLE / AWAITING)
    logger.ts             # Simple timestamped console logger
  reminders.json          # Auto-generated, gitignored
```

---

## Dependencies

- `@photon-ai/imessage-kit` -- iMessage SDK (send, watch, schedule)
- No other runtime dependencies (Bun built-ins for fetch, fs, etc.)

---

## Commands

```bash
bun install                  # Install dependencies
bun run start                # Start the agent (or: bun run src/index.ts)
```

---

## Prerequisites

- macOS with iMessage signed in
- Full Disk Access granted to Terminal (System Settings > Privacy & Security > Full Disk Access)
- Ollama running locally with `llama3.2:3b` model pulled (`ollama pull llama3.2:3b`)
- Bun installed (`curl -fsSL https://bun.sh/install | bash`)
