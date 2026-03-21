/**
 * TodoBoard — Full-featured todos page with status filtering and time grouping.
 *
 * Filter tabs: All, Pending, In Progress, Done, Not Confirmed, Canceled
 * Time grouping: Today / This Week / All
 *
 * Current week (This Week) is the default/prominent view.
 * Canceled tasks appear under the Canceled and All filter tabs.
 * Older tasks are accessible via the All time group.
 */

'use client';

import { useEffect, useState, useMemo } from 'react';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Todo, TodoStatus } from '@/lib/types';
import { getUserTimezone } from '@/lib/timezone';
import { TodoCard } from '@/components/todo-card';

// ---------------------------------------------------------------------------
// Supabase client (lazy, client-side only)
// ---------------------------------------------------------------------------

let cachedClient: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient {
  if (cachedClient) return cachedClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      'Supabase configuration is missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.',
    );
  }

  cachedClient = createClient(url, key);
  return cachedClient;
}

// ---------------------------------------------------------------------------
// Timezone helpers
// ---------------------------------------------------------------------------

/**
 * Get the start-of-day (00:00:00) and end-of-day (23:59:59.999) for a
 * given local date string (YYYY-MM-DD) in the user's timezone, returned
 * as UTC ISO strings suitable for Supabase comparison.
 *
 * `new Date('YYYY-MM-DDThh:mm:ss')` (no Z suffix) already parses as
 * browser-local time, and the browser timezone equals the target timezone,
 * so `.toISOString()` gives the correct UTC equivalent directly.
 */
function dayBoundsUTC(
  dateStr: string,
  _timezone: string,
): { start: string; end: string } {
  const startUTC = new Date(`${dateStr}T00:00:00`).toISOString();
  const endUTC = new Date(`${dateStr}T23:59:59.999`).toISOString();

  return { start: startUTC, end: endUTC };
}

/** Return today's date string (YYYY-MM-DD) in the user's timezone. */
function getTodayStr(timezone: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date()); // YYYY-MM-DD
}

/**
 * Return the Monday and Sunday bounding the current calendar week
 * as YYYY-MM-DD strings in the user's timezone.
 * Week runs Monday–Sunday.
 */
function getCurrentWeekBounds(timezone: string): { monday: string; sunday: string } {
  const todayStr = getTodayStr(timezone);
  const today = new Date(`${todayStr}T12:00:00`); // midday to avoid DST quirks

  const dayOfWeek = today.getDay(); // 0=Sun, 1=Mon, ... 6=Sat
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

// ---------------------------------------------------------------------------
// Filter / grouping types
// ---------------------------------------------------------------------------

type StatusFilter = 'all' | TodoStatus;

type TimeGroup = 'today' | 'this_week' | 'all';

interface FilterTab {
  key: StatusFilter;
  label: string;
}

const FILTER_TABS: FilterTab[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'done', label: 'Done' },
  { key: 'not_confirmed', label: 'Not Confirmed' },
  { key: 'canceled', label: 'Canceled' },
];

interface TimeGroupOption {
  key: TimeGroup;
  label: string;
}

const TIME_GROUPS: TimeGroupOption[] = [
  { key: 'today', label: 'Today' },
  { key: 'this_week', label: 'This Week' },
  { key: 'all', label: 'All' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TodoBoard() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [timeGroup, setTimeGroup] = useState<TimeGroup>('this_week');

  // ---- Fetch all todos once -------------------------------------------------

  useEffect(() => {
    fetchTodos();
  }, []);

  async function fetchTodos() {
    try {
      setLoading(true);
      setError(null);

      const supabase = getSupabaseClient();

      const { data, error: fetchError } = await supabase
        .from('todos')
        .select('*')
        .order('due_at', { ascending: true, nullsFirst: false });

      if (fetchError) {
        throw new Error(fetchError.message);
      }

      setTodos((data ?? []) as Todo[]);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to load todos';
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  // ---- Derived filtered list ------------------------------------------------

  const filteredTodos = useMemo(() => {
    const timezone = getUserTimezone();
    const todayStr = getTodayStr(timezone);
    const { start: todayStart, end: todayEnd } = dayBoundsUTC(todayStr, timezone);

    const { monday, sunday } = getCurrentWeekBounds(timezone);
    const { start: weekStart } = dayBoundsUTC(monday, timezone);
    const { end: weekEnd } = dayBoundsUTC(sunday, timezone);

    // Step 1: status filter
    let result = todos;
    if (statusFilter !== 'all') {
      result = result.filter((t) => t.status === statusFilter);
    }

    // Step 2: time group filter
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
    // 'all' — no time filter

    return result;
  }, [todos, statusFilter, timeGroup]);

  // ---- Render ---------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-400 text-sm">Loading todos…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700 text-sm">
        {error}
      </div>
    );
  }

  return (
    <div data-testid="todo-board">
      {/* ---- Status filter tabs ---- */}
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

      {/* ---- Time grouping toggle ---- */}
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

      {/* ---- Results ---- */}
      {filteredTodos.length === 0 ? (
        <div
          className="text-center py-12 rounded-lg border border-dashed border-gray-300 bg-white"
          data-testid="empty-state"
        >
          <p className="text-gray-500 text-sm">
            No tasks match the current filters.
          </p>
        </div>
      ) : (
        <div className="space-y-2" data-testid="todo-list">
          {filteredTodos.map((todo) => (
            <TodoCard key={todo.id} todo={todo} onMutate={fetchTodos} />
          ))}
        </div>
      )}
    </div>
  );
}
