'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { useMe } from '@/lib/me-context';
import { connectPresence } from '@/lib/socket';

interface Person {
  id: string;
  name: string;
}

/** How many faces fit on the card before the rest fold into "+N". */
const SHOWN = 7;

function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '·';
}

/** "Sid, Devi S and 9 others" — the first names, then a count. */
function summary(list: Person[], meId: string): string {
  const names = list.map((p) => (p.id === meId ? 'You' : p.name));
  if (names.length <= 2) return names.join(' and ');
  const rest = names.length - 2;
  return `${names[0]}, ${names[1]} and ${rest} other${rest === 1 ? '' : 's'}`;
}

/**
 * Who is online right now: everyone checked in for work (the same people the
 * chat shows as active). Compact: a row of faces with the full list one click
 * away. Visible to all staff; refreshes live on every check-in and check-out.
 */
export function OnlineNow() {
  const me = useMe();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const list = people ?? [];
  const extra = list.length - SHOWN;

  return (
    <section ref={ref} className="glass-panel animate-rise relative flex h-full flex-col p-5" aria-labelledby="online-now-title">
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
        <>
          <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="People online">
            {list.slice(0, SHOWN).map((p) => (
              <li key={p.id} title={p.id === me.id ? `${p.name} (you)` : p.name}>
                <span className="relative inline-flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent">
                  {initials(p.name)}
                  <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-success ring-2 ring-white" />
                </span>
              </li>
            ))}
            {extra > 0 ? (
              <li>
                <button
                  onClick={() => setOpen(true)}
                  title="See everyone online"
                  className="inline-flex h-8 min-w-8 items-center justify-center rounded-full bg-slate-100 px-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-200"
                >
                  +{extra}
                </button>
              </li>
            ) : null}
          </ul>
          <p className="mt-2 truncate text-xs text-slate-500">{summary(list, me.id)}</p>
        </>
      )}

      <div className="mt-auto flex items-center gap-4 pt-2 text-xs font-medium">
        {list.length > 0 ? (
          <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="text-accent hover:underline">
            See all
          </button>
        ) : null}
        <Link href="/chat" className="text-slate-500 hover:text-accent hover:underline">
          Message someone
        </Link>
      </div>

      {open ? (
        <div
          role="dialog"
          aria-label="Everyone online now"
          className="absolute right-0 top-full z-20 mt-2 w-72 rounded-lg border border-slate-200 bg-white p-2 shadow-lg"
        >
          <p className="px-2 pb-1 pt-1 text-xs font-semibold text-slate-500">{list.length} online now</p>
          <ul className="max-h-72 overflow-y-auto">
            {list.map((p) => (
              <li key={p.id} className="flex items-center gap-3 rounded-md px-2 py-1.5">
                <span className="relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[10px] font-semibold text-accent">
                  {initials(p.name)}
                  <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-success ring-2 ring-white" />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-slate-700">
                  {p.name}
                  {p.id === me.id ? <span className="text-slate-400"> (you)</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
