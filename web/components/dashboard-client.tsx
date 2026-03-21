'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Todo } from '@/lib/types';
import { StatusBadge, isOverdueActive } from '@/components/status-badge';

/** Maximum number of tasks to display on the dashboard. */
const MAX_DISPLAY_TASKS = 10;

/** Lazily create the Supabase client on the client side only. */
function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('Supabase configuration is missing. Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.');
  }
  return createClient(url, key);
}

/** User timezone — defaults to browser timezone. */
function getUserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'America/Los_Angeles';
  }
}

/** Get the start and end of today in the user's timezone as UTC ISO strings. */
function getTodayRange(timezone: string): { start: string; end: string } {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const todayStr = formatter.format(now); // YYYY-MM-DD

  const startUTC = localToUTC(todayStr, '00:00:00', timezone);
  const endUTC = localToUTC(todayStr, '23:59:59.999', timezone);

  return { start: startUTC, end: endUTC };
}

/** Convert a local date/time in a timezone to a UTC ISO string. */
function localToUTC(dateStr: string, timeStr: string, timezone: string): string {
  const localDate = new Date(`${dateStr}T${timeStr}`);
  const utcDate = new Date(
    localDate.toLocaleString('en-US', { timeZone: 'UTC' })
  );
  const tzDate = new Date(
    localDate.toLocaleString('en-US', { timeZone: timezone })
  );
  const offset = utcDate.getTime() - tzDate.getTime();

  return new Date(localDate.getTime() + offset).toISOString();
}

interface StatCard {
  label: string;
  count: number;
  color: string;
  bgColor: string;
}

