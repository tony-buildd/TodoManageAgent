export const dynamic = 'force-dynamic';

import TodoBoard from '@/components/todo-board';

export default function TodosPage() {
  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Todos</h2>
      <TodoBoard />
    </div>
  );
}
