'use client';

import { useState } from 'react';
import * as Sentry from '@sentry/nextjs';
import { Button, Card, CardContent } from '@rademics/ui';

/**
 * Manual Sentry test trigger (Spec §11): confirms the browser SDK reports errors.
 * "Capture" sends a handled exception; "Throw" raises an unhandled one caught by
 * Sentry's global handler. Both are no-ops for the user when no DSN is configured
 * (the SDK simply isn't initialised), but the page still renders.
 */
export default function DebugSentryPage() {
  const [sent, setSent] = useState(false);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col gap-4 pt-6">
          <div>
            <div className="text-lg font-bold text-slate-900">Sentry test (internal)</div>
            <p className="mt-1 text-sm text-slate-500">
              Use these to confirm Sentry receives errors from this app.
            </p>
          </div>
          <Button
            onClick={() => {
              Sentry.captureException(new Error('Sentry test error (internal, captured)'));
              setSent(true);
            }}
          >
            Capture handled error
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              throw new Error('Sentry test error (internal, thrown)');
            }}
          >
            Throw unhandled error
          </Button>
          {sent ? <p className="text-sm text-slate-900">Captured — check your Sentry project.</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
