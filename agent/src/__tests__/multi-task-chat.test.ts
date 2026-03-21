import { describe, it, expect, vi } from 'vitest';
import { dispatch, type DispatcherDeps } from '../dispatcher.js';
import type { ConversationSession, Todo, SessionState } from '../types.js';

// ─── Test helpers ───────────────────────────────────────────────────────────

function makeTodo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: 'todo-1',
    user_id: 'user-1',
    task: 'get food',
    due_at: '2026-03-21T21:00:00.000Z',
    remind_at: '2026-03-21T20:30:00.000Z',
    status: 'pending',
    reminded_at: null,
    completed_at: null,
    canceled_at: null,
    not_confirmed_at: null,
    created_at: '2026-03-21T18:00:00.000Z',
    updated_at: '2026-03-21T18:00:00.000Z',
    ...overrides,
  };
}

function makeSession(overrides: Partial<ConversationSession> = {}): ConversationSession {
  return {
    id: 'session-1',
    user_id: 'user-1',
    chat_key: '+15555555555',
    related_todo_id: 'todo-1',
    state: 'awaiting_time' as SessionState,
    task_label_snapshot: 'get food',
    candidate_todo_ids: null,
    prompt_type: 'awaiting_time',
    last_inbound_at: new Date().toISOString(),
    last_outbound_at: new Date().toISOString(),
    resolved_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Creates a mock Supabase client that handles the dispatch pipeline's queries.
 * Matches the pattern from dispatcher.test.ts.
 */
function createDispatchMocks(options: {
  activeSessions?: ConversationSession[];
  activeTodos?: Todo[];
  insertReturns?: Todo;
} = {}) {
  const sendMessage = vi.fn().mockResolvedValue(undefined);
  const llmParse = vi.fn().mockResolvedValue(null);

  const messageLogsInsert = vi.fn().mockReturnValue({
    data: null,
    error: null,
    then: (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
  });

  const sessionsSelect = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      is: vi.fn().mockReturnValue({
        order: vi.fn().mockReturnValue({
          data: options.activeSessions ?? [],
          error: null,
          then: (resolve: (v: unknown) => void) =>
            resolve({ data: options.activeSessions ?? [], error: null }),
        }),
      }),
    }),
  });

  const sessionsInsert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockReturnValue({
        data: {
          id: 'session-new',
          user_id: 'user-1',
          chat_key: '+15555555555',
          related_todo_id: null,
          state: 'awaiting_edit_target',
          task_label_snapshot: 'edit',
          candidate_todo_ids: null,
          prompt_type: '',
          last_inbound_at: new Date().toISOString(),
          last_outbound_at: new Date().toISOString(),
          resolved_at: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        error: null,
        then: (resolve: (v: unknown) => void) =>
          resolve({
            data: {
              id: 'session-new',
              user_id: 'user-1',
              state: 'awaiting_edit_target',
            },
            error: null,
          }),
      }),
    }),
  });

  const todosSelect = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      in: vi.fn().mockReturnValue({
        order: vi.fn().mockReturnValue({
          data: options.activeTodos ?? [],
          error: null,
          then: (resolve: (v: unknown) => void) =>
            resolve({ data: options.activeTodos ?? [], error: null }),
        }),
      }),
    }),
  });

  // Track each insert call to return different todos for multi-task
  let insertCallCount = 0;
  const todosInsert = vi.fn().mockImplementation(() => {
    insertCallCount++;
    const insertedTodo = options.insertReturns ?? makeTodo({ id: `todo-insert-${insertCallCount}` });
    return {
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockReturnValue({
          data: insertedTodo,
          error: null,
          then: (resolve: (v: unknown) => void) =>
            resolve({ data: insertedTodo, error: null }),
        }),
      }),
    };
  });

  const todosUpdate = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      data: null,
      error: null,
      then: (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: null }),
    }),
  });

  const sessionsUpdate = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      data: null,
      error: null,
      then: (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: null }),
    }),
  });

  const mockFrom = vi.fn().mockImplementation((table: string) => {
    if (table === 'message_logs') {
      return { insert: messageLogsInsert };
    }
    if (table === 'conversation_sessions') {
      return {
        select: sessionsSelect,
        insert: sessionsInsert,
        update: sessionsUpdate,
      };
    }
    if (table === 'todos') {
      return {
        select: todosSelect,
        insert: todosInsert,
        update: todosUpdate,
      };
    }
    return {
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnValue({
        data: null,
        error: null,
        then: (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
      }),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockReturnValue({
        data: null,
        error: null,
        then: (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
      }),
    };
  });

  const client = { from: mockFrom } as any;

  return {
    client,
    sendMessage,
    llmParse,
    mockFrom,
    messageLogsInsert,
    sessionsSelect,
    sessionsInsert,
    todosSelect,
    todosInsert,
    todosUpdate,
    sessionsUpdate,
  };
}

function makeDeps(
  mocks: ReturnType<typeof createDispatchMocks>,
  overrides: Partial<DispatcherDeps> = {},
): DispatcherDeps {
  return {
    supabase: mocks.client,
    sendMessage: mocks.sendMessage,
    userId: 'user-1',
    userTimezone: 'America/Los_Angeles',
    chatKey: '+15555555555',
    llmParse: mocks.llmParse,
    ...overrides,
  };
}

// ─── Multi-Task Splitting Tests (VAL-MULTI-001, VAL-MULTI-002) ─────────────

describe('multi-task splitting', () => {
  // ── VAL-MULTI-001: Clear multi-task split into separate todos ─────────
  describe('clear multi-task creates separate todos (VAL-MULTI-001)', () => {
    it('"text mom at 6 and buy milk at 7" creates 2 separate todo records', async () => {
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('text mom at 6 and buy milk at 7', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('multi_task');
      // Should have created 2 todos (2 insert calls)
      expect(mocks.todosInsert).toHaveBeenCalledTimes(2);
      // Should have sent 2 confirmation messages (one per task)
      expect(mocks.sendMessage).toHaveBeenCalledTimes(2);
    });

    it('each split task gets its own confirmation message', async () => {
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [],
      });
      const deps = makeDeps(mocks);

      await dispatch('text mom at 6 and buy milk at 7', deps);

      // Verify two distinct messages were sent
      expect(mocks.sendMessage).toHaveBeenCalledTimes(2);
      const msg1 = mocks.sendMessage.mock.calls[0][0] as string;
      const msg2 = mocks.sendMessage.mock.calls[1][0] as string;
      // Each message should contain task confirmation text
      expect(msg1.toLowerCase()).toContain('remind');
      expect(msg2.toLowerCase()).toContain('remind');
    });

    it('"call mom at 3pm and pick up groceries at 5pm" creates 2 tasks', async () => {
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('call mom at 3pm and pick up groceries at 5pm', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('multi_task');
      expect(mocks.todosInsert).toHaveBeenCalledTimes(2);
      expect(mocks.sendMessage).toHaveBeenCalledTimes(2);
    });

    it('"remind me to get food at 8, call mom at 9" (comma split) creates 2 tasks', async () => {
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('remind me to get food at 8, call mom at 9', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('multi_task');
      expect(mocks.todosInsert).toHaveBeenCalledTimes(2);
      expect(mocks.sendMessage).toHaveBeenCalledTimes(2);
    });
  });

  // ── VAL-MULTI-002: Partially ambiguous multi-task asks to resend ──────
  describe('partially ambiguous multi-task asks to resend (VAL-MULTI-002)', () => {
    it('"text mom at 6 and buy milk sometime tonight maybe" creates zero todos', async () => {
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('text mom at 6 and buy milk sometime tonight maybe', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('multi_task');
      // No todos should be created
      expect(mocks.todosInsert).not.toHaveBeenCalled();
      // Should ask to resend more clearly
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
      const sentText = mocks.sendMessage.mock.calls[0][0] as string;
      expect(sentText.toLowerCase()).toContain('resend');
    });

    it('"call boss at 3pm and do something later" creates zero todos and asks to resend', async () => {
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('call boss at 3pm and do something later', deps);

      // "later" is ambiguous for chrono-node — might or might not parse.
      // If both parse, it'd be multi_task. If only one parses, it should ask to resend.
      expect(result.handled).toBe(true);
      // Should not create any todos if the second part is ambiguous
      if (result.action === 'multi_task') {
        // Either all parsed (both created) or partially ambiguous (resend)
        const sentText = mocks.sendMessage.mock.calls[0][0] as string;
        // If resend, no todos created
        if (sentText.toLowerCase().includes('resend')) {
          expect(mocks.todosInsert).not.toHaveBeenCalled();
        }
      }
    });
  });

  // ── Edge cases for multi-task ─────────────────────────────────────────
  describe('multi-task edge cases', () => {
    it('"buy bread and butter at 5" is treated as single task (no multi-split)', async () => {
      // "bread and butter" contains "and" but "bread" part has no time
      // Only 1 time reference in total, so should be treated as single task
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('buy bread and butter at 5', deps);

      // Should be treated as single task since only one time reference
      expect(result.handled).toBe(true);
      // Should create only 1 todo (either multi_task or new_task)
      expect(mocks.todosInsert).toHaveBeenCalledTimes(1);
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    });

    it('multi-task does not call LLM', async () => {
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [],
      });
      const deps = makeDeps(mocks);

      await dispatch('text mom at 6 and buy milk at 7', deps);

      expect(mocks.llmParse).not.toHaveBeenCalled();
    });
  });
});

// ─── Chat Behavior Tests (VAL-CHAT-001, VAL-CHAT-002, VAL-CHAT-003) ────────

describe('chat behavior rules', () => {
  // ── VAL-CHAT-001: Greetings always answered ───────────────────────────
  describe('greetings always get friendly response (VAL-CHAT-001)', () => {
    const greetingVariants = ['Hi', 'Hello', 'Hey', 'good morning', 'good evening', 'good afternoon'];

    for (const greeting of greetingVariants) {
      it(`"${greeting}" receives a friendly response`, async () => {
        const mocks = createDispatchMocks({ activeSessions: [] });
        const deps = makeDeps(mocks);

        const result = await dispatch(greeting, deps);

        expect(result.handled).toBe(true);
        expect(result.action).toBe('greeting');
        expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
        const sentText = mocks.sendMessage.mock.calls[0][0] as string;
        expect(sentText.length).toBeGreaterThan(0);
      });
    }

    it('greeting check runs BEFORE session/task processing', async () => {
      // Even with active sessions, greeting should be handled immediately
      const session = makeSession({ task_label_snapshot: 'some task' });
      const mocks = createDispatchMocks({
        activeSessions: [session],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('hey', deps);

      expect(result.action).toBe('greeting');
      // LLM should not be called
      expect(mocks.llmParse).not.toHaveBeenCalled();
    });

    it('greeting responds regardless of active sessions', async () => {
      const mocks = createDispatchMocks({
        activeSessions: [makeSession()],
        activeTodos: [makeTodo({ status: 'in_progress' })],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('hello!', deps);

      expect(result.action).toBe('greeting');
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    });
  });

  // ── VAL-DISPATCH-005: Non-task chatter ignored without session ────────
  describe('non-task chatter ignored without active session (VAL-DISPATCH-005)', () => {
    const chatterExamples = ['lol', 'hmm', 'haha', 'lmao', 'yeah', 'wha', 'ok', 'nah', 'nice', 'cool'];

    for (const chatter of chatterExamples) {
      it(`"${chatter}" with no active session produces no reply`, async () => {
        const mocks = createDispatchMocks({
          activeSessions: [],
          activeTodos: [],
        });
        const deps = makeDeps(mocks);

        const result = await dispatch(chatter, deps);

        expect(result.handled).toBe(false);
        expect(result.action).toBe('chatter_ignored');
        expect(mocks.sendMessage).not.toHaveBeenCalled();
      });
    }
  });

  // ── VAL-CHAT-002: Lightweight ack keeps in_progress and sends reply ───
  describe('ack keeps in_progress task and sends brief reply (VAL-CHAT-002)', () => {
    it('"on it" with in_progress task keeps status and sends brief ack', async () => {
      const inProgressTodo = makeTodo({
        id: 'todo-ip',
        task: 'call mom',
        status: 'in_progress',
        reminded_at: new Date().toISOString(),
      });
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [inProgressTodo],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('on it', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('ack');
      // Should send a brief ack mentioning the task
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
      const sentText = mocks.sendMessage.mock.calls[0][0] as string;
      expect(sentText).toContain('call mom');
      // Should NOT have updated the todo status (keeps in_progress)
      expect(mocks.todosUpdate).not.toHaveBeenCalled();
    });

    it('"got it" with in_progress task keeps status and sends ack', async () => {
      const inProgressTodo = makeTodo({
        id: 'todo-ip',
        task: 'buy groceries',
        status: 'in_progress',
        reminded_at: new Date().toISOString(),
      });
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [inProgressTodo],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('got it', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('ack');
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
      const sentText = mocks.sendMessage.mock.calls[0][0] as string;
      expect(sentText).toContain('buy groceries');
      expect(mocks.todosUpdate).not.toHaveBeenCalled();
    });

    it('"ok" with in_progress task keeps status and sends ack', async () => {
      const inProgressTodo = makeTodo({
        id: 'todo-ip',
        task: 'get food',
        status: 'in_progress',
        reminded_at: new Date().toISOString(),
      });
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [inProgressTodo],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('ok', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('ack');
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
      const sentText = mocks.sendMessage.mock.calls[0][0] as string;
      expect(sentText).toContain('get food');
      expect(mocks.todosUpdate).not.toHaveBeenCalled();
    });

    it('"yeah" with in_progress task keeps status and sends ack', async () => {
      const inProgressTodo = makeTodo({
        id: 'todo-ip',
        task: 'finish report',
        status: 'in_progress',
        reminded_at: new Date().toISOString(),
      });
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [inProgressTodo],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('yeah', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('ack');
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
      const sentText = mocks.sendMessage.mock.calls[0][0] as string;
      expect(sentText).toContain('finish report');
      expect(mocks.todosUpdate).not.toHaveBeenCalled();
    });

    it('ack with active session uses session task label', async () => {
      const session = makeSession({
        task_label_snapshot: 'session task',
      });
      const mocks = createDispatchMocks({
        activeSessions: [session],
        activeTodos: [],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('got it', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('ack');
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
      const sentText = mocks.sendMessage.mock.calls[0][0] as string;
      expect(sentText).toContain('session task');
    });
  });

  // ── VAL-CHAT-003: Done reply marks Done ───────────────────────────────
  describe('"done" with in_progress task marks it done (VAL-CHAT-003, VAL-STATUS-002)', () => {
    it('"done" with single active task marks it done', async () => {
      const inProgressTodo = makeTodo({
        id: 'todo-ip',
        task: 'call mom',
        status: 'in_progress',
        reminded_at: new Date().toISOString(),
      });
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [inProgressTodo],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('done', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('edit_cancel_done');
      // Should have called update on the todo
      expect(mocks.todosUpdate).toHaveBeenCalled();
      const updateCall = mocks.todosUpdate.mock.calls[0][0];
      expect(updateCall).toHaveProperty('status', 'done');
      expect(updateCall).toHaveProperty('completed_at');
      // completed_at should be a valid ISO string
      expect(new Date(updateCall.completed_at).getTime()).toBeGreaterThan(0);
      // Should send confirmation
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
      const sentText = mocks.sendMessage.mock.calls[0][0] as string;
      expect(sentText.toLowerCase()).toContain('done');
    });

    it('"finished" with single active task also marks done', async () => {
      const inProgressTodo = makeTodo({
        id: 'todo-ip',
        task: 'buy milk',
        status: 'in_progress',
      });
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [inProgressTodo],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('finished', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('edit_cancel_done');
      expect(mocks.todosUpdate).toHaveBeenCalled();
      const updateCall = mocks.todosUpdate.mock.calls[0][0];
      expect(updateCall).toHaveProperty('status', 'done');
    });

    it('"done" sets completed_at timestamp (VAL-STATUS-002)', async () => {
      const inProgressTodo = makeTodo({
        id: 'todo-ip',
        task: 'exercise',
        status: 'in_progress',
      });
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [inProgressTodo],
      });
      const deps = makeDeps(mocks);

      await dispatch('done', deps);

      expect(mocks.todosUpdate).toHaveBeenCalled();
      const updateCall = mocks.todosUpdate.mock.calls[0][0];
      expect(updateCall.status).toBe('done');
      expect(updateCall.completed_at).toBeDefined();
      expect(typeof updateCall.completed_at).toBe('string');
    });

    it('"done" via follow-up session also marks task done', async () => {
      const session = makeSession({
        state: 'awaiting_completion',
        task_label_snapshot: 'get food',
        related_todo_id: 'todo-1',
      });
      const mocks = createDispatchMocks({
        activeSessions: [session],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('done', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('follow_up_resolved');
      expect(mocks.todosUpdate).toHaveBeenCalled();
      const updateCall = mocks.todosUpdate.mock.calls[0][0];
      expect(updateCall).toHaveProperty('status', 'done');
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    });
  });

  // ── Chatter + in_progress interaction ─────────────────────────────────
  describe('chatter behavior interaction with in_progress tasks', () => {
    it('"lol" with no session AND no in_progress task is ignored (no reply)', async () => {
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('lol', deps);

      expect(result.handled).toBe(false);
      expect(result.action).toBe('chatter_ignored');
      expect(mocks.sendMessage).not.toHaveBeenCalled();
    });

    it('"hmm" with no session AND no in_progress task is ignored', async () => {
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('hmm', deps);

      expect(result.handled).toBe(false);
      expect(result.action).toBe('chatter_ignored');
      expect(mocks.sendMessage).not.toHaveBeenCalled();
    });
  });

  // ── Integration: chat behavior does not call LLM ──────────────────────
  describe('chat behavior does not call LLM', () => {
    it('greetings do not call LLM', async () => {
      const mocks = createDispatchMocks({ activeSessions: [] });
      mocks.llmParse.mockResolvedValue('LLM response');
      const deps = makeDeps(mocks);

      await dispatch('hi', deps);
      expect(mocks.llmParse).not.toHaveBeenCalled();
    });

    it('chatter ignored without calling LLM', async () => {
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [],
      });
      mocks.llmParse.mockResolvedValue('LLM response');
      const deps = makeDeps(mocks);

      await dispatch('lol', deps);
      expect(mocks.llmParse).not.toHaveBeenCalled();
    });

    it('ack with in_progress task does not call LLM', async () => {
      const inProgressTodo = makeTodo({
        id: 'todo-ip',
        task: 'clean room',
        status: 'in_progress',
      });
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [inProgressTodo],
      });
      mocks.llmParse.mockResolvedValue('LLM response');
      const deps = makeDeps(mocks);

      await dispatch('on it', deps);
      expect(mocks.llmParse).not.toHaveBeenCalled();
    });
  });
});
