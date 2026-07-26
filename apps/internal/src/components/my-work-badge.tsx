'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { connectPresence } from '@/lib/socket';

interface MineResponse {
  items: { status: string }[];
}

/** Statuses that still need something from the person — matches My Work's "open". */
const DONE = ['COMPLETED'];

/**
 * Live count pill on the "My Work" nav item. Work assigned to you must be
 * visible from anywhere in the app, not only if you think to open the bell —
 * an unnoticed task is a stalled workflow (assignment sits at ASSIGNED until
 * the person accepts). Refreshes on notification push and on navigation.
 */
export function MyWorkBadge() {
  const pathname = usePathname();
  const [count, setCount] = useState(0);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<MineResponse>('/tasks/mine');
      setCount(r.items.filter((t) => !DONE.includes(t.status)).length);
    } catch {
      /* silent — the badge is non-critical */
    }
  }, []);

  // Navigation is the natural refresh point (e.g. after accepting a task).
  useEffect(() => {
    void load();
  }, [load, pathname]);

  // Real-time: any pushed notification may mean new work — recount.
  useEffect(() => {
    const socket = connectPresence();
    socket.on('notification', () => void load());
    return () => {
      socket.close();
    };
  }, [load]);

  if (count === 0) return null;
  return (
    <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-foreground">
      {count > 9 ? '9+' : count}
    </span>
  );
}
