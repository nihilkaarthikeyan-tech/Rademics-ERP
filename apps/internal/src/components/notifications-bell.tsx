'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { connectPresence } from '@/lib/socket';

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  entityType: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
}

/** Notifications bell (Spec §5.12): unread badge + dropdown, real-time via socket. */
export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const [list, count] = await Promise.all([
        apiFetch<Notification[]>('/notifications'),
        apiFetch<{ count: number }>('/notifications/unread-count'),
      ]);
      setItems(list);
      setUnread(count.count);
    } catch {
      /* silent — bell is non-critical */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Real-time: the presence socket delivers 'notification' events to this user's room.
  useEffect(() => {
    const socket = connectPresence();
    socket.on('notification', (n: Notification) => {
      setItems((prev) => [{ ...n, readAt: null }, ...prev].slice(0, 100));
      setUnread((u) => u + 1);
    });
    return () => {
      socket.close();
    };
  }, []);

  // Close on outside click.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  async function markAllRead() {
    await apiFetch('/notifications/read-all', { method: 'POST', body: '{}' }).catch(() => undefined);
    setItems((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
    setUnread(0);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-md text-slate-500 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <Bell className="h-5 w-5" />
        {unread > 0 ? (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-slate-900 px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-80 rounded-2xl border border-white/70 bg-white/85 shadow-glass backdrop-blur-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <span className="text-sm font-semibold text-slate-700">Notifications</span>
            {unread > 0 ? (
              <button onClick={markAllRead} className="text-xs text-accent hover:underline">
                Mark all read
              </button>
            ) : null}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-slate-400">You&apos;re all caught up.</p>
            ) : (
              <ul className="divide-y divide-slate-50">
                {items.map((n) => (
                  <li key={n.id} className={n.readAt ? 'px-3 py-2.5' : 'bg-slate-100 px-3 py-2.5'}>
                    <div className="text-sm font-medium text-slate-700">{n.title}</div>
                    {n.body ? <div className="text-xs text-slate-500">{n.body}</div> : null}
                    <div className="mt-0.5 text-[11px] text-slate-400">
                      {new Date(n.createdAt).toLocaleString()}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
