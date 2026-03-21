import { describe, it, expect, vi } from 'vitest';
import { dispatch, _testExports, type DispatcherDeps } from '../dispatcher.js';
import type { ConversationSession, Todo, SessionState } from '../types.js';

const { matchDisambiguationReply } = _testExports;

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
    related_todo_id: null,
    state: 'awaiting_edit_target' as SessionState,
    task_label_snapshot: 'cancel',
    candidate_todo_ids: ['todo-1', 'todo-2'],
    prompt_type: '',
    last_inbound_at: new Date().toISOString(),
    last_outbound_at: new Date().toISOString(),
    resolved_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Creates mock Supabase client for disambiguation flow tests.
 *
 * This mock handles the full follow-up pipeline:
 * - message_logs insert (persist inbound log)
 * - conversation_sessions select + insert + update (session management)
 * - todos select + update (task operations)
 */
function createDisambiguationMocks(options: {
  activeSessions?: ConversationSession[];
  activeTodos?: Todo[];
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
        data: makeSession(),
        error: null,
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: makeSession(), error: null }),
      }),
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

  const todosUpdate = vi.fn().mockReturnValue({
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
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockReturnValue({
              data: makeTodo(),
              error: null,
              then: (resolve: (v: unknown) => void) =>
                resolve({ data: makeTodo(), error: null }),
            }),
          }),
        }),
        update: todosUpdate,
      };
    }
    return {
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnValue({ data: null, error: null }),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    };
  });

  const client = { from: mockFrom } as any;

  return {
    client,
    sendMessage,
    llmParse,
    mockFrom,
    todosUpdate,
    sessionsUpdate,
  };
}

