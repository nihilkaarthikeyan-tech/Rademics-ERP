'use client';

import { Card, CardContent, CardHeader, CardTitle, EmptyState } from '@rademics/ui';

/** Client portal dashboard (Spec §17.7). Phase 1: authenticated shell + empty state. */
export default function PortalDashboard() {
  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-800">My Projects</h1>
      <p className="mt-1 text-sm text-slate-500">Progress, deliverables and invoices for your projects.</p>

      <div className="mt-6">
        <Card>
          <CardHeader>
            <CardTitle>Projects</CardTitle>
          </CardHeader>
          <CardContent>
            <EmptyState
              title="No projects shared yet"
              description="When your project team shares progress or deliverables, they will appear here."
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
