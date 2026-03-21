# User Testing Guide — Photon Todo Agent

## Testing Surface: Backend (Milestone 1: backend-reliability)

The backend agent cannot be tested via iMessage automation (it would send real messages). All validation relies on the **Vitest test suite** with mocked dependencies.

### Testing Tool
- **Vitest** v4.1.0
- Command: `cd agent && npx vitest run`
- Config: `agent/vitest.config.ts`

### Test Files and Coverage Areas
| File | Area | Assertions Covered |
|------|------|-------------------|
| `sanitize.test.ts` | Input sanitization | VAL-PARSE-001, VAL-PARSE-002 |
| `time-parser.test.ts` | Time parsing | VAL-PARSE-003, VAL-PARSE-004, VAL-PARSE-005, VAL-PARSE-006, VAL-PARSE-007, VAL-EDGE-001, VAL-EDGE-005 |
| `sessions.test.ts` | Conversation sessions | VAL-SESSION-001, VAL-SESSION-002, VAL-SESSION-003, VAL-SESSION-004, VAL-EDGE-003 |
| `dispatcher.test.ts` | Dispatcher flow | VAL-DISPATCH-001 through VAL-DISPATCH-005 |
| `scheduler.test.ts` | Reminders, EOD, lifecycle | VAL-REMIND-001 through 005, VAL-STATUS-001 through 004, VAL-EOD-001, VAL-EOD-002, VAL-EDGE-004 |
| `edit-cancel.test.ts` | Edit/cancel flows | VAL-EDIT-001 through 004, VAL-EDGE-002 |
| `multi-task-chat.test.ts` | Multi-task + chat | VAL-MULTI-001, VAL-MULTI-002, VAL-CHAT-001 through 003 |
| `db-schema-migration.test.ts` | Database schema | VAL-DB-001, VAL-DB-002, VAL-DB-003, VAL-STATUS-005 |
| `disambiguation-followup.test.ts` | Session disambiguation | VAL-SESSION-004 (additional coverage) |
| `responder-timezone.test.ts` | Timezone formatting | (supports VAL-PARSE-003 timezone handling) |

### Environment
- All tests mock: Supabase client, Ollama LLM, iMessage SDK (`@photon-ai/imessage-kit`)
- No external dependencies needed for test execution
- Tests run in ~300ms total

### Setup Steps
1. Ensure dependencies installed: `cd agent && npm install`
2. Run tests: `npx vitest run`
3. Run with verbose: `npx vitest run --reporter=verbose`

## Validation Concurrency

**Surface: Vitest CLI**
- Max concurrent validators: **5**
- Validators are read-only (analyzing test output) — no shared mutable state
- Each subagent runs `npx vitest run <specific-test-file> --reporter=verbose` to get detailed test names
- No isolation resources needed — test files are independent

## Flow Validator Guidance: Vitest CLI

### How to validate assertions
1. Run the specific test file(s) with verbose output: `cd agent && npx vitest run src/__tests__/<file>.test.ts --reporter=verbose`
2. Examine the test names to match them against validation contract assertion IDs
3. For each assertion, find the test(s) that verify the described behavior
4. Check that the test(s) pass and the test logic actually verifies what the assertion requires
5. Read the test source code to confirm the test is meaningful (not just a no-op pass)

### Assertion validation criteria
- **pass**: A passing test exists that meaningfully verifies the assertion's described behavior
- **fail**: Tests exist but fail, OR the test logic doesn't actually verify the assertion
- **blocked**: No test exists for the assertion, or prerequisites are broken

### Isolation rules
- Do NOT modify any test files or source code
- Do NOT run the agent process (sends real iMessages)
- Test runs are side-effect-free (all mocked)

## Testing Surface: Web Dashboard (Milestone 2: web-dashboard)

The web dashboard is tested via **agent-browser** navigating the Next.js app on `http://localhost:3000`.

