'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { connectPresence, onReconnect } from '@/lib/socket';

/**
 * Unread pill on the "Chat" nav item. Hidden while the room itself is open —
 * being in the room IS reading it (the page marks read continuously).
 */
export function ChatBadge() {
  const pathname = usePathname();
  const [count, setCount] = useState(0);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<{ count: number }>('/chat/unread-count');
      setCount(r.count);
    } catch {
      /* silent — the badge is non-critical */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, pathname]);

  useEffect(() => {
    const socket = connectPresence();
    // Small delay so the chat page's mark-read wins when the room is open.
    socket.on('chat:message', () => setTimeout(() => void load(), 600));
    // Messages that arrived while the socket was down never fired the event above.
    onReconnect(socket, () => void load());
    return () => {
      socket.close();
    };
  }, [load]);

  if (count === 0 || pathname === '/chat') return null;
  return (
    <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-foreground">
      {count > 9 ? '9+' : count}
    </span>
  );
}
