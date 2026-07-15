'use client';

import Link from 'next/link';
import { Card, CardContent, EmptyState } from '@rademics/ui';

// Catch-all for unknown in-app paths: a friendly dead end instead of a hard 404,
// since users may follow stale bookmarks or mistyped URLs.
export default function NotFoundCatchAll() {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-xl font-semibold text-slate-800">Page not found</h1>
      <Card className="mt-4">
        <CardContent className="pt-6">
          <EmptyState
            title="Nothing lives at this address"
            description="The page may have moved. Use the sidebar to find what you need."
          />
          <p className="mt-4 text-center text-sm">
            <Link href="/dashboard" className="text-slate-600 underline hover:text-slate-900">
              Back to dashboard
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