function makeDeps(
  mocks: ReturnType<typeof createDisambiguationMocks>,
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

// ─── matchDisambiguationReply unit tests ────────────────────────────────────

describe('matchDisambiguationReply', () => {
  const candidates = [
    makeTodo({ id: 'todo-1', task: 'get food' }),
    makeTodo({ id: 'todo-2', task: 'call mom' }),
    makeTodo({ id: 'todo-3', task: 'buy groceries' }),
  ];

  describe('number matching', () => {
    it('should match "1" to the first candidate', () => {
      const result = matchDisambiguationReply('1', candidates);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('todo-1');
      expect(result!.task).toBe('get food');
    });

    it('should match "2" to the second candidate', () => {
      const result = matchDisambiguationReply('2', candidates);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('todo-2');
      expect(result!.task).toBe('call mom');
    });

    it('should match "3" to the third candidate', () => {
      const result = matchDisambiguationReply('3', candidates);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('todo-3');
      expect(result!.task).toBe('buy groceries');
    });

    it('should return null for number out of range', () => {
      const result = matchDisambiguationReply('4', candidates);
      expect(result).toBeNull();
    });

    it('should return null for "0"', () => {
      const result = matchDisambiguationReply('0', candidates);
      expect(result).toBeNull();
    });

    it('should handle number with whitespace', () => {
      const result = matchDisambiguationReply('  2  ', candidates);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('todo-2');
    });
  });

  describe('exact name matching', () => {
    it('should match exact task name (case-insensitive)', () => {
      const result = matchDisambiguationReply('get food', candidates);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('todo-1');
    });

    it('should match exact task name with different casing', () => {
      const result = matchDisambiguationReply('Call Mom', candidates);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('todo-2');
    });

    it('should match exact task name "buy groceries"', () => {
      const result = matchDisambiguationReply('buy groceries', candidates);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('todo-3');
    });
  });

  describe('fuzzy/partial matching', () => {
    it('should match partial task name "food"', () => {
      const result = matchDisambiguationReply('food', candidates);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('todo-1');
    });

    it('should match partial task name "mom"', () => {
      const result = matchDisambiguationReply('mom', candidates);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('todo-2');
    });

    it('should match partial task name "groceries"', () => {
      const result = matchDisambiguationReply('groceries', candidates);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('todo-3');
    });

    it('should return null when partial match is ambiguous', () => {
      // "get" appears in "get food" but if we had "get milk" it would be ambiguous
      // With current candidates, "call" only matches "call mom"
      const ambiguousCandidates = [
        makeTodo({ id: 'todo-1', task: 'get food' }),
        makeTodo({ id: 'todo-2', task: 'get milk' }),
      ];
      const result = matchDisambiguationReply('get', ambiguousCandidates);
      expect(result).toBeNull();
    });
  });

  describe('no match', () => {
    it('should return null for completely unrelated text', () => {
      const result = matchDisambiguationReply('something random', candidates);
      expect(result).toBeNull();
    });

    it('should return null for empty string', () => {
      const result = matchDisambiguationReply('', candidates);
      expect(result).toBeNull();
    });
  });
});

// ─── Full disambiguation flow integration tests ─────────────────────────────

describe('disambiguation follow-up flow', () => {
  const todo1 = makeTodo({ id: 'todo-1', task: 'get food' });
  const todo2 = makeTodo({ id: 'todo-2', task: 'call mom' });

  describe('cancel disambiguation: ambiguous cancel → prompt → user picks task → cancel applied', () => {
    it('Step 1: "cancel that" with 2 tasks triggers disambiguation', async () => {
      const mocks = createDisambiguationMocks({
        activeSessions: [],
        activeTodos: [todo1, todo2],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('cancel that', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('edit_cancel_done');

      // Should send disambiguation prompt listing both tasks
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
      const sentText = mocks.sendMessage.mock.calls[0][0] as string;
      expect(sentText.toLowerCase()).toContain('which task');
      expect(sentText).toContain('get food');
      expect(sentText).toContain('call mom');
      expect(sentText).toContain('1.');
      expect(sentText).toContain('2.');
    });

    it('Step 2: user replies "1" → cancels the first task (get food)', async () => {
      // Simulate: session exists with awaiting_edit_target + cancel
      const session = makeSession({
        state: 'awaiting_edit_target',
        task_label_snapshot: 'cancel',
        candidate_todo_ids: ['todo-1', 'todo-2'],
      });
      const mocks = createDisambiguationMocks({
        activeSessions: [session],
        activeTodos: [todo1, todo2],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('1', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('follow_up_resolved');

      // Should have canceled the first task
      expect(mocks.todosUpdate).toHaveBeenCalled();
      const updateCall = mocks.todosUpdate.mock.calls[0][0];
      expect(updateCall).toHaveProperty('status', 'canceled');
      expect(updateCall).toHaveProperty('canceled_at');

      // Should confirm cancellation with task name
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
      const sentText = mocks.sendMessage.mock.calls[0][0] as string;
      expect(sentText).toContain('get food');
      expect(sentText.toLowerCase()).toContain('canceled');

      // Should resolve the session
      expect(mocks.sessionsUpdate).toHaveBeenCalled();
    });

    it('Step 2 alt: user replies "2" → cancels the second task (call mom)', async () => {
      const session = makeSession({
        state: 'awaiting_edit_target',
        task_label_snapshot: 'cancel',
        candidate_todo_ids: ['todo-1', 'todo-2'],
      });
      const mocks = createDisambiguationMocks({
        activeSessions: [session],
        activeTodos: [todo1, todo2],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('2', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('follow_up_resolved');

      // Should confirm cancellation with second task name
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
      const sentText = mocks.sendMessage.mock.calls[0][0] as string;
      expect(sentText).toContain('call mom');
      expect(sentText.toLowerCase()).toContain('canceled');
    });

    it('Step 2 alt: user replies "get food" (name match) → cancels get food', async () => {
      const session = makeSession({
        state: 'awaiting_edit_target',
        task_label_snapshot: 'cancel',
        candidate_todo_ids: ['todo-1', 'todo-2'],
      });
      const mocks = createDisambiguationMocks({
        activeSessions: [session],
        activeTodos: [todo1, todo2],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('get food', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('follow_up_resolved');

      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
      const sentText = mocks.sendMessage.mock.calls[0][0] as string;
      expect(sentText).toContain('get food');
      expect(sentText.toLowerCase()).toContain('canceled');
    });

    it('Step 2 alt: user replies "food" (fuzzy match) → cancels get food', async () => {
      const session = makeSession({
        state: 'awaiting_edit_target',
        task_label_snapshot: 'cancel',
        candidate_todo_ids: ['todo-1', 'todo-2'],
      });
      const mocks = createDisambiguationMocks({
        activeSessions: [session],
        activeTodos: [todo1, todo2],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('food', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('follow_up_resolved');

      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
      const sentText = mocks.sendMessage.mock.calls[0][0] as string;
      expect(sentText).toContain('get food');
      expect(sentText.toLowerCase()).toContain('canceled');
    });
  });

  describe('edit disambiguation: ambiguous edit → prompt → user picks task → edit applied', () => {
    it('Step 1: "make that 9" with 2 tasks triggers disambiguation', async () => {
      const mocks = createDisambiguationMocks({
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
      expect(sentText).toContain('get food');
      expect(sentText).toContain('call mom');
    });

    it('Step 2: user replies "1" → edits first task due_at to 9 PM', async () => {
      // Session with task_label_snapshot = '9' (the time text from "make that 9")
      const session = makeSession({
        state: 'awaiting_edit_target',
        task_label_snapshot: '9',
        candidate_todo_ids: ['todo-1', 'todo-2'],
      });
      const mocks = createDisambiguationMocks({
        activeSessions: [session],
        activeTodos: [todo1, todo2],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('1', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('follow_up_resolved');

      // Should have updated the todo's due_at
      expect(mocks.todosUpdate).toHaveBeenCalled();
      const updateCall = mocks.todosUpdate.mock.calls[0][0];
      expect(updateCall).toHaveProperty('due_at');
      expect(updateCall).toHaveProperty('remind_at');
      expect(updateCall).toHaveProperty('status', 'pending');

      // Should confirm the update with task name
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
      const sentText = mocks.sendMessage.mock.calls[0][0] as string;
      expect(sentText).toContain('get food');
      expect(sentText.toLowerCase()).toContain('updated');
    });

    it('Step 2: user replies "call mom" → edits second task due_at', async () => {
      const session = makeSession({
        state: 'awaiting_edit_target',
        task_label_snapshot: '9',
        candidate_todo_ids: ['todo-1', 'todo-2'],
      });
      const mocks = createDisambiguationMocks({
        activeSessions: [session],
        activeTodos: [todo1, todo2],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('call mom', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('follow_up_resolved');

      // Should confirm the update with task name
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
      const sentText = mocks.sendMessage.mock.calls[0][0] as string;
      expect(sentText).toContain('call mom');
      expect(sentText.toLowerCase()).toContain('updated');
    });

    it('"change it to 5pm" disambiguation + user picks "2" → updates second task to 5pm', async () => {
      const session = makeSession({
        state: 'awaiting_edit_target',
        task_label_snapshot: '5pm',
        candidate_todo_ids: ['todo-1', 'todo-2'],
      });
      const mocks = createDisambiguationMocks({
        activeSessions: [session],
        activeTodos: [todo1, todo2],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('2', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('follow_up_resolved');

      expect(mocks.todosUpdate).toHaveBeenCalled();
      const updateCall = mocks.todosUpdate.mock.calls[0][0];
      expect(updateCall).toHaveProperty('due_at');

      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
      const sentText = mocks.sendMessage.mock.calls[0][0] as string;
      expect(sentText).toContain('call mom');
      expect(sentText.toLowerCase()).toContain('updated');
    });
  });

  describe('done disambiguation: ambiguous done → prompt → user picks task → done applied', () => {
    it('Step 1: "done" with multiple active tasks triggers disambiguation', async () => {
      const mocks = createDisambiguationMocks({
        activeSessions: [],
        activeTodos: [todo1, todo2],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('done', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('edit_cancel_done');

      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
      const sentText = mocks.sendMessage.mock.calls[0][0] as string;
      expect(sentText.toLowerCase()).toContain('which task');
    });

    it('Step 2: user replies "1" to done disambiguation → marks first task done', async () => {
      const session = makeSession({
        state: 'awaiting_edit_target',
        task_label_snapshot: 'done',
        candidate_todo_ids: ['todo-1', 'todo-2'],
      });
      const mocks = createDisambiguationMocks({
        activeSessions: [session],
        activeTodos: [todo1, todo2],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('1', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('follow_up_resolved');

      // Should mark as done
      expect(mocks.todosUpdate).toHaveBeenCalled();
      const updateCall = mocks.todosUpdate.mock.calls[0][0];
      expect(updateCall).toHaveProperty('status', 'done');
      expect(updateCall).toHaveProperty('completed_at');

      // Confirmation message
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
      const sentText = mocks.sendMessage.mock.calls[0][0] as string;
      expect(sentText).toContain('get food');
      expect(sentText.toLowerCase()).toContain('done');
    });
  });

  describe('still ambiguous reply → re-asks disambiguation', () => {
    it('unrecognized reply re-asks with task list', async () => {
      const session = makeSession({
        state: 'awaiting_edit_target',
        task_label_snapshot: 'cancel',
        candidate_todo_ids: ['todo-1', 'todo-2'],
      });
      const mocks = createDisambiguationMocks({
        activeSessions: [session],
        activeTodos: [todo1, todo2],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('something random', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('follow_up_resolved');

      // Should re-ask disambiguation
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
      const sentText = mocks.sendMessage.mock.calls[0][0] as string;
      expect(sentText.toLowerCase()).toContain('which task');
      expect(sentText).toContain('get food');
      expect(sentText).toContain('call mom');
    });

    it('number out of range re-asks disambiguation', async () => {
      const session = makeSession({
        state: 'awaiting_edit_target',
        task_label_snapshot: 'cancel',
        candidate_todo_ids: ['todo-1', 'todo-2'],
      });
      const mocks = createDisambiguationMocks({
        activeSessions: [session],
        activeTodos: [todo1, todo2],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('5', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('follow_up_resolved');

      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
      const sentText = mocks.sendMessage.mock.calls[0][0] as string;
      expect(sentText.toLowerCase()).toContain('which task');
    });
  });

  describe('edge cases', () => {
    it('disambiguation with no remaining active tasks responds with no active tasks', async () => {
      const session = makeSession({
        state: 'awaiting_edit_target',
        task_label_snapshot: 'cancel',
        candidate_todo_ids: ['todo-1', 'todo-2'],
      });
      const mocks = createDisambiguationMocks({
        activeSessions: [session],
        activeTodos: [], // All tasks were resolved between disambiguation and reply
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('1', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('follow_up_resolved');

      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
      const sentText = mocks.sendMessage.mock.calls[0][0] as string;
      expect(sentText.toLowerCase()).toContain("don't have any active");
    });

    it('disambiguation session without candidate_todo_ids falls back to active todos', async () => {
      const session = makeSession({
        state: 'awaiting_edit_target',
        task_label_snapshot: 'cancel',
        candidate_todo_ids: null, // No stored candidates
      });
      const mocks = createDisambiguationMocks({
        activeSessions: [session],
        activeTodos: [todo1, todo2],
      });
      const deps = makeDeps(mocks);

      const result = await dispatch('1', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('follow_up_resolved');

      // Should still work using the first active todo
      expect(mocks.todosUpdate).toHaveBeenCalled();
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
      const sentText = mocks.sendMessage.mock.calls[0][0] as string;
      expect(sentText).toContain('get food');
      expect(sentText.toLowerCase()).toContain('canceled');
    });

    it('disambiguation does not call LLM', async () => {
      const session = makeSession({
        state: 'awaiting_edit_target',
        task_label_snapshot: 'cancel',
        candidate_todo_ids: ['todo-1', 'todo-2'],
      });
      const mocks = createDisambiguationMocks({
        activeSessions: [session],
        activeTodos: [todo1, todo2],
      });
      const deps = makeDeps(mocks);

      await dispatch('1', deps);
      expect(mocks.llmParse).not.toHaveBeenCalled();
    });
  });

  describe('resolveSession ordering: action before session resolution', () => {
    it('cancel: DB action executes before resolveSession', async () => {
      const callOrder: string[] = [];
      const session = makeSession({
        state: 'awaiting_edit_target',
        task_label_snapshot: 'cancel',
        candidate_todo_ids: ['todo-1', 'todo-2'],
      });

      const sendMessage = vi.fn().mockResolvedValue(undefined);
      const llmParse = vi.fn().mockResolvedValue(null);

      const mockFrom = vi.fn().mockImplementation((table: string) => {
        if (table === 'message_logs') {
          return {
            insert: vi.fn().mockReturnValue({ data: null, error: null }),
          };
        }
        if (table === 'conversation_sessions') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    data: [session],
                    error: null,
                  }),
                }),
              }),
            }),
            update: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
              if (payload.resolved_at) {
                callOrder.push('resolveSession');
              }
              return {
                eq: vi.fn().mockReturnValue({ data: null, error: null }),
              };
            }),
          };
        }
        if (table === 'todos') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    data: [todo1, todo2],
                    error: null,
                  }),
                }),
              }),
            }),
            update: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
              if (payload.status === 'canceled') {
                callOrder.push('markTodoCanceled');
              }
              return {
                eq: vi.fn().mockReturnValue({ data: null, error: null }),
              };
            }),
          };
        }
        return { select: vi.fn().mockReturnThis() };
      });

      const deps: DispatcherDeps = {
        supabase: { from: mockFrom } as any,
        sendMessage,
        userId: 'user-1',
        userTimezone: 'America/Los_Angeles',
        chatKey: '+15555555555',
        llmParse,
      };

      await dispatch('1', deps);

      expect(callOrder).toEqual(['markTodoCanceled', 'resolveSession']);
    });

    it('done: DB action executes before resolveSession', async () => {
      const callOrder: string[] = [];
      const session = makeSession({
        state: 'awaiting_edit_target',
        task_label_snapshot: 'done',
        candidate_todo_ids: ['todo-1', 'todo-2'],
      });

      const sendMessage = vi.fn().mockResolvedValue(undefined);
      const llmParse = vi.fn().mockResolvedValue(null);

      const mockFrom = vi.fn().mockImplementation((table: string) => {
        if (table === 'message_logs') {
          return {
            insert: vi.fn().mockReturnValue({ data: null, error: null }),
          };
        }
        if (table === 'conversation_sessions') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    data: [session],
                    error: null,
                  }),
                }),
              }),
            }),
            update: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
              if (payload.resolved_at) {
                callOrder.push('resolveSession');
              }
              return {
                eq: vi.fn().mockReturnValue({ data: null, error: null }),
              };
            }),
          };
        }
        if (table === 'todos') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    data: [todo1, todo2],
                    error: null,
                  }),
                }),
              }),
            }),
            update: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
              if (payload.status === 'done') {
                callOrder.push('markTodoDone');
              }
              return {
                eq: vi.fn().mockReturnValue({ data: null, error: null }),
              };
            }),
          };
        }
        return { select: vi.fn().mockReturnThis() };
      });

      const deps: DispatcherDeps = {
        supabase: { from: mockFrom } as any,
        sendMessage,
        userId: 'user-1',
        userTimezone: 'America/Los_Angeles',
        chatKey: '+15555555555',
        llmParse,
      };

      await dispatch('1', deps);

      expect(callOrder).toEqual(['markTodoDone', 'resolveSession']);
    });

    it('edit (time update): DB action executes before resolveSession', async () => {
      const callOrder: string[] = [];
      const session = makeSession({
        state: 'awaiting_edit_target',
        task_label_snapshot: '9pm',
        candidate_todo_ids: ['todo-1', 'todo-2'],
      });

      const sendMessage = vi.fn().mockResolvedValue(undefined);
      const llmParse = vi.fn().mockResolvedValue(null);

      const mockFrom = vi.fn().mockImplementation((table: string) => {
        if (table === 'message_logs') {
          return {
            insert: vi.fn().mockReturnValue({ data: null, error: null }),
          };
        }
        if (table === 'conversation_sessions') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    data: [session],
                    error: null,
                  }),
                }),
              }),
            }),
            update: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
              if (payload.resolved_at) {
                callOrder.push('resolveSession');
              }
              return {
                eq: vi.fn().mockReturnValue({ data: null, error: null }),
              };
            }),
          };
        }
        if (table === 'todos') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    data: [todo1, todo2],
                    error: null,
                  }),
                }),
              }),
            }),
            update: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
              if (payload.due_at) {
                callOrder.push('updateTodoDueAt');
              }
              return {
                eq: vi.fn().mockReturnValue({ data: null, error: null }),
              };
            }),
          };
        }
        return { select: vi.fn().mockReturnThis() };
      });

      const deps: DispatcherDeps = {
        supabase: { from: mockFrom } as any,
        sendMessage,
        userId: 'user-1',
        userTimezone: 'America/Los_Angeles',
        chatKey: '+15555555555',
        llmParse,
      };

      await dispatch('1', deps);

      expect(callOrder).toEqual(['updateTodoDueAt', 'resolveSession']);
    });

    it('cancel: if DB action throws, session is NOT resolved (user can retry)', async () => {
      const session = makeSession({
        state: 'awaiting_edit_target',
        task_label_snapshot: 'cancel',
        candidate_todo_ids: ['todo-1', 'todo-2'],
      });

      const sendMessage = vi.fn().mockResolvedValue(undefined);
      let sessionResolved = false;

      const mockFrom = vi.fn().mockImplementation((table: string) => {
        if (table === 'message_logs') {
          return {
            insert: vi.fn().mockReturnValue({ data: null, error: null }),
          };
        }
        if (table === 'conversation_sessions') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    data: [session],
                    error: null,
                  }),
                }),
              }),
            }),
            update: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
              if (payload.resolved_at) {
                sessionResolved = true;
              }
              return {
                eq: vi.fn().mockReturnValue({ data: null, error: null }),
              };
            }),
          };
        }
        if (table === 'todos') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    data: [todo1, todo2],
                    error: null,
                  }),
                }),
              }),
            }),
            update: vi.fn().mockImplementation(() => {
              // Simulate DB error when trying to cancel the todo
              return {
                eq: vi.fn().mockImplementation(() => {
                  throw new Error('Database connection lost');
                }),
              };
            }),
          };
        }
        return { select: vi.fn().mockReturnThis() };
      });

      const deps: DispatcherDeps = {
        supabase: { from: mockFrom } as any,
        sendMessage,
        userId: 'user-1',
        userTimezone: 'America/Los_Angeles',
        chatKey: '+15555555555',
      };

      // The dispatch should throw because the DB action failed
      await expect(dispatch('1', deps)).rejects.toThrow('Database connection lost');

      // Crucially, the session must NOT have been resolved
      expect(sessionResolved).toBe(false);
    });

    it('done: if DB action throws, session is NOT resolved (user can retry)', async () => {
      const session = makeSession({
        state: 'awaiting_edit_target',
        task_label_snapshot: 'done',
        candidate_todo_ids: ['todo-1', 'todo-2'],
      });

      const sendMessage = vi.fn().mockResolvedValue(undefined);
      let sessionResolved = false;

      const mockFrom = vi.fn().mockImplementation((table: string) => {
        if (table === 'message_logs') {
          return {
            insert: vi.fn().mockReturnValue({ data: null, error: null }),
          };
        }
        if (table === 'conversation_sessions') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    data: [session],
                    error: null,
                  }),
                }),
              }),
            }),
            update: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
              if (payload.resolved_at) {
                sessionResolved = true;
              }
              return {
                eq: vi.fn().mockReturnValue({ data: null, error: null }),
              };
            }),
          };
        }
        if (table === 'todos') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    data: [todo1, todo2],
                    error: null,
                  }),
                }),
              }),
            }),
            update: vi.fn().mockImplementation(() => {
              // Simulate DB error when trying to mark done
              return {
                eq: vi.fn().mockImplementation(() => {
                  throw new Error('Database connection lost');
                }),
              };
            }),
          };
        }
        return { select: vi.fn().mockReturnThis() };
      });

      const deps: DispatcherDeps = {
        supabase: { from: mockFrom } as any,
        sendMessage,
        userId: 'user-1',
        userTimezone: 'America/Los_Angeles',
        chatKey: '+15555555555',
      };

      await expect(dispatch('1', deps)).rejects.toThrow('Database connection lost');
      expect(sessionResolved).toBe(false);
    });
  });
});
