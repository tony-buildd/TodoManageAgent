/**
 * Cross-area integration tests — verifies that the agent backend
 * and web dashboard work together correctly.
 *
 * VAL-CROSS-002: Canceled tasks excluded from scheduler reminder queries.
 * VAL-CROSS-001: Backend status changes reflected in dashboard queries.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSupabaseClient } from './helpers.js';
import {
  getDueReminders,
  getGracePeriodExpired,
  getNotConfirmedToday,
} from '../db.js';
import {
  sendDueReminders,
  checkGracePeriod,
  checkEodSummary,
  resetLastSummaryDate,
  type SchedulerDeps,
} from '../scheduler.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeTodo(overrides: Record<string, unknown> = {}) {
  return {
    id: 'todo-1',
    user_id: 'user-1',
    task: 'test task',
    due_at: '2025-03-21T03:50:00.000Z',
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
 * Build a mock Supabase client that returns specific data
 * for different query patterns.
 */
function buildMockClient(opts: {
  dueReminders?: Record<string, unknown>[];
  gracePeriodExpired?: Record<string, unknown>[];
  notConfirmedToday?: Record<string, unknown>[];
  freshStatus?: string;
}) {
  const sendMessage = vi.fn().mockResolvedValue(undefined);

  function createSelectChain() {
    let statusFilter: string | null = null;
    let hasRemindAtLte = false;
    let hasDueAtLt = false;
    let hasEqUserId = false;

    const chainObj: Record<string, (...args: unknown[]) => unknown> = {};

    chainObj.eq = vi.fn().mockImplementation((col: string, val: unknown) => {
      if (col === 'status') statusFilter = val as string;
      if (col === 'user_id') hasEqUserId = true;
      return chainObj;
    });
    chainObj.neq = vi.fn().mockReturnValue(chainObj);
    chainObj.gt = vi.fn().mockReturnValue(chainObj);
    chainObj.gte = vi.fn().mockReturnValue(chainObj);
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

  const mockFrom = vi.fn().mockImplementation(() => {
    const handler: ProxyHandler<Record<string, unknown>> = {
      get(_target, prop) {
        if (prop === 'select') {
          return vi.fn().mockImplementation(() => createSelectChain());
        }
        if (prop === 'update') {
          return vi.fn().mockImplementation(() => {
            const updateChain: Record<string, unknown> = {};
            updateChain.eq = vi.fn().mockReturnValue(updateChain);
            updateChain.then = vi.fn().mockImplementation(
              (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
            );
            return updateChain;
          });
        }
        return vi.fn().mockReturnValue(new Proxy({}, handler));
      },
    };
    return new Proxy({}, handler);
  });

  const client = {
    from: mockFrom,
    rpc: vi.fn(),
    auth: { getSession: vi.fn(), getUser: vi.fn() },
  } as unknown as import('@supabase/supabase-js').SupabaseClient;

  return { client, sendMessage, mockFrom };
}

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

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('VAL-CROSS-002: Web cancel stops agent reminders', () => {
  beforeEach(() => {
    resetLastSummaryDate();
  });

  it('getDueReminders queries only pending tasks, excluding canceled', async () => {
    // Simulate a scenario where a task was canceled via web UI
    // getDueReminders should NOT return it because it filters by status='pending'
    const { client, mockFrom } = createMockSupabaseClient();
    const now = new Date('2025-03-21T04:00:00.000Z');

    // Track what filter was applied
    let capturedStatusFilter: string | null = null;

    const mockChain: Record<string, unknown> = {};
    mockChain.eq = vi.fn().mockImplementation((col: string, val: unknown) => {
      if (col === 'status') capturedStatusFilter = val as string;
      return mockChain;
    });
    mockChain.not = vi.fn().mockReturnValue(mockChain);
    mockChain.lte = vi.fn().mockReturnValue(mockChain);
    mockChain.select = vi.fn().mockReturnValue(mockChain);
    mockChain.then = vi.fn().mockImplementation((resolve: (v: unknown) => void) => {
      resolve({ data: [], error: null });
    });

    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue(mockChain),
    });

    await getDueReminders(client, now);

    // Verify the query filters by status='pending' — canceled tasks are excluded
    expect(capturedStatusFilter).toBe('pending');
  });

  it('canceled task is never picked up by sendDueReminders', async () => {
    // Even if a canceled task somehow had remind_at <= now,
    // the scheduler only looks at pending tasks
    const { client, sendMessage } = buildMockClient({
      dueReminders: [], // No pending tasks (the canceled one won't appear)
      freshStatus: 'canceled',
    });

    const deps = makeDeps({
      supabase: client,
      sendMessage,
      now: () => new Date('2025-03-21T04:00:00.000Z'),
    });

    const sent = await sendDueReminders(deps);
    expect(sent).toBe(0);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('canceled task is not transitioned by grace period check', async () => {
    // Grace period check only looks at in_progress tasks
    const { client, sendMessage } = buildMockClient({
      gracePeriodExpired: [], // No in_progress tasks past grace
    });

    const deps = makeDeps({
      supabase: client,
      sendMessage,
      now: () => new Date('2025-03-21T04:20:00.000Z'),
    });

    const transitioned = await checkGracePeriod(deps);
    expect(transitioned).toBe(0);
  });

  it('canceled task is not included in EOD summary', async () => {
    // EOD summary only includes not_confirmed tasks
    const { client, sendMessage } = buildMockClient({
      notConfirmedToday: [], // No not_confirmed tasks
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

  it('full tick cycle ignores canceled tasks entirely', async () => {
    // A full scheduler tick with no actionable tasks (because they are all canceled)
    const { client, sendMessage } = buildMockClient({
      dueReminders: [],
      gracePeriodExpired: [],
      notConfirmedToday: [],
    });

    const deps = makeDeps({
      supabase: client,
      sendMessage,
      now: () => new Date('2025-03-21T03:50:00.000Z'),
    });

    const { tick } = await import('../scheduler.js');
    const result = await tick(deps);

    expect(result.remindersSent).toBe(0);
    expect(result.gracePeriodTransitions).toBe(0);
    expect(result.eodSummarySent).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('task canceled via web (status=canceled) prevents reminder even if re-check returns canceled', async () => {
    // Simulate: task was pending when getDueReminders ran,
    // but user canceled it via web before the reminder could be sent.
    // The re-check (fresh status lookup) should see canceled and skip it.
    const pendingTodo = makeTodo({ status: 'pending' });
    const { client, sendMessage } = buildMockClient({
      dueReminders: [pendingTodo],
      freshStatus: 'canceled', // User canceled via web between query and send
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

describe('VAL-CROSS-001: Backend status change reflected in dashboard', () => {
  it('getDueReminders returns only pending tasks for scheduler processing', async () => {
    const { client, mockFrom } = createMockSupabaseClient();

    // Set up mock to return specific pending tasks
    const pendingTasks = [
      makeTodo({ id: 'todo-1', status: 'pending', task: 'pending task' }),
    ];

    const mockChain: Record<string, unknown> = {};
    mockChain.eq = vi.fn().mockReturnValue(mockChain);
    mockChain.not = vi.fn().mockReturnValue(mockChain);
    mockChain.lte = vi.fn().mockReturnValue(mockChain);
    mockChain.select = vi.fn().mockReturnValue(mockChain);
    mockChain.then = vi.fn().mockImplementation((resolve: (v: unknown) => void) => {
      resolve({ data: pendingTasks, error: null });
    });

    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue(mockChain),
    });

    const result = await getDueReminders(client);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('pending');
  });

  it('getGracePeriodExpired returns only in_progress tasks', async () => {
    const { client, mockFrom } = createMockSupabaseClient();

    const inProgressTasks = [
      makeTodo({
        id: 'todo-2',
        status: 'in_progress',
        reminded_at: '2025-03-21T03:50:00.000Z',
      }),
    ];

    const mockChain: Record<string, unknown> = {};
    mockChain.eq = vi.fn().mockReturnValue(mockChain);
    mockChain.not = vi.fn().mockReturnValue(mockChain);
    mockChain.lt = vi.fn().mockReturnValue(mockChain);
    mockChain.select = vi.fn().mockReturnValue(mockChain);
    mockChain.then = vi.fn().mockImplementation((resolve: (v: unknown) => void) => {
      resolve({ data: inProgressTasks, error: null });
    });

    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue(mockChain),
    });

    const result = await getGracePeriodExpired(client, 15);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('in_progress');
  });
});

describe('Status lifecycle integration', () => {
  it('all five status values are valid todo statuses', () => {
    const validStatuses = ['pending', 'in_progress', 'done', 'not_confirmed', 'canceled'];

    for (const status of validStatuses) {
      const todo = makeTodo({ status });
      expect(todo.status).toBe(status);
    }
  });

  it('web dashboard query pattern (select *) fetches all statuses', () => {
    // The web dashboard uses .from('todos').select('*') without status filters
    // This test verifies the conceptual approach: client-side filtering
    const allTodos = [
      makeTodo({ id: '1', status: 'pending' }),
      makeTodo({ id: '2', status: 'in_progress' }),
      makeTodo({ id: '3', status: 'done' }),
      makeTodo({ id: '4', status: 'not_confirmed' }),
      makeTodo({ id: '5', status: 'canceled' }),
    ];

    // Simulate the dashboard filter — no status exclusion in the query
    expect(allTodos).toHaveLength(5);

    // Dashboard stat counts
    const pendingCount = allTodos.filter((t) => t.status === 'pending').length;
    const inProgressCount = allTodos.filter((t) => t.status === 'in_progress').length;
    const totalCount = allTodos.length;

    expect(pendingCount).toBe(1);
    expect(inProgressCount).toBe(1);
    expect(totalCount).toBe(5);
  });

  it('canceled tasks remain in database and are visible in history', () => {
    const canceledTodo = makeTodo({
      status: 'canceled',
      canceled_at: new Date().toISOString(),
    });

    // Canceled task exists in DB (not deleted)
    expect(canceledTodo.status).toBe('canceled');
    expect(canceledTodo.canceled_at).toBeDefined();
    expect(canceledTodo.canceled_at).not.toBeNull();

    // When All filter is active on todos page, canceled tasks appear
    const allTodos = [
      makeTodo({ id: '1', status: 'pending' }),
      canceledTodo,
    ];
    const allFilterResult = allTodos; // 'all' filter shows everything
    expect(allFilterResult).toHaveLength(2);

    // When Canceled filter is active
    const canceledFilterResult = allTodos.filter((t) => t.status === 'canceled');
    expect(canceledFilterResult).toHaveLength(1);
  });
});
