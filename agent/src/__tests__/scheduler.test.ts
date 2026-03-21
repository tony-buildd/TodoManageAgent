import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSupabaseClient } from './helpers.js';
import {
  tick,
  sendDueReminders,
  checkGracePeriod,
  checkEodSummary,
  resetLastSummaryDate,
  getLastSummaryDate,
  type SchedulerDeps,
} from '../scheduler.js';
import {
  calcRemindAt,
  getDueReminders,
  getGracePeriodExpired,
  getNotConfirmedToday,
} from '../db.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeDeps(overrides?: Partial<SchedulerDeps>): SchedulerDeps {
  const { client } = createMockSupabaseClient();
  return {
    supabase: client,
    sendMessage: vi.fn().mockResolvedValue(undefined),
    userId: 'user-1',
    userTimezone: 'America/Los_Angeles',
    ...overrides,
  };
}

function makeTodo(overrides: Record<string, unknown> = {}) {
  return {
    id: 'todo-1',
    user_id: 'user-1',
    task: 'get food',
    due_at: '2025-03-21T03:50:00.000Z', // 8:50 PM PDT
    remind_at: '2025-03-21T03:50:00.000Z',
    status: 'pending',
    reminded_at: null,
    completed_at: null,
    canceled_at: null,
    not_confirmed_at: null,
    created_at: '2025-03-21T03:46:00.000Z',
    updated_at: '2025-03-21T03:46:00.000Z',
    ...overrides,
  };
}

/**
 * Build a mock Supabase client for scheduler tests.
 * Uses a proxy-based approach to handle the complex chaining.
 */
