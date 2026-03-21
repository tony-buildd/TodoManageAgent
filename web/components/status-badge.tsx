/**
 * StatusBadge component — renders a color-coded badge for todo statuses.
 *
 * Supports all 5 spec statuses: pending, in_progress, done, not_confirmed, canceled.
 * Also supports the derived 'overdue' state for in_progress tasks past their due time.
 * Falls back gracefully for unknown status values (renders the raw string, doesn't crash).
 */

import React from 'react';

/** Configuration for each status badge variant. */
interface BadgeConfig {
  label: string;
  className: string;
}

/**
 * Badge configurations for all spec statuses plus the derived overdue state.
 *
 * Colors follow the spec:
 * - pending: amber
 * - in_progress: blue
 * - done: emerald/green
 * - not_confirmed: red/orange (attention-grabbing)
 * - canceled: gray/stone
 * - overdue: red/warning tone (derived state)
 */
const statusConfig: Record<string, BadgeConfig> = {
  pending: {
    label: 'Pending',
    className:
      'bg-amber-50 text-amber-700 border border-amber-200',
  },
  in_progress: {
    label: 'In Progress',
    className:
      'bg-blue-50 text-blue-700 border border-blue-200',
  },
  done: {
    label: 'Done',
    className:
      'bg-emerald-50 text-emerald-700 border border-emerald-200',
  },
  not_confirmed: {
    label: 'Not Confirmed',
    className:
      'bg-red-50 text-red-700 border border-red-300 font-semibold',
  },
  canceled: {
    label: 'Canceled',
    className:
      'bg-stone-100 text-stone-500 border border-stone-200',
  },
  overdue: {
    label: 'Overdue',
    className:
      'bg-red-100 text-red-800 border border-red-400 font-semibold',
  },
};

export interface StatusBadgeProps {
  /** The todo status value from the database. */
  status: string;
  /** Optional: override to show the 'overdue' derived badge instead. */
  overdue?: boolean;
}

/**
 * Renders a color-coded status badge.
 *
 * If `overdue` is true, renders the overdue variant regardless of the base status.
 * For unknown status values, renders the raw string with a neutral gray style.
 */
export function StatusBadge({ status, overdue }: StatusBadgeProps) {
  const effectiveStatus = overdue ? 'overdue' : status;
  const config = statusConfig[effectiveStatus];

  // Fallback for unknown status values — render raw string, don't crash
  const label = config?.label ?? status;
  const className = config?.className ?? 'bg-gray-100 text-gray-600 border border-gray-200';

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}
      data-status={status}
      data-overdue={overdue ? 'true' : undefined}
    >
      {label}
    </span>
  );
}

/**
 * Determines whether a task is in the "overdue but active" derived state.
 *
 * A task is overdue-active when:
 * 1. Its status is 'in_progress'
 * 2. The current time is past `dueAt`
 * 3. The current time is before `dueAt + graceMinutes`
 *
 * @param status - The task's current status
 * @param dueAt - The task's due_at timestamp (ISO string or Date), or null
 * @param graceMinutes - Grace period in minutes after due_at (default: 15)
 * @returns true if the task is overdue but still within the grace window
 */
export function isOverdueActive(
  status: string,
  dueAt: string | Date | null,
  graceMinutes: number = 15,
): boolean {
  if (status !== 'in_progress' || !dueAt) {
    return false;
  }

  const now = new Date();
  const due = dueAt instanceof Date ? dueAt : new Date(dueAt);

  // Check the due date is valid
  if (isNaN(due.getTime())) {
    return false;
  }

  const graceEnd = new Date(due.getTime() + graceMinutes * 60 * 1000);

  return now > due && now < graceEnd;
}

export default StatusBadge;
