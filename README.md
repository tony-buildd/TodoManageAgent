# Photon Todo Agent

A self-text iMessage todo and reminder assistant powered by local LLM, with a Next.js dashboard. Text yourself tasks and reminders; the agent captures them, schedules notifications, and tracks completion through a clean status lifecycle.

## How It Works

Photon uses the **self-text paradigm**: you send an iMessage to yourself describing a task or reminder. The agent watches your iMessage database via [Photon iMessage Kit](https://github.com/nichochar/photon-imessage-kit), classifies your intent using a rule-first dispatcher with LLM fallback, creates and schedules tasks in Supabase, and sends reminder messages back to you at the right time. Follow-up replies stay attached to the correct task through conversation sessions, so you can clarify, edit, or complete tasks naturally via text.

## Features

- **Deterministic time parsing**: chrono-node extracts dates and times before the LLM is consulted, with timezone-aware defaults
- **Multi-thread conversation sessions** — follow-up replies stay attached to the right task; multiple unresolved threads tracked simultaneously
- **Rule-first dispatcher**: greetings, edits, cancels, done confirmations, and multi-task splitting are all handled deterministically before the LLM
- **Smart reminder scheduling**: short-horizon tasks are reminded at due time instead of in the past
- **Status lifecycle**: Pending → In Progress → Done / Not Confirmed / Canceled
- **15-minute grace period**: overdue tasks stay active briefly before moving to Not Confirmed
- **10 PM end-of-day summary**: unresolved Not Confirmed tasks summarized once at end of day
- **Edit, reschedule, and cancel via text**: natural follow-ups like "actually make that 9" or "cancel that"
- **Multi-task splitting**: "buy milk at 7 and call mom at 6" creates two separate tasks
- **Web dashboard**: priority-ordered task view, manual controls, status filtering, time grouping, and auto-refreshing logs

## Architecture

This is a monorepo managed with npm workspaces:

```
photon2/
├── agent/          # TypeScript backend — iMessage watcher, dispatcher, scheduler
│   └── src/
├── web/            # Next.js 14 dashboard — task management UI
│   ├── app/
│   ├── components/
│   └── lib/
├── supabase/       # Database migrations (PostgreSQL via Supabase)
│   └── migrations/
├── doc/            # Product spec and design documents
├── .env.example    # Agent environment template
└── package.json    # Root workspace config
```

**Key technologies:**

- **TypeScript**: agent and web are both TypeScript
- **Photon iMessage Kit**: watches macOS `chat.db` for new messages and sends replies
- **Ollama** — local LLM inference (default model: `llama3.2:3b`) for intent classification fallback
- **chrono-node**: deterministic date/time parsing
- **Supabase**: PostgreSQL database with Row Level Security
- **Next.js 14**: server-rendered dashboard with App Router
- **Tailwind CSS**: utility-first styling
- **Radix UI**: accessible UI primitives (Dialog, Select, Tabs)

## Prerequisites

- **macOS**: iMessage requires `chat.db` access (grant Full Disk Access to your terminal)
- **Node.js 18+**
- **Ollama** with a model installed (default: `llama3.2:3b`)
- **Supabase account**: free tier works

## Setup

### 1. Clone the repo

```bash
git clone <repo-url>
cd photon2
```

### 2. Install dependencies

npm workspaces handle both `agent` and `web`:

```bash
npm install
```

### 3. Configure agent environment

Copy the example and fill in your values:

```bash
cp .env.example .env
```

The `.env.example` file documents all required variables:

| Variable | Description |
| --- | --- |
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase anon/public key |
| `SUPABASE_SECRET_KEY` | Supabase service-role key |
| `OLLAMA_HOST` | Ollama API endpoint (default `http://localhost:11434`) |
| `OLLAMA_MODEL` | Ollama model name (default `llama3.2:3b`) |
| `PHONE_NUMBER` | Your iMessage phone number |
| `DEFAULT_TIMEZONE` | IANA timezone (e.g. `America/Los_Angeles`) |
| `DEFAULT_REMINDER_LEAD_MINUTES` | Minutes before due time to send reminder (default `30`) |

### 4. Configure web environment

```bash
cp web/.env.local.example web/.env.local
```

| Variable | Description |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase anon/public key |

### 5. Apply database migrations

Run the SQL in `supabase/migrations/001_initial.sql` against your Supabase project. You can do this via:

- **Supabase Dashboard** — open the SQL Editor and paste the migration file contents
- **Supabase CLI** — `supabase db push` if you have the CLI configured

### 6. Ensure Ollama is running

```bash
ollama serve
```

Pull the default model if you haven't already:

```bash
ollama pull llama3.2:3b
```

## Running

Start the agent:

```bash
npm run agent
```

Start the web dashboard (dev server on `http://localhost:3000`):

```bash
npm run web
```

Run both concurrently:

```bash
npm run dev
```

## Testing

Run agent tests:

```bash
cd agent && npx vitest run
```

Verify the web dashboard builds:

```bash
cd web && npx next build
```

Run the web dev server:

```bash
cd web && npx next dev
```

## Status Model

Tasks follow a five-state lifecycle:

| Status | Description |
| --- | --- |
| **Pending** | Task created, reminder not yet sent |
| **In Progress** | Reminder sent, task is active |
| **Done** | User confirmed completion |
| **Not Confirmed** | Grace period (15 min) elapsed after reminder without confirmation |
| **Canceled** | Task explicitly canceled by user via text or dashboard |

> **Note:** "Overdue but active" is a derived UI state, not a stored status. It applies when a task is In Progress, past its `due_at`, and still within the 15-minute grace period.

## Project Structure

```
agent/src/
├── index.ts        # Entry point — initializes DB, parser, SDK, scheduler, watcher
├── db.ts           # Supabase client and database operations
├── parser.ts       # Intent classification and time parsing (chrono-node + Ollama)
├── responder.ts    # Message response generation
├── scheduler.ts    # Reminder scheduling and grace-period transitions
├── types.ts        # Shared TypeScript types
└── watcher.ts      # iMessage watcher — listens for new messages and dispatches

web/app/
├── layout.tsx      # Root layout with sidebar and header
├── page.tsx        # Dashboard home — stats cards and upcoming tasks
├── globals.css     # Global styles and Tailwind config
├── todos/
│   └── page.tsx    # Full task list with filtering and manual controls
├── logs/
│   └── page.tsx    # Message log viewer
└── settings/
    └── page.tsx    # User settings

web/components/
├── header.tsx      # Top navigation bar
├── sidebar.tsx     # Side navigation
├── todo-card.tsx   # Individual task card component
├── todo-board.tsx  # Task board with grouping and filtering
├── status-badge.tsx # Status indicator component
└── message-log.tsx # Log entry display component

web/lib/
├── supabase.ts     # Supabase client initialization and types
└── utils.ts        # Shared utility functions
```

## License

[MIT](LICENSE)
