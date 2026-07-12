'use client';

import { Card, CardContent, EmptyState } from '@rademics/ui';

/** Shown when a client org's access has been deactivated (Spec §25). */
export function AccessEnded() {
  return (
    <Card>
      <CardContent className="pt-6">
        <EmptyState
          title="Access ended"
          description="Your organization's access to this portal has been closed. Please contact your Rademics project manager."
        />
      </CardContent>
    </Card>
  );
}
