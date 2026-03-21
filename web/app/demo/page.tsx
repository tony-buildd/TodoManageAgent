'use client';

import { StatusBadge, isOverdueActive } from '@/components/status-badge';

/**
 * Demo page to verify all StatusBadge variants render correctly.
 * This page displays every badge type with appropriate colors.
 */
export default function DemoPage() {
  // Demonstrate isOverdueActive helper
  const now = new Date();
  const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
  const twentyMinutesAgo = new Date(now.getTime() - 20 * 60 * 1000).toISOString();
  const inOneHour = new Date(now.getTime() + 60 * 60 * 1000).toISOString();

  const overdueActiveResult = isOverdueActive('in_progress', fiveMinutesAgo);
  const overdueExpiredResult = isOverdueActive('in_progress', twentyMinutesAgo);
  const notYetDueResult = isOverdueActive('in_progress', inOneHour);
  const wrongStatusResult = isOverdueActive('pending', fiveMinutesAgo);
  const nullDueResult = isOverdueActive('in_progress', null);

  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-bold text-gray-900 mb-6">
        Status Badge Demo
      </h2>

      {/* All 5 spec statuses */}
      <section className="mb-8">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">
          Spec Statuses (5)
        </h3>
        <div className="flex flex-wrap gap-3">
          <StatusBadge status="pending" />
          <StatusBadge status="in_progress" />
          <StatusBadge status="done" />
          <StatusBadge status="not_confirmed" />
          <StatusBadge status="canceled" />
        </div>
      </section>

      {/* Overdue derived state */}
      <section className="mb-8">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">
          Overdue Derived State
        </h3>
        <div className="flex flex-wrap gap-3">
          <StatusBadge status="in_progress" overdue={true} />
          <span className="text-sm text-gray-500 self-center">
            (in_progress task past due_at within grace period)
          </span>
        </div>
      </section>

      {/* Side-by-side comparison: overdue vs non-overdue in_progress */}
      <section className="mb-8">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">
          Overdue vs Non-Overdue Comparison
        </h3>
        <div className="flex gap-6 items-center">
          <div className="flex flex-col items-center gap-2">
            <StatusBadge status="in_progress" />
            <span className="text-xs text-gray-500">Normal In Progress</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <StatusBadge status="in_progress" overdue={true} />
            <span className="text-xs text-gray-500">Overdue Active</span>
          </div>
        </div>
      </section>

      {/* Unknown status fallback */}
      <section className="mb-8">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">
          Unknown Status Fallback
        </h3>
        <div className="flex flex-wrap gap-3">
          <StatusBadge status="some_future_status" />
          <StatusBadge status="reminded" />
          <StatusBadge status="archived" />
          <span className="text-sm text-gray-500 self-center">
            (renders raw string, no crash)
          </span>
        </div>
      </section>

      {/* isOverdueActive helper results */}
      <section className="mb-8">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">
          isOverdueActive Helper Tests
        </h3>
        <div className="bg-white rounded-lg border p-4 space-y-2 text-sm font-mono">
          <div>
            <span className="text-gray-500">in_progress, 5min ago:</span>{' '}
            <span className={overdueActiveResult ? 'text-red-600 font-bold' : 'text-gray-600'}>
              {String(overdueActiveResult)}
            </span>
            <span className="text-gray-400 ml-2">(expected: true)</span>
          </div>
          <div>
            <span className="text-gray-500">in_progress, 20min ago:</span>{' '}
            <span className={overdueExpiredResult ? 'text-red-600 font-bold' : 'text-gray-600'}>
              {String(overdueExpiredResult)}
            </span>
            <span className="text-gray-400 ml-2">(expected: false — past grace)</span>
          </div>
          <div>
            <span className="text-gray-500">in_progress, in 1 hour:</span>{' '}
            <span className={notYetDueResult ? 'text-red-600 font-bold' : 'text-gray-600'}>
              {String(notYetDueResult)}
            </span>
            <span className="text-gray-400 ml-2">(expected: false — not yet due)</span>
          </div>
          <div>
            <span className="text-gray-500">pending, 5min ago:</span>{' '}
            <span className={wrongStatusResult ? 'text-red-600 font-bold' : 'text-gray-600'}>
              {String(wrongStatusResult)}
            </span>
            <span className="text-gray-400 ml-2">(expected: false — wrong status)</span>
          </div>
          <div>
            <span className="text-gray-500">in_progress, null due:</span>{' '}
            <span className={nullDueResult ? 'text-red-600 font-bold' : 'text-gray-600'}>
              {String(nullDueResult)}
            </span>
            <span className="text-gray-400 ml-2">(expected: false — no due_at)</span>
          </div>
        </div>
      </section>
    </div>
  );
}
