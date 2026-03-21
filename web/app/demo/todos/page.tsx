/**
 * Demo page for TodoBoard and TodoCard components with mock data.
 * Used for visual verification of filter tabs, time grouping, and card display.
 */

'use client';

import { useState, useMemo } from 'react';
import { Todo, TodoStatus } from '@/lib/types';
import { getUserTimezone } from '@/lib/timezone';
import { TodoCard } from '@/components/todo-card';
import { isOverdueActive } from '@/components/status-badge';

function getTodayStr(timezone: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date());
}

function getCurrentWeekBounds(timezone: string): { monday: string; sunday: string } {
  const todayStr = getTodayStr(timezone);
  const today = new Date(`${todayStr}T12:00:00`);
  const dayOfWeek = today.getDay();
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(today);
  monday.setDate(today.getDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  return { monday: fmt(monday), sunday: fmt(sunday) };
}

function dayBoundsUTC(
  dateStr: string,
  _timezone: string,
): { start: string; end: string } {
  const startUTC = new Date(`${dateStr}T00:00:00`).toISOString();
  const endUTC = new Date(`${dateStr}T23:59:59.999`).toISOString();
  return { start: startUTC, end: endUTC };
}

// ---------------------------------------------------------------------------
// Mock data generator
// ---------------------------------------------------------------------------

function buildMockTodos(): Todo[] {
  const now = new Date();
  const today = new Date(now);

  /** Create a Date at a given hour today (local). */
  const todayAt = (hour: number, minute: number = 0): string => {
    const d = new Date(today);
    d.setHours(hour, minute, 0, 0);
    return d.toISOString();
  };

  /** Create a Date N days from now. */
  const daysFromNow = (days: number, hour: number = 10): string => {
    const d = new Date(today);
    d.setDate(d.getDate() + days);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  };

  /** Create a Date N days in the past. */
  const daysAgo = (days: number, hour: number = 10): string => {
    const d = new Date(today);
    d.setDate(d.getDate() - days);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  };

  /** A few minutes ago (for overdue testing). */
  const minutesAgo = (min: number): string => {
    return new Date(now.getTime() - min * 60 * 1000).toISOString();
  };

  const base: Omit<Todo, 'id' | 'task' | 'due_at' | 'status' | 'created_at'>
    & Partial<Pick<Todo, 'completed_at' | 'canceled_at' | 'not_confirmed_at' | 'reminded_at'>> = {
    user_id: 'demo-user',
    remind_at: null,
    reminded_at: null,
    completed_at: null,
    canceled_at: null,
    not_confirmed_at: null,
    updated_at: now.toISOString(),
  };

  return [
    // -- Today, various statuses --
    {
      ...base,
      id: '1',
      task: 'Buy groceries',
      due_at: todayAt(14, 0),
      status: 'pending' as TodoStatus,
      created_at: todayAt(8, 0),
    },
    {
      ...base,
      id: '2',
      task: 'Call dentist',
      due_at: todayAt(10, 30),
      status: 'in_progress' as TodoStatus,
      reminded_at: todayAt(10, 0),
      created_at: todayAt(7, 0),
    },
    {
      ...base,
      id: '3',
      task: 'Submit report',
      due_at: todayAt(9, 0),
      status: 'done' as TodoStatus,
      completed_at: todayAt(8, 45),
      created_at: daysAgo(1, 16),
    },
    {
      ...base,
      id: '4',
      task: 'Review PR comments',
      due_at: minutesAgo(5),
      status: 'in_progress' as TodoStatus,
      reminded_at: minutesAgo(35),
      created_at: daysAgo(1, 9),
    },
    {
      ...base,
      id: '5',
      task: 'Team standup notes',
      due_at: todayAt(9, 15),
      status: 'not_confirmed' as TodoStatus,
      not_confirmed_at: todayAt(9, 30),
      created_at: daysAgo(1, 22),
    },
    // -- This week --
    {
      ...base,
      id: '6',
      task: 'Prepare slides for Friday',
      due_at: daysFromNow(2, 15),
      status: 'pending' as TodoStatus,
      created_at: daysAgo(2, 10),
    },
    {
      ...base,
      id: '7',
      task: 'Gym session',
      due_at: daysFromNow(1, 18),
      status: 'pending' as TodoStatus,
      created_at: todayAt(7, 30),
    },
    // -- Canceled --
    {
      ...base,
      id: '8',
      task: 'Order new headphones',
      due_at: daysAgo(1, 12),
      status: 'canceled' as TodoStatus,
      canceled_at: daysAgo(1, 11),
      created_at: daysAgo(3, 9),
    },
    {
      ...base,
      id: '9',
      task: 'Cancel subscription reminder',
      due_at: todayAt(16, 0),
      status: 'canceled' as TodoStatus,
      canceled_at: todayAt(8, 0),
      created_at: daysAgo(2, 14),
    },
    // -- Older (beyond current week) --
    {
      ...base,
      id: '10',
      task: 'File taxes',
      due_at: daysAgo(10, 14),
      status: 'done' as TodoStatus,
      completed_at: daysAgo(10, 13),
      created_at: daysAgo(14, 9),
    },
    {
      ...base,
      id: '11',
      task: 'Renew passport',
      due_at: daysAgo(20, 10),
      status: 'not_confirmed' as TodoStatus,
      not_confirmed_at: daysAgo(20, 10),
      created_at: daysAgo(25, 11),
    },
  ];
}

// ---------------------------------------------------------------------------
// Filter types (matching todo-board.tsx)
// ---------------------------------------------------------------------------

type StatusFilter = 'all' | TodoStatus;
type TimeGroup = 'today' | 'this_week' | 'all';

interface FilterTab { key: StatusFilter; label: string; }
const FILTER_TABS: FilterTab[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'done', label: 'Done' },
  { key: 'not_confirmed', label: 'Not Confirmed' },
  { key: 'canceled', label: 'Canceled' },
];

