'use client';

import { useEffect, useState } from 'react';
import { apiFetch, type Me } from '@/lib/api';

export default function ProfilePage() {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    apiFetch<Me>('/auth/me').then(setMe).catch(() => undefined);
  }, []);

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">Profile</h1>
      <p className="mt-1 text-sm text-slate-500">Your account details.</p>

      <div className="mt-6 max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-slate-100 text-lg font-semibold text-slate-700">
            {me?.email.slice(0, 1).toUpperCase() ?? '—'}
          </span>
          <div>
            <div className="font-semibold text-slate-900">{me?.email ?? 'Loading…'}</div>
            <div className="text-xs uppercase tracking-wide text-slate-400">Client account</div>
          </div>
        </div>
        <dl className="mt-6 flex flex-col gap-3 border-t border-slate-100 pt-4 text-sm">
          <div className="flex justify-between"><dt className="text-slate-400">Email</dt><dd className="font-medium text-slate-700">{me?.email ?? '—'}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-400">Role</dt><dd className="font-medium text-slate-700">Client</dd></div>
        </dl>
      </div>
    </div>
  );
}
