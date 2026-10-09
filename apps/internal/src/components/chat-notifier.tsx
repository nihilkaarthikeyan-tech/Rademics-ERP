'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { useMe } from '@/lib/me-context';
import { connectPresence } from '@/lib/socket';
import { MUTE_EVENT, isViewing, plainText, playChime, popupsEnabled, soundEnabled } from '@/lib/chat-alerts';

interface RoomInfo {
  id: string;
  kind: 'COMPANY' | 'GROUP' | 'DIRECT';
  name: string;
  muted: boolean;
}

interface IncomingMessage {
  id: string;
  roomId?: string;
  body: string;
  author: { id: string; name: string } | null;
  files: unknown[];
}

const TITLE_COUNT = /^\(\d+\+?\) /;

/**
 * Lets people know about a chat message while the website is open on any page:
 * a soft chime, a browser pop-up when this tab isn't the one being looked at,
 * and the unread count in the tab title — "(3) Rademics ERP". Muted
 * conversations stay quiet unless the message @mentions you. Renders nothing.
 */
export function ChatNotifier() {
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);
  const rooms = useRef(new Map<string, RoomInfo>());
  const myName = useRef<string | null>(null);

  const loadRooms = useCallback(async () => {
    try {
      const list = await apiFetch<RoomInfo[]>('/chat/rooms');
      rooms.current = new Map(list.map((r) => [r.id, r]));
    } catch {
      /* alerts fall back to generic wording */
    }
  }, []);

  const loadUnread = useCallback(async () => {
    try {
      setUnread((await apiFetch<{ count: number }>('/chat/unread-count')).count);
    } catch {
      /* keep the last count */
    }
  }, []);

  useEffect(() => {
    void loadRooms();
    void loadUnread();
    apiFetch<{ id: string; name: string }[]>('/chat/members')
      .then((people) => {
        myName.current = people.find((p) => p.id === me.id)?.name ?? null;
      })
      .catch(() => undefined);
  }, [loadRooms, loadUnread, me.id]);

  useEffect(() => {
    const socket = connectPresence();
    let t: ReturnType<typeof setTimeout> | undefined;
    // Give an open chat page a moment to mark the message read first.
    const recount = () => {
      clearTimeout(t);
      t = setTimeout(() => void loadUnread(), 700);
    };

    socket.on('chat:message', async (m: IncomingMessage) => {
      if (!m.author || m.author.id === me.id) return;
      recount();
      if (m.roomId && !rooms.current.has(m.roomId)) await loadRooms();
      const room = m.roomId ? rooms.current.get(m.roomId) : undefined;
      const mentioned = Boolean(myName.current && m.body.includes(`@${myName.current}`));
      if (room?.muted && !mentioned) return;
      if (isViewing(m.roomId)) return;

      if (soundEnabled()) playChime();
      if (popupsEnabled() && (document.hidden || !document.hasFocus())) {
        const author = m.author.name;
        const title = mentioned
          ? `${author} mentioned you${room && room.kind !== 'DIRECT' ? ` in ${room.name}` : ''}`
          : !room || room.kind === 'DIRECT'
            ? author
            : `${author} in ${room.name}`;
        const text = plainText(m.body) || (m.files.length > 0 ? 'Sent a file' : 'New message');
        try {
          const note = new Notification(title, { body: text.slice(0, 180), icon: '/icon.png', tag: m.roomId });
          note.onclick = () => {
            window.focus();
            router.push(`/chat?room=${m.roomId}&message=${m.id}`);
            note.close();
          };
        } catch {
          /* some browsers only allow pop-ups from a service worker */
        }
      }
    });
    socket.on('chat:read', ({ userId }: { userId: string }) => {
      if (userId === me.id) recount(); // read in another tab or the desktop app
    });
    socket.on('chat:messageDeleted', recount);
    socket.on('chat:roomsChanged', () => void loadRooms());

    const onMuted = () => {
      void loadRooms();
      recount();
    };
    window.addEventListener(MUTE_EVENT, onMuted);
    return () => {
      clearTimeout(t);
      window.removeEventListener(MUTE_EVENT, onMuted);
      socket.close();
    };
  }, [loadRooms, loadUnread, me.id, router]);

  // "(3) Rademics ERP" — re-applied after each navigation, which resets the title.
  useEffect(() => {
    const apply = () => {
      const base = document.title.replace(TITLE_COUNT, '');
      const next = unread > 0 ? `(${unread > 99 ? '99+' : unread}) ${base}` : base;
      if (document.title !== next) document.title = next;
    };
    apply();
    const t = setTimeout(apply, 300);
    return () => clearTimeout(t);
  }, [unread, pathname]);

  return null;
}
