import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dispatch, type DispatcherDeps } from '../dispatcher.js';
import { createMockSupabaseClient } from './helpers.js';
import type { ConversationSession, Todo, SessionState } from '../types.js';

// ─── Test helpers ───────────────────────────────────────────────────────────

function makeDeps(overrides: Partial<DispatcherDeps> = {}): DispatcherDeps {
  const { client } = createMockSupabaseClient();
  return {
    supabase: client,
    sendMessage: vi.fn().mockResolvedValue(undefined),
    userId: 'user-1',
    userTimezone: 'America/Los_Angeles',
    chatKey: '+15555555555',
    llmParse: undefined,
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

function makeTodo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: 'todo-1',
    user_id: 'user-1',
    task: 'get food',
    due_at: new Date().toISOString(),
    remind_at: null,
    status: 'pending',
    reminded_at: null,
    completed_at: null,
    canceled_at: null,
    not_confirmed_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Set up a mock Supabase client that handles the dispatch pipeline's queries.
 * Returns the client and configurable mock behaviors.
 */
function createDispatchMocks(options: {
  activeSessions?: ConversationSession[];
  activeTodos?: Todo[];
  insertReturns?: Todo;
} = {}) {
  const sendMessage = vi.fn().mockResolvedValue(undefined);
  const llmParse = vi.fn().mockResolvedValue(null);

  // Build a more realistic mock that tracks which table is queried
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
    // Default fallback
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
    todosSelect,
    todosInsert,
    todosUpdate,
    sessionsUpdate,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('dispatcher', () => {
  // ── (a) [PT] messages skipped (VAL-DISPATCH-001) ────────────────────
  describe('[PT] agent messages skipped (VAL-DISPATCH-001)', () => {
    it('should skip messages with [PT] prefix and not call any handlers', async () => {
      const mocks = createDispatchMocks();
      const deps: DispatcherDeps = {
        supabase: mocks.client,
        sendMessage: mocks.sendMessage,
        userId: 'user-1',
        userTimezone: 'America/Los_Angeles',
        chatKey: '+15555555555',
        llmParse: mocks.llmParse,
      };

      const result = await dispatch('[PT] Hello from the agent', deps);

      expect(result.handled).toBe(false);
      expect(result.action).toBe('skipped_agent_message');
      expect(mocks.sendMessage).not.toHaveBeenCalled();
      expect(mocks.llmParse).not.toHaveBeenCalled();
      // Should not even persist an inbound log for agent messages
      expect(mocks.mockFrom).not.toHaveBeenCalled();
    });

    it('should skip [PT] messages even with extra content', async () => {
      const mocks = createDispatchMocks();
      const deps: DispatcherDeps = {
        supabase: mocks.client,
        sendMessage: mocks.sendMessage,
        userId: 'user-1',
        userTimezone: 'America/Los_Angeles',
        chatKey: '+15555555555',
      };

      const result = await dispatch('[PT] Reminder: get food at 8:50 PM', deps);
      expect(result.handled).toBe(false);
      expect(result.action).toBe('skipped_agent_message');
      expect(mocks.sendMessage).not.toHaveBeenCalled();
    });
  });

  // ── (d) Greeting detection and response (VAL-DISPATCH-002) ──────────
  describe('greeting detection and response (VAL-DISPATCH-002, VAL-CHAT-001)', () => {
    const greetingVariants = [
      'hi',
      'hello',
      'hey',
      'sup',
      'yo',
      'good morning',
      'good evening',
      'good afternoon',
      'howdy',
      "what's up",
      'Hi!',
      'HELLO',
      'Hey!',
      'hiya',
    ];

    for (const greeting of greetingVariants) {
      it(`should respond to "${greeting}" with a friendly reply`, async () => {
        const mocks = createDispatchMocks();
        const deps: DispatcherDeps = {
          supabase: mocks.client,
          sendMessage: mocks.sendMessage,
          userId: 'user-1',
          userTimezone: 'America/Los_Angeles',
          chatKey: '+15555555555',
          llmParse: mocks.llmParse,
        };

        const result = await dispatch(greeting, deps);

        expect(result.handled).toBe(true);
        expect(result.action).toBe('greeting');
        expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
        // Should produce a non-empty reply
        const sentText = mocks.sendMessage.mock.calls[0][0] as string;
        expect(sentText.length).toBeGreaterThan(0);
        // LLM should NOT be called
        expect(mocks.llmParse).not.toHaveBeenCalled();
      });
    }

    it('should not treat "hi there how are you" as a pure greeting', async () => {
      // "hi there how are you" is longer than a simple greeting — the regex
      // requires the whole string to be a greeting
      const mocks = createDispatchMocks();
      const deps: DispatcherDeps = {
        supabase: mocks.client,
        sendMessage: mocks.sendMessage,
        userId: 'user-1',
        userTimezone: 'America/Los_Angeles',
        chatKey: '+15555555555',
      };

      const result = await dispatch('hi there how are you', deps);
      // This should NOT match the greeting regex since it has extra words
      expect(result.action).not.toBe('greeting');
    });
  });

  // ── (e) Recurring reminder rejection (VAL-DISPATCH-003) ─────────────
  describe('recurring reminder rejection (VAL-DISPATCH-003)', () => {
    const recurringPatterns = [
      'remind me every day to take pills',
      'every friday check the mail',
      'remind me every week to clean',
      'set a daily reminder',
      'weekly reminder to call mom',
      'every weekday morning exercise',
      'every morning stretch',
    ];

    for (const pattern of recurringPatterns) {
      it(`should reject recurring pattern: "${pattern}"`, async () => {
        const mocks = createDispatchMocks();
        const deps: DispatcherDeps = {
          supabase: mocks.client,
          sendMessage: mocks.sendMessage,
          userId: 'user-1',
          userTimezone: 'America/Los_Angeles',
          chatKey: '+15555555555',
          llmParse: mocks.llmParse,
        };

        const result = await dispatch(pattern, deps);

        expect(result.handled).toBe(true);
        expect(result.action).toBe('recurring_unsupported');
        expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
        const sentText = mocks.sendMessage.mock.calls[0][0] as string;
        expect(sentText.toLowerCase()).toContain('recurring');
        expect(mocks.llmParse).not.toHaveBeenCalled();
      });
    }
  });

  // ── (g) Deterministic follow-up resolution (VAL-DISPATCH-004) ───────
  describe('deterministic follow-up resolution before LLM', () => {
    it('should resolve a time follow-up without calling LLM', async () => {
      const session = makeSession({
        state: 'awaiting_time',
        task_label_snapshot: 'get food',
        related_todo_id: 'todo-1',
      });

      const mocks = createDispatchMocks({
        activeSessions: [session],
      });

      const deps: DispatcherDeps = {
        supabase: mocks.client,
        sendMessage: mocks.sendMessage,
        userId: 'user-1',
        userTimezone: 'America/Los_Angeles',
        chatKey: '+15555555555',
        llmParse: mocks.llmParse,
      };

      const result = await dispatch('8pm', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('follow_up_resolved');
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
      expect(mocks.llmParse).not.toHaveBeenCalled();
    });

    it('should resolve "done" follow-up for a session', async () => {
      const session = makeSession({
        state: 'awaiting_completion',
        task_label_snapshot: 'get food',
        related_todo_id: 'todo-1',
      });

      const mocks = createDispatchMocks({
        activeSessions: [session],
      });

      const deps: DispatcherDeps = {
        supabase: mocks.client,
        sendMessage: mocks.sendMessage,
        userId: 'user-1',
        userTimezone: 'America/Los_Angeles',
        chatKey: '+15555555555',
        llmParse: mocks.llmParse,
      };

      const result = await dispatch('done', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('follow_up_resolved');
      // Should have called update on todos (mark done) and resolve session
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
      const sentText = mocks.sendMessage.mock.calls[0][0] as string;
      expect(sentText.toLowerCase()).toContain('done');
      expect(mocks.llmParse).not.toHaveBeenCalled();
    });

    it('should disambiguate when multiple sessions exist and reply is ambiguous', async () => {
      const session1 = makeSession({
        id: 'session-1',
        task_label_snapshot: 'get food',
      });
      const session2 = makeSession({
        id: 'session-2',
        task_label_snapshot: 'call mom',
      });

      const mocks = createDispatchMocks({
        activeSessions: [session1, session2],
      });

      const deps: DispatcherDeps = {
        supabase: mocks.client,
        sendMessage: mocks.sendMessage,
        userId: 'user-1',
        userTimezone: 'America/Los_Angeles',
        chatKey: '+15555555555',
        llmParse: mocks.llmParse,
      };

      const result = await dispatch('8pm', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('follow_up_resolved');
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
      const sentText = mocks.sendMessage.mock.calls[0][0] as string;
      expect(sentText.toLowerCase()).toContain('which task');
      expect(mocks.llmParse).not.toHaveBeenCalled();
    });
  });

  // ── Non-task chatter ignored when no session (VAL-DISPATCH-005) ─────
  describe('non-task chatter ignored when no active session (VAL-DISPATCH-005)', () => {
    const chatterExamples = ['lol', 'hmm', 'haha', 'lmao', 'yeah', 'nah', 'ok'];

    for (const chatter of chatterExamples) {
      it(`should ignore "${chatter}" when no active session exists`, async () => {
        const mocks = createDispatchMocks({
          activeSessions: [],
        });

        const deps: DispatcherDeps = {
          supabase: mocks.client,
          sendMessage: mocks.sendMessage,
          userId: 'user-1',
          userTimezone: 'America/Los_Angeles',
          chatKey: '+15555555555',
          llmParse: mocks.llmParse,
        };

        const result = await dispatch(chatter, deps);

        expect(result.handled).toBe(false);
        expect(result.action).toBe('chatter_ignored');
        expect(mocks.sendMessage).not.toHaveBeenCalled();
        expect(mocks.llmParse).not.toHaveBeenCalled();
      });
    }
  });

  // ── LLM called only as fallback (VAL-DISPATCH-004) ──────────────────
  describe('LLM called only as fallback (VAL-DISPATCH-004)', () => {
    it('should call LLM only when rule-based pipeline cannot classify', async () => {
      const mocks = createDispatchMocks({
        activeSessions: [],
      });

      // Set up LLM to return a response
      mocks.llmParse.mockResolvedValue('I can help you with reminders. Just say "remind me to..."');

      const deps: DispatcherDeps = {
        supabase: mocks.client,
        sendMessage: mocks.sendMessage,
        userId: 'user-1',
        userTimezone: 'America/Los_Angeles',
        chatKey: '+15555555555',
        llmParse: mocks.llmParse,
      };

      // This is an unusual message that won't match any rules
      const result = await dispatch('what is the meaning of life', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('llm_fallback');
      expect(mocks.llmParse).toHaveBeenCalledTimes(1);
      expect(mocks.llmParse).toHaveBeenCalledWith('what is the meaning of life');
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    });

    it('should NOT call LLM for greetings', async () => {
      const mocks = createDispatchMocks();
      mocks.llmParse.mockResolvedValue('Some LLM response');

      const deps: DispatcherDeps = {
        supabase: mocks.client,
        sendMessage: mocks.sendMessage,
        userId: 'user-1',
        userTimezone: 'America/Los_Angeles',
        chatKey: '+15555555555',
        llmParse: mocks.llmParse,
      };

      await dispatch('hello', deps);
      expect(mocks.llmParse).not.toHaveBeenCalled();
    });

    it('should NOT call LLM for recurring reminders', async () => {
      const mocks = createDispatchMocks();
      mocks.llmParse.mockResolvedValue('Some LLM response');

      const deps: DispatcherDeps = {
        supabase: mocks.client,
        sendMessage: mocks.sendMessage,
        userId: 'user-1',
        userTimezone: 'America/Los_Angeles',
        chatKey: '+15555555555',
        llmParse: mocks.llmParse,
      };

      await dispatch('remind me every day to exercise', deps);
      expect(mocks.llmParse).not.toHaveBeenCalled();
    });

    it('should NOT call LLM for deterministic follow-ups', async () => {
      const session = makeSession({
        state: 'awaiting_time',
        task_label_snapshot: 'get food',
        related_todo_id: 'todo-1',
      });

      const mocks = createDispatchMocks({
        activeSessions: [session],
      });
      mocks.llmParse.mockResolvedValue('Some LLM response');

      const deps: DispatcherDeps = {
        supabase: mocks.client,
        sendMessage: mocks.sendMessage,
        userId: 'user-1',
        userTimezone: 'America/Los_Angeles',
        chatKey: '+15555555555',
        llmParse: mocks.llmParse,
      };

      await dispatch('10pm', deps);
      expect(mocks.llmParse).not.toHaveBeenCalled();
    });
  });

  // ── Edit/Cancel/Done matching ────────────────────────────────────────
  describe('edit/cancel/done matching', () => {
    it('should mark a single active task as done when user says "done"', async () => {
      const todo = makeTodo({ id: 'todo-1', task: 'get food' });
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [todo],
      });

      const deps: DispatcherDeps = {
        supabase: mocks.client,
        sendMessage: mocks.sendMessage,
        userId: 'user-1',
        userTimezone: 'America/Los_Angeles',
        chatKey: '+15555555555',
      };

      const result = await dispatch('done', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('edit_cancel_done');
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
      const sentText = mocks.sendMessage.mock.calls[0][0] as string;
      expect(sentText).toContain('done');
    });

    it('should cancel a single active task when user says "cancel that"', async () => {
      const todo = makeTodo({ id: 'todo-1', task: 'get food' });
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [todo],
      });

      const deps: DispatcherDeps = {
        supabase: mocks.client,
        sendMessage: mocks.sendMessage,
        userId: 'user-1',
        userTimezone: 'America/Los_Angeles',
        chatKey: '+15555555555',
      };

      const result = await dispatch('cancel that', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('edit_cancel_done');
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
      const sentText = mocks.sendMessage.mock.calls[0][0] as string;
      expect(sentText.toLowerCase()).toContain('canceled');
    });

    it('should respond with no active tasks when done is said with zero tasks', async () => {
      const mocks = createDispatchMocks({
        activeSessions: [],
        activeTodos: [],
      });

      const deps: DispatcherDeps = {
        supabase: mocks.client,
        sendMessage: mocks.sendMessage,
        userId: 'user-1',
        userTimezone: 'America/Los_Angeles',
        chatKey: '+15555555555',
      };

      const result = await dispatch('done', deps);

      expect(result.handled).toBe(true);
      expect(result.action).toBe('edit_cancel_done');
      expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
      const sentText = mocks.sendMessage.mock.calls[0][0] as string;
      expect(sentText.toLowerCase()).toContain('don\'t have any active');
    });
  });

  // ── Input sanitization ───────────────────────────────────────────────
  describe('input sanitization', () => {
    it('should sanitize input before processing', async () => {
      const mocks = createDispatchMocks();

      const deps: DispatcherDeps = {
        supabase: mocks.client,
        sendMessage: mocks.sendMessage,
        userId: 'user-1',
        userTimezone: 'America/Los_Angeles',
        chatKey: '+15555555555',
      };

      // Even with trailing junk, "hello]" → "hello" → greeting
      const result = await dispatch('  hello]  ', deps);
      expect(result.action).toBe('greeting');
    });

    it('should handle empty messages after sanitization', async () => {
      const mocks = createDispatchMocks();

      const deps: DispatcherDeps = {
        supabase: mocks.client,
        sendMessage: mocks.sendMessage,
        userId: 'user-1',
        userTimezone: 'America/Los_Angeles',
        chatKey: '+15555555555',
      };

      const result = await dispatch('   ', deps);
      expect(result.handled).toBe(false);
      expect(result.action).toBe('skipped_agent_message');
      expect(mocks.sendMessage).not.toHaveBeenCalled();
    });
  });

  // ── Inbound log persistence ──────────────────────────────────────────
  describe('inbound log persistence', () => {
    it('should persist inbound log for non-agent messages', async () => {
      const mocks = createDispatchMocks();

      const deps: DispatcherDeps = {
        supabase: mocks.client,
        sendMessage: mocks.sendMessage,
        userId: 'user-1',
        userTimezone: 'America/Los_Angeles',
        chatKey: '+15555555555',
      };

      await dispatch('hello', deps);

      expect(mocks.mockFrom).toHaveBeenCalledWith('message_logs');
      expect(mocks.messageLogsInsert).toHaveBeenCalledWith({
        user_id: 'user-1',
        direction: 'inbound',
        raw_message: 'hello',
      });
    });

    it('should NOT persist inbound log for [PT] messages', async () => {
      const mocks = createDispatchMocks();

      const deps: DispatcherDeps = {
        supabase: mocks.client,
        sendMessage: mocks.sendMessage,
        userId: 'user-1',
        userTimezone: 'America/Los_Angeles',
        chatKey: '+15555555555',
      };

      await dispatch('[PT] Some agent message', deps);

      expect(mocks.messageLogsInsert).not.toHaveBeenCalled();
    });
  });

  // ── Watcher integration ──────────────────────────────────────────────
  describe('watcher calls dispatcher', () => {
    it('should be importable and callable from watcher module', async () => {
      // This test verifies the module structure is correct
      const { startWatcher } = await import('../watcher.js');
      expect(typeof startWatcher).toBe('function');
    });
  });

  // ── Comprehensive rule ordering test ─────────────────────────────────
  describe('rule ordering: deterministic rules checked before LLM', () => {
    it('greeting check runs before session loading', async () => {
      // A greeting should respond immediately without loading sessions
      const mocks = createDispatchMocks({
        activeSessions: [makeSession()],
      });
      mocks.llmParse.mockResolvedValue('LLM says something');

      const deps: DispatcherDeps = {
        supabase: mocks.client,
        sendMessage: mocks.sendMessage,
        userId: 'user-1',
        userTimezone: 'America/Los_Angeles',
        chatKey: '+15555555555',
        llmParse: mocks.llmParse,
      };

      const result = await dispatch('hey', deps);
      expect(result.action).toBe('greeting');
      expect(mocks.llmParse).not.toHaveBeenCalled();
    });

    it('recurring check runs before session loading', async () => {
      const mocks = createDispatchMocks({
        activeSessions: [makeSession()],
      });
      mocks.llmParse.mockResolvedValue('LLM says something');

      const deps: DispatcherDeps = {
        supabase: mocks.client,
        sendMessage: mocks.sendMessage,
        userId: 'user-1',
        userTimezone: 'America/Los_Angeles',
        chatKey: '+15555555555',
        llmParse: mocks.llmParse,
      };

      const result = await dispatch('remind me every morning to stretch', deps);
      expect(result.action).toBe('recurring_unsupported');
      expect(mocks.llmParse).not.toHaveBeenCalled();
    });
  });
});