### Prerequisites
- **CRITICAL**: `web/.env.local` must exist with `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` set. Without these, all data-driven pages show "Supabase configuration is missing" error.
- The `.env.local` file is gitignored and must be created manually.
- All pages are publicly accessible (no auth gate).

### Testing Tool
- **agent-browser** CLI for browser automation
- Next.js dev server: `cd web && PORT=3000 npx next dev --port 3000`
- Port 3000 must be free before starting

### Pages and Routes
| Route | Page | Component |
|-------|------|-----------|
| `/` | Dashboard (home) | `dashboard-client.tsx` |
| `/todos` | Todos list | `todo-board.tsx` + `todo-card.tsx` |
| `/logs` | Messages/Logs | `logs/page.tsx` |
| `/settings` | Settings | `settings/page.tsx` |
| `/demo` | Status Badge Demo | `demo/page.tsx` (no Supabase needed) |

### Setup Steps
1. Kill existing port 3000: `lsof -ti :3000 | xargs kill 2>/dev/null`
2. Install deps: `cd web && npm install`
3. Start dev server: `cd web && PORT=3000 npx next dev --port 3000` (background)
4. Wait for health: `curl -sf http://localhost:3000`
5. Seed test data via Supabase client (requires env vars)

### Seed Data Requirements
To test all assertions, you need todos with these statuses:
- `pending` tasks due today (various times)
- `in_progress` task with `due_at` 5-10 minutes in the past (overdue active)
- `in_progress` task with `due_at` in the future (normal)
- `done` task with `completed_at` today
- `not_confirmed` task
- `canceled` task with `canceled_at` set
- Tasks from last week (for time grouping tests)
- Message logs with both `inbound` and `outbound` directions

### Known Issues (Round 1)
- `.env.local` was missing, blocking 18 of 24 assertions
- The demo page at `/demo` works without Supabase and can validate badge assertions
- Error handling works correctly on all pages (shows user-visible error, not silent failure)

## Validation Concurrency

**Surface: Web Browser (agent-browser)**
- Max concurrent validators: **3** (Next.js dev server ~830MB + agent-browser ~400MB per instance)
- Validators share the same Supabase database — need data isolation via separate user accounts or unique task names
- Browser sessions should use unique session names per subagent

## Flow Validator Guidance: Web Browser

### How to validate assertions
1. Start agent-browser session: `agent-browser --session "<name>" open http://localhost:3000`
2. Navigate to the relevant page
3. Use `snapshot -i` to find interactive elements
4. Use `screenshot` for visual evidence
5. Interact with elements (click, fill, etc.) to test functionality
6. Check console errors: `agent-browser errors`
7. Close session when done: `agent-browser --session "<name>" close`

### Assertion validation criteria
- **pass**: The UI behavior matches the assertion description, confirmed via screenshot and interaction
- **fail**: The UI behavior does not match (wrong ordering, missing elements, broken interaction)
- **blocked**: Page cannot load due to missing dependencies (e.g., no Supabase credentials)

### Data testid attributes
The codebase uses `data-testid` attributes for reliable element targeting:
- `stat-cards`, `stat-pending`, `stat-in-progress`, `stat-done-today`, `stat-total-tasks`
- `not-confirmed-section`, `overdue-section`, `today-section`
- `empty-state`, `task-card`, `todo-card`
- `status-filter-tabs`, `filter-tab-all`, `filter-tab-pending`, etc.
- `time-group-tabs`, `time-group-today`, `time-group-this_week`, `time-group-all`
- `edit-button`, `reschedule-button`, `cancel-button`, `done-button`
- `edit-dialog`, `reschedule-dialog`, `cancel-dialog`
- `message-bubble`, `error-message`, `polling-toggle`, `refresh-button`

### Isolation rules
- Do NOT modify source code or env files
- Do NOT start the agent process (sends real iMessages)
- Each subagent should use a unique browser session name
- Seed data should use unique identifiers to avoid cross-contamination
