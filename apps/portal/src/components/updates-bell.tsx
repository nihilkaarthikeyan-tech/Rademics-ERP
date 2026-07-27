'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useAutoRefresh } from '@/lib/use-auto-refresh';

interface PortalNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
  readAt: string | null;
}

function relTime(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/**
 * The client's inbox.
 *
 * Correspondence with the team lives in the portal rather than in email, so
 * there has to be somewhere it visibly arrives — otherwise an update posted by
 * staff is only discovered by opening the right project and expanding the right
 * task, which is no way to be told something.
 *
 * Unread count sits on the icon so it is answerable at a glance from any page.
 */
export function UpdatesBell() {
  const [items, setItems] = useState<PortalNotification[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setItems(await apiFetch<PortalNotification[]>('/notifications'));
    } catch {
      /* a failed poll is not worth surfacing — the next one will do */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useAutoRefresh(load, { intervalMs: 20_000 });

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const unread = items.filter((n) => !n.readAt).length;

  async function openPanel() {
    const next = !open;
    setOpen(next);
    // Opening the panel IS reading them — the client has now seen every line.
    if (next && unread > 0) {
      setItems((prev) => prev.map((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() })));
      await apiFetch('/notifications/read-all', { method: 'POST', body: '{}' }).catch(() => undefined);
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => void openPanel()}
        aria-label={unread > 0 ? `Updates, ${unread} unread` : 'Updates'}
        aria-expanded={open}
        className="relative rounded-md p-1.5 text-slate-400 hover:bg-white/60 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#7C6CF6] px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-20 mt-2 w-80 overflow-hidden rounded-xl border border-white/70 bg-white/95 shadow-glass backdrop-blur-xl">
          <div className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-800">
            Updates
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-400">
              Nothing yet. Updates from your project team appear here.
            </p>
          ) : (
            <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
              {items.map((n) => (
                <li key={n.id} className="px-4 py-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium text-slate-800">{n.title}</span>
                    <span className="shrink-0 text-xs text-slate-400">{relTime(n.createdAt)}</span>
                  </div>
                  {n.body ? (
                    <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-slate-600">{n.body}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
