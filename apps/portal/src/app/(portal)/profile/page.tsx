'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@rademics/ui';
import { apiFetch, type Me } from '@/lib/api';

export default function ProfilePage() {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    apiFetch<Me>('/auth/me').then(setMe).catch(() => undefined);
  }, []);

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-800">Profile</h1>
      <Card className="mt-4 max-w-md">
        <CardHeader><CardTitle>Account</CardTitle></CardHeader>
        <CardContent>
          <dl className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between"><dt className="text-slate-400">Email</dt><dd className="text-slate-700">{me?.email ?? '—'}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-400">Role</dt><dd className="text-slate-700">Client</dd></div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