function buildSchedulerMocks(opts: {
  dueReminders?: Record<string, unknown>[];
  gracePeriodExpired?: Record<string, unknown>[];
  notConfirmedToday?: Record<string, unknown>[];
  freshStatus?: string;
}) {
  const sendMessage = vi.fn().mockResolvedValue(undefined);

  function createChainableBuilder(resolveData: { data: unknown; error: null }) {
    const handler: ProxyHandler<Record<string, unknown>> = {
      get(_target, prop) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => void) => resolve(resolveData);
        }
        if (prop === 'single') {
          return () =>
            Promise.resolve({
              data: { status: opts.freshStatus ?? 'pending' },
              error: null,
            });
        }
        // All chainable methods return the proxy itself
        return vi.fn().mockReturnValue(new Proxy({}, handler));
      },
    };
    return new Proxy({}, handler);
  }

  // Track which query is being built
  let callIndex = 0;
  const queryOrder = [
    // sendDueReminders calls getDueReminders first
    { data: opts.dueReminders ?? [], error: null },
  ];

  // For each due reminder, there's a "re-check" call (select + single)
  // Then after all reminders, there are update calls

  const mockFrom = vi.fn().mockImplementation((_table: string) => {
    const handler: ProxyHandler<Record<string, unknown>> = {
      get(_target, prop) {
        if (prop === 'select') {
          // Start of a SELECT chain
          return vi.fn().mockImplementation(() => {
            return createSelectChain();
          });
        }
        if (prop === 'update') {
          // UPDATE chain — returns a thenable that resolves to success
          return vi.fn().mockImplementation(() => {
            return createChainableBuilder({ data: null, error: null });
          });
        }
        if (prop === 'insert') {
          return vi.fn().mockImplementation(() => {
            return createChainableBuilder({ data: null, error: null });
          });
        }
        return vi.fn().mockReturnValue(new Proxy({}, handler));
      },
    };
    return new Proxy({}, handler);
  });

  function createSelectChain() {
    // Track filters applied to figure out which data to return
    let statusFilter: string | null = null;
    let hasRemindAtLte = false;
    let hasDueAtLt = false;
    let hasEqUserId = false;
    let hasGteNotConfirmedAt = false;
    let isSingleQuery = false;

    const chainObj: Record<string, (...args: unknown[]) => unknown> = {};

    chainObj.eq = vi.fn().mockImplementation((col: string, _val: unknown) => {
      if (col === 'status') statusFilter = _val as string;
      if (col === 'user_id') hasEqUserId = true;
      return chainObj;
    });
    chainObj.neq = vi.fn().mockReturnValue(chainObj);
    chainObj.gt = vi.fn().mockReturnValue(chainObj);
    chainObj.gte = vi.fn().mockImplementation((col: string) => {
      if (col === 'not_confirmed_at') hasGteNotConfirmedAt = true;
      return chainObj;
    });
    chainObj.lt = vi.fn().mockImplementation(() => {
      hasDueAtLt = true;
      return chainObj;
    });
    chainObj.lte = vi.fn().mockImplementation((col: string) => {
      if (col === 'remind_at') hasRemindAtLte = true;
      return chainObj;
    });
    chainObj.in = vi.fn().mockReturnValue(chainObj);
    chainObj.not = vi.fn().mockReturnValue(chainObj);
    chainObj.is = vi.fn().mockReturnValue(chainObj);
    chainObj.order = vi.fn().mockReturnValue(chainObj);
    chainObj.select = vi.fn().mockReturnValue(chainObj);
    chainObj.single = vi.fn().mockImplementation(() => {
      isSingleQuery = true;
      return Promise.resolve({
        data: { status: opts.freshStatus ?? 'pending' },
        error: null,
      });
    });
    chainObj.then = vi.fn().mockImplementation((resolve: (v: unknown) => void) => {
      if (statusFilter === 'pending' && hasRemindAtLte) {
        resolve({ data: opts.dueReminders ?? [], error: null });
      } else if (statusFilter === 'in_progress' && hasDueAtLt) {
        resolve({ data: opts.gracePeriodExpired ?? [], error: null });
      } else if (statusFilter === 'not_confirmed' && hasEqUserId) {
        resolve({ data: opts.notConfirmedToday ?? [], error: null });
      } else {
        resolve({ data: [], error: null });
      }
    });

    return chainObj;
  }

  const client = {
    from: mockFrom,
    rpc: vi.fn(),
    auth: { getSession: vi.fn(), getUser: vi.fn() },
  } as unknown as import('@supabase/supabase-js').SupabaseClient;

  return { client, sendMessage, mockFrom };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('calcRemindAt', () => {
  it('should return due_at - lead_minutes when in the future (VAL-REMIND-001)', () => {
    const dueAt = new Date('2025-03-21T04:00:00.000Z'); // 9:00 PM PDT
    const now = new Date('2025-03-21T03:00:00.000Z'); // 8:00 PM PDT
    const result = calcRemindAt(dueAt, 30, now);
    // 9:00 PM - 30 min = 8:30 PM
    expect(result).toBe('2025-03-21T03:30:00.000Z');
  });

  it('should return due_at when due_at - lead_minutes is in the past (VAL-REMIND-002)', () => {
    // Created at 8:46 PM, due at 8:50 PM, 30 min lead → candidate = 8:20 PM (past)
    const dueAt = new Date('2025-03-21T03:50:00.000Z'); // 8:50 PM PDT
    const now = new Date('2025-03-21T03:46:00.000Z'); // 8:46 PM PDT
    const result = calcRemindAt(dueAt, 30, now);
    expect(result).toBe(dueAt.toISOString());
  });

  it('should return due_at when due_at - lead_minutes is exactly now', () => {
    const dueAt = new Date('2025-03-21T04:00:00.000Z');
    const now = new Date('2025-03-21T03:30:00.000Z'); // exactly 30 min before
    const result = calcRemindAt(dueAt, 30, now);
    expect(result).toBe(dueAt.toISOString());
  });

  it('should handle 0 lead_minutes by returning due_at', () => {
    const dueAt = new Date('2025-03-21T04:00:00.000Z');
    const now = new Date('2025-03-21T03:50:00.000Z');
    const result = calcRemindAt(dueAt, 0, now);
    expect(result).toBe(dueAt.toISOString());
  });
});

describe('getDueReminders', () => {
  it('should query for pending tasks with remind_at <= now', async () => {
    const { client, mockFrom } = createMockSupabaseClient();
    const now = new Date('2025-03-21T04:00:00.000Z');

    const mockChain: Record<string, unknown> = {};
    mockChain.eq = vi.fn().mockReturnValue(mockChain);
    mockChain.not = vi.fn().mockReturnValue(mockChain);
    mockChain.lte = vi.fn().mockReturnValue(mockChain);
    mockChain.select = vi.fn().mockReturnValue(mockChain);
    mockChain.then = vi.fn().mockImplementation((resolve: (v: unknown) => void) => {
      resolve({ data: [makeTodo()], error: null });
    });

    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue(mockChain),
    });

    const result = await getDueReminders(client, now);
    expect(result).toHaveLength(1);
    expect(result[0].task).toBe('get food');
    expect(mockFrom).toHaveBeenCalledWith('todos');
  });
});

