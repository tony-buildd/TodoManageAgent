/**
 * TodoCard — Renders a single todo item with task text, due time,
 * status badge, created time, overdue indicator, and action controls.
 *
 * Action controls: Edit, Reschedule, Cancel, Mark Done.
 * Uses Radix UI Dialog for edit and reschedule modals, and a
 * confirmation dialog for cancel.
 */

'use client';

import React, { useState, useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Todo } from '@/lib/types';
import { StatusBadge, isOverdueActive } from '@/components/status-badge';
import {
  editTaskText,
  rescheduleTodo,
  cancelTodo,
  markTodoDone,
} from '@/lib/todo-actions';

// ---------------------------------------------------------------------------
// Timezone helpers
// ---------------------------------------------------------------------------

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

/**
 * Convert an ISO date string to a datetime-local input value
 * in the user's timezone.
 */
function isoToDatetimeLocal(isoString: string): string {
  const date = new Date(isoString);
  const timezone = getUserTimezone();

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? '00';

  const year = get('year');
  const month = get('month');
  const day = get('day');
  const hour = get('hour');
  const minute = get('minute');

  return `${year}-${month}-${day}T${hour}:${minute}`;
}

/**
 * Convert a datetime-local input value to a UTC ISO string,
 * interpreting the input in the user's timezone.
 */