interface TimeGroupOption { key: TimeGroup; label: string; }
const TIME_GROUPS: TimeGroupOption[] = [
  { key: 'today', label: 'Today' },
  { key: 'this_week', label: 'This Week' },
  { key: 'all', label: 'All' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DemoTodosPage() {
  const todos = useMemo(() => buildMockTodos(), []);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [timeGroup, setTimeGroup] = useState<TimeGroup>('this_week');

  const filteredTodos = useMemo(() => {
    const timezone = getUserTimezone();
    const todayStr = getTodayStr(timezone);
    const { start: todayStart, end: todayEnd } = dayBoundsUTC(todayStr, timezone);
    const { monday, sunday } = getCurrentWeekBounds(timezone);
    const { start: weekStart } = dayBoundsUTC(monday, timezone);
    const { end: weekEnd } = dayBoundsUTC(sunday, timezone);

    let result = todos;
    if (statusFilter !== 'all') {
      result = result.filter((t) => t.status === statusFilter);
    }

    if (timeGroup === 'today') {
      result = result.filter((t) => {
        if (!t.due_at) return false;
        return t.due_at >= todayStart && t.due_at <= todayEnd;
      });
    } else if (timeGroup === 'this_week') {
      result = result.filter((t) => {
        if (!t.due_at) return false;
        return t.due_at >= weekStart && t.due_at <= weekEnd;
      });
    }

    return result;
  }, [todos, statusFilter, timeGroup]);

  return (
    <div className="max-w-3xl">
      <h2 className="text-2xl font-bold text-gray-900 mb-6">
        Todos Demo (Mock Data)
      </h2>

      {/* Status filter tabs */}
      <div
        className="flex flex-wrap gap-2 mb-4"
        role="tablist"
        aria-label="Filter by status"
        data-testid="status-filter-tabs"
      >
        {FILTER_TABS.map((tab) => {
          const isActive = tab.key === statusFilter;
          const baseClass =
            'px-3 py-1.5 rounded-full text-sm font-medium transition-colors cursor-pointer';
          const activeClass = isActive
            ? 'bg-gray-900 text-white'
            : 'bg-gray-100 text-gray-600 hover:bg-gray-200';
          return (
            <button
              key={tab.key}
              role="tab"
              aria-selected={isActive}
              onClick={() => setStatusFilter(tab.key)}
              className={`${baseClass} ${activeClass}`}
              data-testid={`filter-tab-${tab.key}`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Time grouping */}
      <div
        className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit"
        role="tablist"
        aria-label="Group by time"
        data-testid="time-group-tabs"
      >
        {TIME_GROUPS.map((group) => {
          const isActive = group.key === timeGroup;
          const baseClass =
            'px-3 py-1 rounded-md text-sm font-medium transition-colors cursor-pointer';
          const activeClass = isActive
            ? 'bg-white text-gray-900 shadow-sm'
            : 'text-gray-500 hover:text-gray-700';
          return (
            <button
              key={group.key}
              role="tab"
              aria-selected={isActive}
              onClick={() => setTimeGroup(group.key)}
              className={`${baseClass} ${activeClass}`}
              data-testid={`time-group-${group.key}`}
            >
              {group.label}
            </button>
          );
        })}
      </div>

      {/* Results */}
      {filteredTodos.length === 0 ? (
        <div
          className="text-center py-12 rounded-lg border border-dashed border-gray-300 bg-white"
          data-testid="empty-state"
        >
          <p className="text-gray-500 text-sm">No tasks match the current filters.</p>
        </div>
      ) : (
        <div className="space-y-2" data-testid="todo-list">
          {filteredTodos.map((todo) => (
            <TodoCard key={todo.id} todo={todo} />
          ))}
        </div>
      )}

      {/* Debug info */}
      <div className="mt-6 text-xs text-gray-400">
        Showing {filteredTodos.length} of {todos.length} tasks |
        Filter: {statusFilter} | Time: {timeGroup}
      </div>
    </div>
  );
}