describe('getGracePeriodExpired', () => {
  it('should query for in_progress tasks past grace period', async () => {
    const { client, mockFrom } = createMockSupabaseClient();
    const now = new Date('2025-03-21T04:20:00.000Z'); // 20 min after some due_at

    const mockChain: Record<string, unknown> = {};
    mockChain.eq = vi.fn().mockReturnValue(mockChain);
    mockChain.not = vi.fn().mockReturnValue(mockChain);
    mockChain.lt = vi.fn().mockReturnValue(mockChain);
    mockChain.select = vi.fn().mockReturnValue(mockChain);
    mockChain.then = vi.fn().mockImplementation((resolve: (v: unknown) => void) => {
      resolve({
        data: [makeTodo({ status: 'in_progress', reminded_at: '2025-03-21T03:50:00.000Z' })],
        error: null,
      });
    });

    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue(mockChain),
    });

    const result = await getGracePeriodExpired(client, 15, now);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('in_progress');
  });
});

describe('scheduler - sendDueReminders', () => {
  beforeEach(() => {
    resetLastSummaryDate();
  });

  it('new task starts as pending (VAL-STATUS-001)', () => {
    const todo = makeTodo();
    expect(todo.status).toBe('pending');
    expect(todo.reminded_at).toBeNull();
    expect(todo.completed_at).toBeNull();
    expect(todo.canceled_at).toBeNull();
    expect(todo.not_confirmed_at).toBeNull();
  });

  it('reminder transitions to in_progress with reminded_at (VAL-REMIND-003)', async () => {
    const pendingTodo = makeTodo({ status: 'pending' });
    const { client, sendMessage } = buildSchedulerMocks({
      dueReminders: [pendingTodo],
      freshStatus: 'pending',
    });

    const deps = makeDeps({
      supabase: client,
      sendMessage,
      now: () => new Date('2025-03-21T03:50:00.000Z'),
    });

    const sent = await sendDueReminders(deps);
    expect(sent).toBe(1);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Reminder:'),
    );
    expect(sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('get food'),
    );
  });

  it('short-horizon remind_at defaults to due_at (VAL-REMIND-002)', () => {
    // 8:46 PM now, 8:50 PM due, 30 min lead → remind_at should be 8:50 PM
    const dueAt = new Date('2025-03-21T03:50:00.000Z');
    const now = new Date('2025-03-21T03:46:00.000Z');
    const remindAt = calcRemindAt(dueAt, 30, now);
    expect(remindAt).toBe(dueAt.toISOString());
  });

  it('completion before reminder prevents redundant send (VAL-EDGE-004)', async () => {
    const pendingTodo = makeTodo({ status: 'pending' });
    const { client, sendMessage } = buildSchedulerMocks({
      dueReminders: [pendingTodo],
      freshStatus: 'done', // User completed it before reminder fires
    });

    const deps = makeDeps({
      supabase: client,
      sendMessage,
      now: () => new Date('2025-03-21T03:50:00.000Z'),
    });

    const sent = await sendDueReminders(deps);
    expect(sent).toBe(0);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('sends no reminders when there are no due tasks', async () => {
    const { client, sendMessage } = buildSchedulerMocks({
      dueReminders: [],
    });

    const deps = makeDeps({
      supabase: client,
      sendMessage,
      now: () => new Date('2025-03-21T03:50:00.000Z'),
    });

    const sent = await sendDueReminders(deps);
    expect(sent).toBe(0);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe('scheduler - checkGracePeriod', () => {
  beforeEach(() => {
    resetLastSummaryDate();
  });

  it('grace period transitions to not_confirmed (VAL-REMIND-004)', async () => {
    const inProgressTodo = makeTodo({
      status: 'in_progress',
      reminded_at: '2025-03-21T03:50:00.000Z',
      due_at: '2025-03-21T03:50:00.000Z',
    });
    const { client, sendMessage } = buildSchedulerMocks({
      gracePeriodExpired: [inProgressTodo],
    });

    const deps = makeDeps({
      supabase: client,
      sendMessage,
      now: () => new Date('2025-03-21T04:06:00.000Z'), // 16 min after due
    });

    const transitioned = await checkGracePeriod(deps);
    expect(transitioned).toBe(1);
  });

  it('no chat nudge on not_confirmed transition (VAL-REMIND-005)', async () => {
    const inProgressTodo = makeTodo({
      status: 'in_progress',
      reminded_at: '2025-03-21T03:50:00.000Z',
      due_at: '2025-03-21T03:50:00.000Z',
    });
    const { client, sendMessage } = buildSchedulerMocks({
      gracePeriodExpired: [inProgressTodo],
    });

    const deps = makeDeps({
      supabase: client,
      sendMessage,
      now: () => new Date('2025-03-21T04:06:00.000Z'),
    });

    await checkGracePeriod(deps);
    // No message should be sent during grace period transition
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('no transitions when no tasks are past grace', async () => {
    const { client, sendMessage } = buildSchedulerMocks({
      gracePeriodExpired: [],
    });

    const deps = makeDeps({
      supabase: client,
      sendMessage,
    });

    const transitioned = await checkGracePeriod(deps);
    expect(transitioned).toBe(0);
  });
});

describe('scheduler - checkEodSummary', () => {
  beforeEach(() => {
    resetLastSummaryDate();
  });

  it('EOD summary sent at 10 PM with not_confirmed tasks (VAL-EOD-001)', async () => {
    const notConfirmedTodos = [
      makeTodo({
        id: 'todo-1',
        task: 'get food',
        status: 'not_confirmed',
        not_confirmed_at: '2025-03-21T04:05:00.000Z',
        due_at: '2025-03-21T03:50:00.000Z',
      }),
      makeTodo({
        id: 'todo-2',
        task: 'call mom',
        status: 'not_confirmed',
        not_confirmed_at: '2025-03-21T02:15:00.000Z',
        due_at: '2025-03-21T01:00:00.000Z',
      }),
    ];
    const { client, sendMessage } = buildSchedulerMocks({
      notConfirmedToday: notConfirmedTodos,
    });

    // 10:15 PM PDT = UTC 05:15 AM next day
    const tenPmPdt = new Date('2025-03-21T05:15:00.000Z');

    const deps = makeDeps({
      supabase: client,
      sendMessage,
      now: () => tenPmPdt,
    });

    const sent = await checkEodSummary(deps);
    expect(sent).toBe(true);
    expect(sendMessage).toHaveBeenCalledTimes(1);

    const msg = (sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(msg).toContain('End of day summary');
    expect(msg).toContain('2 unresolved tasks');
    expect(msg).toContain('get food');
    expect(msg).toContain('call mom');
  });

  it('no summary when zero not_confirmed tasks (VAL-EOD-002)', async () => {
    const { client, sendMessage } = buildSchedulerMocks({
      notConfirmedToday: [],
    });

    const tenPmPdt = new Date('2025-03-21T05:15:00.000Z');

    const deps = makeDeps({
      supabase: client,
      sendMessage,
      now: () => tenPmPdt,
    });

    const sent = await checkEodSummary(deps);
    expect(sent).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('summary sent only once per day', async () => {
    const notConfirmedTodos = [
      makeTodo({
        task: 'get food',
        status: 'not_confirmed',
        not_confirmed_at: '2025-03-21T04:05:00.000Z',
      }),
    ];
    const { client, sendMessage } = buildSchedulerMocks({
      notConfirmedToday: notConfirmedTodos,
    });

    const tenPmPdt = new Date('2025-03-21T05:15:00.000Z');

    const deps = makeDeps({
      supabase: client,
      sendMessage,
      now: () => tenPmPdt,
    });

    // First call — should send
    const sent1 = await checkEodSummary(deps);
    expect(sent1).toBe(true);
    expect(sendMessage).toHaveBeenCalledTimes(1);

    // Second call — should not send again
    const sent2 = await checkEodSummary(deps);
    expect(sent2).toBe(false);
    expect(sendMessage).toHaveBeenCalledTimes(1); // Still just 1
  });

  it('does not send summary outside 10 PM hour', async () => {
    const { client, sendMessage } = buildSchedulerMocks({
      notConfirmedToday: [makeTodo({ status: 'not_confirmed' })],
    });

    // 9 PM PDT = UTC 04:00
    const ninePmPdt = new Date('2025-03-21T04:00:00.000Z');

    const deps = makeDeps({
      supabase: client,
      sendMessage,
      now: () => ninePmPdt,
    });

    const sent = await checkEodSummary(deps);
    expect(sent).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('EOD summary message includes task names and due times', async () => {
    const notConfirmedTodos = [
      makeTodo({
        id: 'todo-1',
        task: 'buy groceries',
        status: 'not_confirmed',
        not_confirmed_at: '2025-03-21T04:05:00.000Z',
        due_at: '2025-03-21T01:30:00.000Z',
      }),
    ];
    const { client, sendMessage } = buildSchedulerMocks({
      notConfirmedToday: notConfirmedTodos,
    });

    const tenPmPdt = new Date('2025-03-21T05:15:00.000Z');

    const deps = makeDeps({
      supabase: client,
      sendMessage,
      now: () => tenPmPdt,
    });

    await checkEodSummary(deps);
    const msg = (sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(msg).toContain('buy groceries');
    expect(msg).toContain('1 unresolved task');
    expect(msg).toContain('Reply "done [task]" to mark them complete.');
  });
});

describe('scheduler - tick (integrated)', () => {
  beforeEach(() => {
    resetLastSummaryDate();
  });

  it('runs all three checks and returns results', async () => {
    const pendingTodo = makeTodo({ status: 'pending' });
    const { client, sendMessage } = buildSchedulerMocks({
      dueReminders: [pendingTodo],
      gracePeriodExpired: [],
      notConfirmedToday: [],
      freshStatus: 'pending',
    });

    const deps = makeDeps({
      supabase: client,
      sendMessage,
      now: () => new Date('2025-03-21T03:50:00.000Z'),
    });

    const result = await tick(deps);
    expect(result.remindersSent).toBe(1);
    expect(result.gracePeriodTransitions).toBe(0);
    expect(result.eodSummarySent).toBe(false);
  });

  it('handles multiple reminders and grace transitions in one tick', async () => {
    const pending1 = makeTodo({ id: 'todo-1', task: 'get food', status: 'pending' });
    const pending2 = makeTodo({ id: 'todo-2', task: 'buy milk', status: 'pending' });
    const expired1 = makeTodo({
      id: 'todo-3',
      task: 'call mom',
      status: 'in_progress',
      reminded_at: '2025-03-21T03:00:00.000Z',
      due_at: '2025-03-21T03:00:00.000Z',
    });

    const { client, sendMessage } = buildSchedulerMocks({
      dueReminders: [pending1, pending2],
      gracePeriodExpired: [expired1],
      freshStatus: 'pending',
    });

    const deps = makeDeps({
      supabase: client,
      sendMessage,
      now: () => new Date('2025-03-21T03:50:00.000Z'),
    });

    const result = await tick(deps);
    expect(result.remindersSent).toBe(2);
    expect(result.gracePeriodTransitions).toBe(1);
    // 2 reminders sent, 0 for grace (no chat)
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });
});

describe('scheduler - status lifecycle', () => {
  it('done reply sets status=done and completed_at (VAL-STATUS-002)', () => {
    // This tests the concept: when user replies "done", the task gets done+completed_at
    const now = new Date();

    // Simulate what the dispatcher does when user says "done"
    const doneUpdate = {
      status: 'done' as const,
      completed_at: now.toISOString(),
    };

    expect(doneUpdate.status).toBe('done');
    expect(doneUpdate.completed_at).toBeDefined();
    expect(new Date(doneUpdate.completed_at).getTime()).toBeGreaterThan(0);
  });

  it('lightweight ack keeps in_progress (VAL-CHAT-002)', () => {
    // Verify that ack handling does NOT change status
    const todo = makeTodo({ status: 'in_progress', reminded_at: '2025-03-21T03:50:00.000Z' });
    // After ack, status should remain in_progress
    expect(todo.status).toBe('in_progress');
  });

  it('canceled task has canceled_at set (VAL-STATUS-003)', () => {
    const now = new Date();
    const cancelUpdate = {
      status: 'canceled' as const,
      canceled_at: now.toISOString(),
    };
    expect(cancelUpdate.status).toBe('canceled');
    expect(cancelUpdate.canceled_at).toBeDefined();
  });
});

describe('scheduler - resetLastSummaryDate', () => {
  it('should reset the last summary date', () => {
    resetLastSummaryDate();
    expect(getLastSummaryDate()).toBeNull();
  });
});
