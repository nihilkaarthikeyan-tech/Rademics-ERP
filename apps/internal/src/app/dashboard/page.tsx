'use client';

import { Card, CardContent, CardHeader, CardTitle, EmptyState } from '@rademics/ui';
import { useMe } from '@/lib/me-context';

/**
 * Role dashboards (Spec §17). Phase 1 renders the authenticated shell with
 * designed empty states; the real per-role widgets are filled in per phase.
 */
export default function DashboardPage() {
  const me = useMe();

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-xl font-semibold text-slate-800">Dashboard</h1>
      <p className="mt-1 text-sm text-slate-500">
        Signed in as <span className="font-medium">{me.email}</span>
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {['Tasks in progress', 'Awaiting acknowledgment', 'Overdue', 'Completed this week'].map(
          (label) => (
            <Card key={label}>
              <CardHeader>
                <CardTitle>{label}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold text-slate-300">—</div>
              </CardContent>
            </Card>
          ),
        )}
      </div>

      <div className="mt-6">
        <Card>
          <CardHeader>
            <CardTitle>My Tasks Today</CardTitle>
          </CardHeader>
          <CardContent>
            <EmptyState
              title="No tasks yet"
              description="Task management arrives in Phase 4. Your assigned work will show up here."
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
