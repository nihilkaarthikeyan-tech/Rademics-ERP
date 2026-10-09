'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { useMe } from '@/lib/me-context';
import { connectPresence } from '@/lib/socket';

interface Person {
  id: string;
  name: string;
}

function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '·';
}

/**
 * Who is online right now: everyone checked in for work (the same people the
 * chat shows as active). Visible to all staff; refreshes live on every
 * check-in and check-out.
 */
export function OnlineNow() {
  const me = useMe();
  const [people, setPeople] = useState<Person[] | null>(null);

  const load = useCallback(() => {
    apiFetch<Person[]>('/chat/active')
      .then(setPeople)
      .catch(() => setPeople((prev) => prev ?? []));
  }, []);

  useEffect(() => {
    load();
    const socket = connectPresence();
    socket.on('presence:update', load);
    return () => {
      socket.close();
    };
  }, [load]);

  const list = people ?? [];
  return (
    <section className="glass-panel animate-rise p-5" aria-labelledby="online-now-title">
      <div className="flex items-center justify-between gap-3">
        <h2 id="online-now-title" className="flex items-center gap-2 text-[15px] font-semibold text-slate-900">
          <span className="h-2 w-2 rounded-full bg-success" aria-hidden />
          Online now
        </h2>
        <span className="text-sm font-semibold tabular-nums text-[#1B2A4A]">{people ? list.length : '…'}</span>
      </div>

      {people === null ? (
        <p className="mt-4 text-sm text-slate-400">Loading…</p>
      ) : list.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">Nobody is checked in right now.</p>
      ) : (
        <ul className="mt-4 grid max-h-64 gap-1 overflow-y-auto pr-1">
          {list.map((p) => (
            <li key={p.id} className="flex items-center gap-3 rounded-md px-1.5 py-1.5">
              <span className="relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent">
                {initials(p.name)}
                <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-success ring-2 ring-white" />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-slate-700">
                {p.name}
                {p.id === me.id ? <span className="text-slate-400"> (you)</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Link href="/chat" className="mt-3 inline-block text-xs font-medium text-accent hover:underline">
        Message someone in Chat
      </Link>
    </section>
  );
}