function datetimeLocalToISO(localValue: string): string {
  // localValue is "YYYY-MM-DDTHH:mm"
  const [datePart, timePart] = localValue.split('T');
  const localDate = new Date(`${datePart}T${timePart}:00`);

  // Compute the timezone offset
  const utcStr = localDate.toLocaleString('en-US', { timeZone: 'UTC' });
  const tzStr = localDate.toLocaleString('en-US', {
    timeZone: getUserTimezone(),
  });

  const utcDate = new Date(utcStr);
  const tzDate = new Date(tzStr);
  const offsetMs = utcDate.getTime() - tzDate.getTime();

  return new Date(localDate.getTime() + offsetMs).toISOString();
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TodoCardProps {
  todo: Todo;
  /** Callback invoked after a successful mutation to refresh the list. */
  onMutate?: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TodoCard({ todo, onMutate }: TodoCardProps) {
  const overdue = isOverdueActive(todo.status, todo.due_at);

  // Determine if the task is actionable (not done or canceled)
  const isTerminal =
    todo.status === 'done' || todo.status === 'canceled';

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

      {/* Action buttons — only shown for non-terminal tasks */}
      {!isTerminal && (
        <div
          className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-gray-100"
          data-testid="action-buttons"
        >
          <EditDialog todo={todo} onSuccess={onMutate} />
          <RescheduleDialog todo={todo} onSuccess={onMutate} />
          <MarkDoneButton todoId={todo.id} onSuccess={onMutate} />
          <CancelDialog todoId={todo.id} taskName={todo.task} onSuccess={onMutate} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit Dialog
// ---------------------------------------------------------------------------

function EditDialog({
  todo,
  onSuccess,
}: {
  todo: Todo;
  onSuccess?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(todo.task);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpen = useCallback(() => {
    setText(todo.task);
    setError(null);
    setOpen(true);
  }, [todo.task]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);

    const result = await editTaskText(todo.id, text);

    setSaving(false);

    if (!result.success) {
      setError(result.error ?? 'Failed to save.');
      return;
    }

    setOpen(false);
    onSuccess?.();
  }, [todo.id, text, onSuccess]);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          onClick={handleOpen}
          className="px-2.5 py-1 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 transition-colors"
          data-testid="edit-button"
        >
          Edit
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-50" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg shadow-xl p-6 w-full max-w-md z-50"
          data-testid="edit-dialog"
        >
          <Dialog.Title className="text-lg font-semibold text-gray-900 mb-4">
            Edit Task
          </Dialog.Title>

          <label
            htmlFor="edit-task-text"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Task text
          </label>
          <input
            id="edit-task-text"
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            data-testid="edit-text-input"
            disabled={saving}
          />

          {error && (
            <p className="text-sm text-red-600 mt-2" data-testid="edit-error">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 mt-4">
            <Dialog.Close asChild>
              <button
                className="px-3 py-1.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
                disabled={saving}
              >
                Cancel
              </button>
            </Dialog.Close>
            <button
              onClick={handleSave}
              disabled={saving || !text.trim()}
              className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
              data-testid="edit-save-button"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ---------------------------------------------------------------------------
// Reschedule Dialog
// ---------------------------------------------------------------------------

function RescheduleDialog({
  todo,
  onSuccess,
}: {
  todo: Todo;
  onSuccess?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [dateTimeValue, setDateTimeValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpen = useCallback(() => {
    // Pre-fill with existing due_at or default to now
    const initial = todo.due_at
      ? isoToDatetimeLocal(todo.due_at)
      : '';
    setDateTimeValue(initial);
    setError(null);
    setOpen(true);
  }, [todo.due_at]);

  const handleSave = useCallback(async () => {
    if (!dateTimeValue) {
      setError('Please select a date and time.');
      return;
    }

    setSaving(true);
    setError(null);

    const isoValue = datetimeLocalToISO(dateTimeValue);
    const result = await rescheduleTodo(todo.id, isoValue);

    setSaving(false);

    if (!result.success) {
      setError(result.error ?? 'Failed to reschedule.');
      return;
    }

    setOpen(false);
    onSuccess?.();
  }, [todo.id, dateTimeValue, onSuccess]);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          onClick={handleOpen}
          className="px-2.5 py-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-md hover:bg-amber-100 transition-colors"
          data-testid="reschedule-button"
        >
          Reschedule
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-50" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg shadow-xl p-6 w-full max-w-md z-50"
          data-testid="reschedule-dialog"
        >
          <Dialog.Title className="text-lg font-semibold text-gray-900 mb-4">
            Reschedule Task
          </Dialog.Title>

          <p className="text-sm text-gray-600 mb-3">
            Task: <span className="font-medium">{todo.task}</span>
          </p>

          <label
            htmlFor="reschedule-datetime"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            New due date & time
          </label>
          <input
            id="reschedule-datetime"
            type="datetime-local"
            value={dateTimeValue}
            onChange={(e) => setDateTimeValue(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
            data-testid="reschedule-datetime-input"
            disabled={saving}
          />

          {error && (
            <p
              className="text-sm text-red-600 mt-2"
              data-testid="reschedule-error"
            >
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 mt-4">
            <Dialog.Close asChild>
              <button
                className="px-3 py-1.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
                disabled={saving}
              >
                Cancel
              </button>
            </Dialog.Close>
            <button
              onClick={handleSave}
              disabled={saving || !dateTimeValue}
              className="px-3 py-1.5 text-sm font-medium text-white bg-amber-600 rounded-md hover:bg-amber-700 disabled:opacity-50 transition-colors"
              data-testid="reschedule-save-button"
            >
              {saving ? 'Saving…' : 'Reschedule'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ---------------------------------------------------------------------------
// Cancel Confirmation Dialog
// ---------------------------------------------------------------------------

function CancelDialog({
  todoId,
  taskName,
  onSuccess,
}: {
  todoId: string;
  taskName: string;
  onSuccess?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = useCallback(async () => {
    setSaving(true);
    setError(null);

    const result = await cancelTodo(todoId);

    setSaving(false);

    if (!result.success) {
      setError(result.error ?? 'Failed to cancel.');
      return;
    }

    setOpen(false);
    onSuccess?.();
  }, [todoId, onSuccess]);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          className="px-2.5 py-1 text-xs font-medium text-stone-600 bg-stone-50 border border-stone-200 rounded-md hover:bg-stone-100 transition-colors"
          data-testid="cancel-button"
        >
          Cancel Task
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-50" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg shadow-xl p-6 w-full max-w-md z-50"
          data-testid="cancel-dialog"
        >
          <Dialog.Title className="text-lg font-semibold text-gray-900 mb-4">
            Cancel Task
          </Dialog.Title>

          <p className="text-sm text-gray-600">
            Are you sure you want to cancel{' '}
            <span className="font-medium">&ldquo;{taskName}&rdquo;</span>?
            This action cannot be undone.
          </p>

          {error && (
            <p
              className="text-sm text-red-600 mt-2"
              data-testid="cancel-error"
            >
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 mt-4">
            <Dialog.Close asChild>
              <button
                className="px-3 py-1.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
                disabled={saving}
              >
                Keep Task
              </button>
            </Dialog.Close>
            <button
              onClick={handleConfirm}
              disabled={saving}
              className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50 transition-colors"
              data-testid="cancel-confirm-button"
            >
              {saving ? 'Canceling…' : 'Cancel Task'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ---------------------------------------------------------------------------
// Mark Done Button (no dialog, direct action)
// ---------------------------------------------------------------------------

function MarkDoneButton({
  todoId,
  onSuccess,
}: {
  todoId: string;
  onSuccess?: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDone = useCallback(async () => {
    setSaving(true);
    setError(null);

    const result = await markTodoDone(todoId);

    setSaving(false);

    if (!result.success) {
      setError(result.error ?? 'Failed to mark as done.');
      return;
    }

    onSuccess?.();
  }, [todoId, onSuccess]);

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={handleDone}
        disabled={saving}
        className="px-2.5 py-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100 disabled:opacity-50 transition-colors"
        data-testid="done-button"
      >
        {saving ? 'Saving…' : '✓ Done'}
      </button>
      {error && (
        <span className="text-xs text-red-600" data-testid="done-error">
          {error}
        </span>
      )}
    </div>
  );
}

export default TodoCard;
