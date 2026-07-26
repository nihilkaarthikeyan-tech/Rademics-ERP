'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
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
  const router = useRouter();
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

  /**
   * A notification is a doorway, not a note: clicking one opens the thing it is
   * about (and marks just that one read). Task notifications carry the task id;
   * the project page opens the task panel from its ?task= query param.
   */
  async function openNotification(n: Notification) {
    if (!n.readAt) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
      setUnread((u) => Math.max(0, u - 1));
      apiFetch(`/notifications/${n.id}/read`, { method: 'POST', body: '{}' }).catch(() => undefined);
    }
    if (n.entityType === 'Task' && n.entityId) {
      setOpen(false);
      try {
        const task = await apiFetch<{ project: { id: string } }>(`/tasks/${n.entityId}`);
        router.push(`/projects/${task.project.id}?task=${n.entityId}`);
      } catch {
        // Task gone or no longer accessible — My Work is the safe landing.
        router.push('/my-work');
      }
    }
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
          // Accent, not near-black: the badge must catch the eye from across
          // the screen — it is how assigned work gets noticed at all.
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-foreground">
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
                {items.map((n) => {
                  const clickable = n.entityType === 'Task' && n.entityId;
                  return (
                    <li key={n.id}>
                      <button
                        onClick={() => void openNotification(n)}
                        disabled={!clickable && Boolean(n.readAt)}
                        className={`w-full text-left ${n.readAt ? '' : 'bg-slate-100'} px-3 py-2.5 ${
                          clickable ? 'cursor-pointer hover:bg-accent-soft/60' : 'cursor-default'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-sm font-medium text-slate-700">{n.title}</span>
                          {!n.readAt ? (
                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-label="Unread" />
                          ) : null}
                        </div>
                        {n.body ? <div className="text-xs text-slate-500">{n.body}</div> : null}
                        <div className="mt-0.5 flex items-center justify-between text-[11px] text-slate-400">
                          <span>{new Date(n.createdAt).toLocaleString()}</span>
                          {clickable ? <span className="text-accent">Open task →</span> : null}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
