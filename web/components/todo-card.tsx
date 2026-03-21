/**
 * TodoCard — Renders a single todo item with task text, due time,
 * status badge, created time, and an overdue indicator.
 *
 * Uses the StatusBadge component and isOverdueActive helper from
 * the status-badge module.
 */

import React from 'react';
import { Todo } from '@/lib/types';
import { StatusBadge, isOverdueActive } from '@/components/status-badge';

/** User timezone — defaults to browser timezone. */
function getUserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'America/Los_Angeles';
  }
}

/** Format a date string to a user-friendly due time display. */
function formatDueTime(isoString: string): string {
  const date = new Date(isoString);
  const timezone = getUserTimezone();
  return date.toLocaleString('en-US', {
    timeZone: timezone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/** Format a date string to a short created-at display. */
function formatCreatedTime(isoString: string): string {
  const date = new Date(isoString);
  const timezone = getUserTimezone();
  return date.toLocaleString('en-US', {
    timeZone: timezone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export interface TodoCardProps {
  todo: Todo;
}

export function TodoCard({ todo }: TodoCardProps) {
  const overdue = isOverdueActive(todo.status, todo.due_at);

  /** Border and background styling based on state. */
  let containerClass = 'border-gray-200 bg-white';
  if (todo.status === 'not_confirmed') {
    containerClass = 'border-red-300 bg-red-50';
  } else if (overdue) {
    containerClass = 'border-orange-300 bg-orange-50';
  } else if (todo.status === 'canceled') {
    containerClass = 'border-stone-200 bg-stone-50';
  }

  return (
    <div
      className={`rounded-lg border p-4 ${containerClass}`}
      data-testid="todo-card"
      data-status={todo.status}
      data-task-id={todo.id}
    >
      <div className="flex items-start justify-between gap-3">
        {/* Left: task text, times, overdue indicator */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">
            {todo.task}
          </p>

          {/* Due time */}
          <div className="flex items-center gap-2 mt-1.5">
            {todo.due_at ? (
              <span
                className={`text-xs ${overdue ? 'text-red-600 font-semibold' : 'text-gray-500'}`}
                data-testid="due-time"
              >
                {overdue && '⚠ '}
                Due {formatDueTime(todo.due_at)}
              </span>
            ) : (
              <span className="text-xs text-gray-400" data-testid="due-time">
                No due time
              </span>
            )}
          </div>

          {/* Created time */}
          <p
            className="text-xs text-gray-400 mt-1"
            data-testid="created-time"
          >
            Created {formatCreatedTime(todo.created_at)}
          </p>
        </div>

        {/* Right: status badge */}
        <div className="flex-shrink-0 mt-0.5">
          <StatusBadge status={todo.status} overdue={overdue} />
        </div>
      </div>
    </div>
  );
}

export default TodoCard;
