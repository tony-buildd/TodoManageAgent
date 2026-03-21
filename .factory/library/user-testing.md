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
