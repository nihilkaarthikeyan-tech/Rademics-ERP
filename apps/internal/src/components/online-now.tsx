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

/** The name under a face: the first word, or initials-only names kept whole ("S Dharun"). */
function shortName(name: string): string {
  const words = name.trim().split(/\s+/);
  return words[0] && words[0].length > 1 ? words[0] : words.slice(0, 2).join(' ');
}

/**
 * Who is online right now: everyone checked in for work (the same people the
 * chat shows as active). One row of faces with first names that scrolls
 * sideways when it is longer than the card, so the card never grows and
 * nothing floats over the rest of the page. Visible to all staff; refreshes
 * live on every check-in and check-out.
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
    <section className="glass-panel animate-rise flex h-full min-w-0 flex-col p-5" aria-labelledby="online-now-title">
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
        <ul
          className="scrollbar-slim -mx-1 mt-2.5 flex gap-1 overflow-x-auto px-1 pb-1"
          aria-label={`${list.length} people online`}
          tabIndex={0}
        >
          {list.map((p) => (
            <li
              key={p.id}
              title={p.id === me.id ? `${p.name} (you)` : p.name}
              className="flex w-14 shrink-0 flex-col items-center gap-0.5 text-center"
            >
              <span className="relative inline-flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent">
                {initials(p.name)}
                <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-success ring-2 ring-white" />
              </span>
              <span className="w-full truncate text-[11px] leading-tight text-slate-600">
                {p.id === me.id ? 'You' : shortName(p.name)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-auto pt-1.5 text-xs font-medium">
        <Link href="/chat" className="text-accent hover:underline">
          Message someone in Chat
        </Link>
      </div>
    </section>
  );
}
