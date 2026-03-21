import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dispatch, type DispatcherDeps } from '../dispatcher.js';
import type { ConversationSession, Todo, SessionState } from '../types.js';

// ─── Test helpers ───────────────────────────────────────────────────────────

function makeTodo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: 'todo-1',
    user_id: 'user-1',
    task: 'get food',
    due_at: '2026-03-21T21:00:00.000Z', // 9 PM UTC
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

  const todosInsert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockReturnValue({
        data: options.insertReturns ?? makeTodo(),
        error: null,
        then: (resolve: (v: unknown) => void) =>
          resolve({
            data: options.insertReturns ?? makeTodo(),
            error: null,
          }),
      }),
    }),
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

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('edit/cancel flows', () => {
  // ── VAL-EDIT-001: Time update via text ────────────────────────────────
  describe('time update with single active task (VAL-EDIT-001)', () => {
    it('"actually make that 9" updates due_at to 9 PM and recalculates remind_at', async () => {
      const todo = makeTodo({
        id: 'todo-1',
        task: 'get food',
        due_at: '2026-03-21T20:50:00.000Z',
      });
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [todo],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('actually make that 9', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('edit_cancel_done');
      // Should have called update on todos
      expect(mocks.todosUpdate).toHaveBeenCalled();
      // Should have sent a confirmation message
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
      const sentText = mocks.sendMessage.mock.calls[0][0] as string;
      expect(sentText.toLowerCase()).toContain('updated');
      expect(sentText).toContain('get food');
    });

    it('"change it to 5pm" updates due_at to 5 PM', async () => {
      const todo = makeTodo({
        id: 'todo-1',
        task: 'call mom',
        due_at: '2026-03-21T21:00:00.000Z',
      });
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [todo],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('change it to 5pm', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('edit_cancel_done');
      expect(mocks.todosUpdate).toHaveBeenCalled();
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
      const sentText = mocks.sendMessage.mock.calls[0][0] as string;
      expect(sentText.toLowerCase()).toContain('updated');
    });

    it('"make that 9" (without "actually") updates due_at', async () => {
      const todo = makeTodo({
        id: 'todo-1',
        task: 'get food',
      });
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [todo],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('make that 9', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('edit_cancel_done');
      expect(mocks.todosUpdate).toHaveBeenCalled();
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    });

    it('"reschedule to 5pm" updates due_at', async () => {
      const todo = makeTodo({
        id: 'todo-1',
        task: 'meeting',
        due_at: '2026-03-21T21:00:00.000Z',
      });
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [todo],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('reschedule to 5pm', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('edit_cancel_done');
      expect(mocks.todosUpdate).toHaveBeenCalled();
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
      const sentText = mocks.sendMessage.mock.calls[0][0] as string;
      expect(sentText.toLowerCase()).toContain('updated');
    });

    it('time update recalculates remind_at via updateTodoDueAt', async () => {
      const todo = makeTodo({
        id: 'todo-1',
        task: 'get food',
        due_at: '2026-03-21T21:00:00.000Z',
      });
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [todo],
      });
      const deps = makeDeps(mocks);

      await dispatch('change it to 5pm', deps);

      // Verify that the update call includes remind_at in addition to due_at
      expect(mocks.todosUpdate).toHaveBeenCalled();
      const updateCall = mocks.todosUpdate.mock.calls[0][0];
      expect(updateCall).toHaveProperty('due_at');
      expect(updateCall).toHaveProperty('remind_at');
      expect(updateCall).toHaveProperty('status', 'pending');
    });
  });

  // ── VAL-EDIT-002: Date update via text ("not today, tomorrow") ────────
  describe('date update "not today, tomorrow" (VAL-EDIT-002)', () => {
    it('"not today, tomorrow" shifts due_at to tomorrow at the same time', async () => {
      // Task is due today at 9 PM UTC
      const todo = makeTodo({
        id: 'todo-1',
        task: 'get food',
        due_at: '2026-03-21T21:00:00.000Z',
      });
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [todo],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('not today, tomorrow', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('edit_cancel_done');
      expect(mocks.todosUpdate).toHaveBeenCalled();

      // The update should shift by 24 hours
      const updateCall = mocks.todosUpdate.mock.calls[0][0];
      const newDueAt = new Date(updateCall.due_at);
      const originalDueAt = new Date('2026-03-21T21:00:00.000Z');
      // Should be exactly 24 hours later
      expect(newDueAt.getTime() - originalDueAt.getTime()).toBe(24 * 60 * 60 * 1000);

      // Confirm response mentions the task
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
      const sentText = mocks.sendMessage.mock.calls[0][0] as string;
      expect(sentText).toContain('get food');
      expect(sentText.toLowerCase()).toContain('updated');
    });

    it('"not today tomorrow" (without comma) also works', async () => {
      const todo = makeTodo({
        id: 'todo-1',
        task: 'buy milk',
        due_at: '2026-03-21T18:00:00.000Z',
      });
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [todo],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('not today tomorrow', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('edit_cancel_done');
      expect(mocks.todosUpdate).toHaveBeenCalled();

      // Verify the date shifted by exactly 24 hours
      const updateCall = mocks.todosUpdate.mock.calls[0][0];
      const newDueAt = new Date(updateCall.due_at);
      const originalDueAt = new Date('2026-03-21T18:00:00.000Z');
      expect(newDueAt.getTime() - originalDueAt.getTime()).toBe(24 * 60 * 60 * 1000);
    });

    it('"not today, tomorrow" also recalculates remind_at', async () => {
      const todo = makeTodo({
        id: 'todo-1',
        task: 'get food',
        due_at: '2026-03-21T21:00:00.000Z',
      });
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [todo],
      });
      const deps = makeDeps(mocks);

      await dispatch('not today, tomorrow', deps);

      const updateCall = mocks.todosUpdate.mock.calls[0][0];
      expect(updateCall).toHaveProperty('remind_at');
      expect(updateCall).toHaveProperty('status', 'pending');
    });
  });

  // ── VAL-EDIT-003: Cancel via text ─────────────────────────────────────
  describe('cancel with single active task (VAL-EDIT-003, VAL-STATUS-003)', () => {
    it('"cancel that" with one active task sets status=canceled and canceled_at', async () => {
      const todo = makeTodo({
        id: 'todo-1',
        task: 'get food',
        status: 'pending',
      });
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [todo],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('cancel that', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('edit_cancel_done');

      // Should have called update with canceled status and canceled_at
      expect(mocks.todosUpdate).toHaveBeenCalled();
      const updateCall = mocks.todosUpdate.mock.calls[0][0];
      expect(updateCall).toHaveProperty('status', 'canceled');
      expect(updateCall).toHaveProperty('canceled_at');
      // canceled_at should be a valid ISO string
      expect(new Date(updateCall.canceled_at).getTime()).toBeGreaterThan(0);

      // Should confirm the cancellation
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
      const sentText = mocks.sendMessage.mock.calls[0][0] as string;
      expect(sentText.toLowerCase()).toContain('canceled');
      expect(sentText).toContain('get food');
    });

    it('"cancel it" with one active task cancels the task', async () => {
      const todo = makeTodo({ id: 'todo-1', task: 'buy milk' });
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [todo],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('cancel it', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('edit_cancel_done');
      expect(mocks.todosUpdate).toHaveBeenCalled();
      const updateCall = mocks.todosUpdate.mock.calls[0][0];
      expect(updateCall).toHaveProperty('status', 'canceled');
    });

    it('"nevermind" cancels the single active task', async () => {
      const todo = makeTodo({ id: 'todo-1', task: 'call mom' });
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [todo],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('nevermind', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('edit_cancel_done');
      expect(mocks.todosUpdate).toHaveBeenCalled();
    });

    it('"cancel [task name]" cancels the matching task', async () => {
      const todo = makeTodo({ id: 'todo-1', task: 'get food' });
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [todo],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('cancel get food', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('edit_cancel_done');
      expect(mocks.todosUpdate).toHaveBeenCalled();
      const updateCall = mocks.todosUpdate.mock.calls[0][0];
      expect(updateCall).toHaveProperty('status', 'canceled');
    });

    it('canceled task stays in DB with canceled_at stamped (row persists)', async () => {
      // This test verifies that the dispatcher uses update (not delete)
      // to set status='canceled' and canceled_at, keeping the row in the DB
      const todo = makeTodo({ id: 'todo-1', task: 'get food' });
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [todo],
      });
      const deps = makeDeps(mocks);

      await dispatch('cancel that', deps);

      // Verify update was called, NOT delete
      expect(mocks.todosUpdate).toHaveBeenCalled();
      const updateCall = mocks.todosUpdate.mock.calls[0][0];
      expect(updateCall.status).toBe('canceled');
      expect(updateCall.canceled_at).toBeTruthy();

      // Verify no delete was called on todos
      const fromCalls = mocks.mockFrom.mock.calls;
      const todoCalls = fromCalls.filter((c: any[]) => c[0] === 'todos');
      for (const call of todoCalls) {
        const returnVal = mocks.mockFrom.mock.results[fromCalls.indexOf(call)].value;
        // Should not have a delete method called
        expect(returnVal.delete).toBeUndefined();
      }
    });
  });

  // ── VAL-EDIT-004: Ambiguous target triggers disambiguation ────────────
  describe('ambiguous edit target with multiple tasks (VAL-EDIT-004)', () => {
    it('"make that 9" with multiple active tasks triggers disambiguation', async () => {
      const todo1 = makeTodo({ id: 'todo-1', task: 'get food' });
      const todo2 = makeTodo({ id: 'todo-2', task: 'call mom' });
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [todo1, todo2],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('make that 9', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('edit_cancel_done');
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
      const sentText = mocks.sendMessage.mock.calls[0][0] as string;
      expect(sentText.toLowerCase()).toContain('which task');
      // Should list both tasks
      expect(sentText).toContain('get food');
      expect(sentText).toContain('call mom');
    });

    it('"cancel that" with multiple active tasks triggers disambiguation', async () => {
      const todo1 = makeTodo({ id: 'todo-1', task: 'get food' });
      const todo2 = makeTodo({ id: 'todo-2', task: 'call mom' });
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [todo1, todo2],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('cancel that', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('edit_cancel_done');
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
      const sentText = mocks.sendMessage.mock.calls[0][0] as string;
      expect(sentText.toLowerCase()).toContain('which task');
      expect(sentText).toContain('get food');
      expect(sentText).toContain('call mom');
    });

    it('"change it to 5pm" with multiple tasks triggers disambiguation', async () => {
      const todo1 = makeTodo({ id: 'todo-1', task: 'buy groceries' });
      const todo2 = makeTodo({ id: 'todo-2', task: 'doctor appointment' });
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [todo1, todo2],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('change it to 5pm', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('edit_cancel_done');
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
      const sentText = mocks.sendMessage.mock.calls[0][0] as string;
      expect(sentText.toLowerCase()).toContain('which task');
    });

    it('disambiguation creates a session with awaiting_edit_target state', async () => {
      const todo1 = makeTodo({ id: 'todo-1', task: 'get food' });
      const todo2 = makeTodo({ id: 'todo-2', task: 'call mom' });
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [todo1, todo2],
      });
      const deps = makeDeps(mocks);

      await dispatch('cancel that', deps);

      // Should have called insert on conversation_sessions to create
      // a disambiguation session
      expect(mocks.sessionsInsert).toHaveBeenCalled();
    });

    it('"reschedule to tomorrow" with multiple tasks triggers disambiguation', async () => {
      const todo1 = makeTodo({ id: 'todo-1', task: 'meeting' });
      const todo2 = makeTodo({ id: 'todo-2', task: 'dinner' });
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [todo1, todo2],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('reschedule to tomorrow', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('edit_cancel_done');
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
      const sentText = mocks.sendMessage.mock.calls[0][0] as string;
      expect(sentText.toLowerCase()).toContain('which task');
    });
  });

  // ── VAL-EDGE-002: Zero active tasks + edit/cancel attempt ─────────────
  describe('zero active tasks returns helpful error (VAL-EDGE-002)', () => {
    it('"cancel that" with zero active tasks returns helpful message', async () => {
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('cancel that', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('edit_cancel_done');
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
      const sentText = mocks.sendMessage.mock.calls[0][0] as string;
      expect(sentText.toLowerCase()).toContain("don't have any active");
    });

    it('"make that 9" with zero active tasks returns helpful message', async () => {
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('make that 9', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('edit_cancel_done');
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
      const sentText = mocks.sendMessage.mock.calls[0][0] as string;
      expect(sentText.toLowerCase()).toContain("don't have any active");
    });

    it('"change it to 5pm" with zero active tasks returns helpful message', async () => {
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('change it to 5pm', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('edit_cancel_done');
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
      const sentText = mocks.sendMessage.mock.calls[0][0] as string;
      expect(sentText.toLowerCase()).toContain("don't have any active");
    });

    it('"nevermind" with zero active tasks returns helpful message', async () => {
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('nevermind', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('edit_cancel_done');
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
      const sentText = mocks.sendMessage.mock.calls[0][0] as string;
      expect(sentText.toLowerCase()).toContain("don't have any active");
    });

    it('"reschedule to tomorrow" with zero active tasks returns helpful message', async () => {
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('reschedule to tomorrow', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('edit_cancel_done');
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
      const sentText = mocks.sendMessage.mock.calls[0][0] as string;
      expect(sentText.toLowerCase()).toContain("don't have any active");
    });

    it('"cancel get food" with zero active tasks returns helpful message', async () => {
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('cancel get food', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('edit_cancel_done');
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
      const sentText = mocks.sendMessage.mock.calls[0][0] as string;
      expect(sentText.toLowerCase()).toContain("don't have any active");
    });
  });

  // ── Pattern detection tests ───────────────────────────────────────────
  describe('pattern detection', () => {
    it('detects "actually make that 9" as an edit command', async () => {
      const todo = makeTodo({ id: 'todo-1', task: 'get food' });
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [todo],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('actually make that 9', deps);
      expect(result.action).toBe('edit_cancel_done');
    });

    it('detects "change it to 3pm" as an edit command', async () => {
      const todo = makeTodo({ id: 'todo-1', task: 'get food' });
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [todo],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('change it to 3pm', deps);
      expect(result.action).toBe('edit_cancel_done');
    });

    it('detects "not today, tomorrow" as an edit command', async () => {
      const todo = makeTodo({
        id: 'todo-1',
        task: 'get food',
        due_at: '2026-03-21T21:00:00.000Z',
      });
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [todo],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('not today, tomorrow', deps);
      expect(result.action).toBe('edit_cancel_done');
    });

    it('detects "reschedule to 5pm" as an edit command', async () => {
      const todo = makeTodo({ id: 'todo-1', task: 'get food' });
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [todo],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('reschedule to 5pm', deps);
      expect(result.action).toBe('edit_cancel_done');
    });

    it('detects "cancel that" as a cancel command', async () => {
      const todo = makeTodo({ id: 'todo-1', task: 'get food' });
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [todo],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('cancel that', deps);
      expect(result.action).toBe('edit_cancel_done');
    });

    it('detects "cancel [task name]" as a cancel command', async () => {
      const todo = makeTodo({ id: 'todo-1', task: 'buy groceries' });
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [todo],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('cancel buy groceries', deps);
      expect(result.action).toBe('edit_cancel_done');
    });
  });

  // ── Integration: edit does not call LLM ───────────────────────────────
  describe('edit/cancel commands do not call LLM', () => {
    it('"cancel that" does not invoke the LLM', async () => {
      const todo = makeTodo({ id: 'todo-1', task: 'get food' });
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [todo],
      });
      const deps = makeDeps(mocks);

      await dispatch('cancel that', deps);
      expect(mocks.llmParse).not.toHaveBeenCalled();
    });

    it('"make that 9" does not invoke the LLM', async () => {
      const todo = makeTodo({ id: 'todo-1', task: 'get food' });
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [todo],
      });
      const deps = makeDeps(mocks);

      await dispatch('make that 9', deps);
      expect(mocks.llmParse).not.toHaveBeenCalled();
    });

    it('"not today, tomorrow" does not invoke the LLM', async () => {
      const todo = makeTodo({
        id: 'todo-1',
        task: 'get food',
        due_at: '2026-03-21T21:00:00.000Z',
      });
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [todo],
      });
      const deps = makeDeps(mocks);

      await dispatch('not today, tomorrow', deps);
      expect(mocks.llmParse).not.toHaveBeenCalled();
    });
  });
});
