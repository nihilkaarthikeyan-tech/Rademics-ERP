'use client';

import { use } from 'react';
import { Card, CardContent, EmptyState } from '@rademics/ui';

// Placeholder for nav sections whose real screens land in later phases —
// keeps every sidebar link functional (no 404s) during the build-out.
const PHASE: Record<string, string> = {
  'my-work': 'Phase 3–4',
  leave: 'Phase 7',
  finance: 'Phase 8',
  reports: 'Phase 9',
  assistant: 'Phase 9',
};

export default function ComingSoon({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = use(params);
  const section = slug?.[0] ?? '';
  const label = section.charAt(0).toUpperCase() + section.slice(1).replace('-', ' ');
  const phase = PHASE[section];

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-xl font-semibold text-slate-800">{label || 'Section'}</h1>
      <Card className="mt-4">
        <CardContent className="pt-6">
          <EmptyState
            title="Coming soon"
            description={
              phase
                ? `This section is scheduled for ${phase} of the build.`
                : 'This section is part of a later phase of the build.'
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