export default function DashboardClient() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [stats, setStats] = useState<StatCard[]>([
    { label: 'Pending', count: 0, color: 'text-amber-600', bgColor: 'bg-amber-50 border-amber-200' },
    { label: 'In Progress', count: 0, color: 'text-blue-600', bgColor: 'bg-blue-50 border-blue-200' },
    { label: 'Done Today', count: 0, color: 'text-emerald-600', bgColor: 'bg-emerald-50 border-emerald-200' },
    { label: 'Total Tasks', count: 0, color: 'text-gray-600', bgColor: 'bg-gray-50 border-gray-200' },
  ]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  async function fetchDashboardData() {
    try {
      setLoading(true);
      setError(null);

      const supabase = getSupabaseClient();
      const timezone = getUserTimezone();
      const { start: todayStart, end: todayEnd } = getTodayRange(timezone);

      // Fetch all todos for stat counts and today's display
      const { data: allTodos, error: todosError } = await supabase
        .from('todos')
        .select('*')
        .order('due_at', { ascending: true, nullsFirst: false });

      if (todosError) {
        throw new Error(todosError.message);
      }

      const allTodosTyped = (allTodos ?? []) as Todo[];

      // --- Compute stat counts ---
      const pendingCount = allTodosTyped.filter(
        (t) => t.status === 'pending'
      ).length;

      const inProgressCount = allTodosTyped.filter(
        (t) => t.status === 'in_progress'
      ).length;

      // Done today: tasks completed within today's range
      const doneTodayCount = allTodosTyped.filter((t) => {
        if (t.status !== 'done' || !t.completed_at) return false;
        return t.completed_at >= todayStart && t.completed_at <= todayEnd;
      }).length;

      const totalCount = allTodosTyped.length;

      setStats([
        { label: 'Pending', count: pendingCount, color: 'text-amber-600', bgColor: 'bg-amber-50 border-amber-200' },
        { label: 'In Progress', count: inProgressCount, color: 'text-blue-600', bgColor: 'bg-blue-50 border-blue-200' },
        { label: 'Done Today', count: doneTodayCount, color: 'text-emerald-600', bgColor: 'bg-emerald-50 border-emerald-200' },
        { label: 'Total Tasks', count: totalCount, color: 'text-gray-600', bgColor: 'bg-gray-50 border-gray-200' },
      ]);

      // --- Filter tasks for today's display ---
      // Include: not_confirmed (always), tasks due today, tasks created today with no due_at,
      //          overdue in_progress tasks
      // Exclude: done and canceled
      const displayTodos = allTodosTyped.filter((t) => {
        // Always show not_confirmed tasks
        if (t.status === 'not_confirmed') return true;
        // Exclude done and canceled from the task list
        if (t.status === 'done' || t.status === 'canceled') return false;
        // Include tasks due today
        if (t.due_at && t.due_at >= todayStart && t.due_at <= todayEnd) {
          return true;
        }
        // Include tasks with no due_at created today
        if (!t.due_at && t.created_at >= todayStart && t.created_at <= todayEnd) {
          return true;
        }
        // Include overdue active tasks (in_progress past due)
        if (t.status === 'in_progress' && t.due_at && new Date(t.due_at) < new Date()) {
          return true;
        }
        return false;
      });

      setTodos(displayTodos);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  }

  // --- Priority sorting ---
  const sortedTodos = [...todos].sort((a, b) => {
    const aIsNotConfirmed = a.status === 'not_confirmed';
    const bIsNotConfirmed = b.status === 'not_confirmed';
    const aIsOverdue = isOverdueActive(a.status, a.due_at);
    const bIsOverdue = isOverdueActive(b.status, b.due_at);

    // Not confirmed always first
    if (aIsNotConfirmed && !bIsNotConfirmed) return -1;
    if (!aIsNotConfirmed && bIsNotConfirmed) return 1;

    // Overdue active second
    if (aIsOverdue && !bIsOverdue && !bIsNotConfirmed) return -1;
    if (!aIsOverdue && bIsOverdue && !aIsNotConfirmed) return 1;

    // Sort by due_at ascending (nulls last)
    if (a.due_at && b.due_at) return a.due_at.localeCompare(b.due_at);
    if (a.due_at && !b.due_at) return -1;
    if (!a.due_at && b.due_at) return 1;
    return 0;
  });

  // Group tasks by priority category
  const notConfirmedTasks = sortedTodos.filter((t) => t.status === 'not_confirmed');
  const overdueActiveTasks = sortedTodos.filter(
    (t) => t.status !== 'not_confirmed' && isOverdueActive(t.status, t.due_at)
  );
  const remainingTasks = sortedTodos.filter(
    (t) => t.status !== 'not_confirmed' && !isOverdueActive(t.status, t.due_at)
  );

  // Limit displayed tasks per group, respecting total limit
  let remaining = MAX_DISPLAY_TASKS;
  const displayNotConfirmed = notConfirmedTasks.slice(0, remaining);
  remaining -= displayNotConfirmed.length;
  const displayOverdue = overdueActiveTasks.slice(0, remaining);
  remaining -= displayOverdue.length;
  const displayRemaining = remainingTasks.slice(0, remaining);
  const hasMore = sortedTodos.length > MAX_DISPLAY_TASKS;

  if (loading) {
    return (
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-6">Dashboard</h2>
        <div className="flex items-center justify-center py-12">
          <div className="text-gray-400 text-sm">Loading...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-6">Dashboard</h2>
        <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700 text-sm">
          {error}
        </div>
      </div>
    );
  }

  const isEmpty = sortedTodos.length === 0;

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Dashboard</h2>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8" data-testid="stat-cards">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className={`rounded-lg border p-4 ${stat.bgColor}`}
            data-testid={`stat-${stat.label.toLowerCase().replace(/\s+/g, '-')}`}
          >
            <div className={`text-2xl font-bold ${stat.color}`}>
              {stat.count}
            </div>
            <div className="text-sm text-gray-600 mt-1">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Empty State */}
      {isEmpty && (
        <div
          className="text-center py-12 rounded-lg border border-dashed border-gray-300 bg-white"
          data-testid="empty-state"
        >
          <svg
            className="mx-auto h-12 w-12 text-gray-300"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
            />
          </svg>
          <p className="mt-4 text-gray-500 text-lg">No upcoming tasks</p>
          <p className="mt-1 text-gray-400 text-sm">
            Tasks will appear here as they are created
          </p>
        </div>
      )}

      {/* Task Priority Sections */}
      {!isEmpty && (
        <div className="space-y-6" data-testid="task-sections">
          {/* Not Confirmed Section */}
          {displayNotConfirmed.length > 0 && (
            <section data-testid="not-confirmed-section">
              <h3 className="text-sm font-semibold text-red-700 uppercase tracking-wide mb-3">
                ⚠ Needs Confirmation
              </h3>
              <div className="space-y-2">
                {displayNotConfirmed.map((todo) => (
                  <TaskCard key={todo.id} todo={todo} highlight="not_confirmed" />
                ))}
              </div>
            </section>
          )}

          {/* Overdue Active Section */}
          {displayOverdue.length > 0 && (
            <section data-testid="overdue-section">
              <h3 className="text-sm font-semibold text-orange-700 uppercase tracking-wide mb-3">
                🕐 Overdue
              </h3>
              <div className="space-y-2">
                {displayOverdue.map((todo) => (
                  <TaskCard key={todo.id} todo={todo} highlight="overdue" />
                ))}
              </div>
            </section>
          )}

          {/* Today's Remaining Tasks */}
          {displayRemaining.length > 0 && (
            <section data-testid="today-section">
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                Today
              </h3>
              <div className="space-y-2">
                {displayRemaining.map((todo) => (
                  <TaskCard key={todo.id} todo={todo} />
                ))}
              </div>
            </section>
          )}

          {/* Link to /todos for more */}
          {hasMore && (
            <div className="text-center pt-2">
              <a
                href="/todos"
                className="text-sm text-blue-600 hover:text-blue-800 font-medium"
              >
                View all tasks →
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Highlight type for task cards. */
type TaskHighlight = 'not_confirmed' | 'overdue' | undefined;

/** Props for the TaskCard component. */
interface TaskCardProps {
  todo: Todo;
  highlight?: TaskHighlight;
}

/** Renders a single task card with priority-based styling. */
function TaskCard({ todo, highlight }: TaskCardProps) {
  const overdue = isOverdueActive(todo.status, todo.due_at);

  let borderClass = 'border-gray-200 bg-white';
  if (highlight === 'not_confirmed') {
    borderClass = 'border-red-300 bg-red-50';
  } else if (highlight === 'overdue') {
    borderClass = 'border-orange-300 bg-orange-50';
  }

  return (
    <div
      className={`rounded-lg border p-4 flex items-center justify-between ${borderClass}`}
      data-testid="task-card"
      data-status={todo.status}
      data-task-id={todo.id}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{todo.task}</p>
        {todo.due_at && (
          <p className="text-xs text-gray-500 mt-1">
            Due{' '}
            {new Date(todo.due_at).toLocaleString('en-US', {
              timeZone: getUserTimezone(),
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
            })}
          </p>
        )}
        {!todo.due_at && (
          <p className="text-xs text-gray-400 mt-1">No due time</p>
        )}
      </div>
      <div className="ml-4 flex-shrink-0">
        <StatusBadge status={todo.status} overdue={overdue} />
      </div>
    </div>
  );
}
