'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { SendHorizonal } from 'lucide-react';
import { Button, Input, LoadingState } from '@rademics/ui';
import { apiFetch, ApiError } from '@/lib/api';
import { useMe } from '@/lib/me-context';
import { connectPresence } from '@/lib/socket';

interface ChatMessage {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string } | null;
}

function initials(name: string): string {
  const parts = name
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '·';
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return time;
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  if (d.getFullYear() !== today.getFullYear()) opts.year = 'numeric';
  return `${d.toLocaleDateString(undefined, opts)}, ${time}`;
}

interface ActivePerson {
  id: string;
  name: string;
}

export default function ChatPage() {
  const me = useMe();
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [active, setActive] = useState<ActivePerson[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const markRead = useCallback(() => {
    apiFetch('/chat/read', { method: 'POST', body: '{}' }).catch(() => undefined);
  }, []);

  // Who's active = who is checked in for work right now (same definition the
  // dashboard uses). Refreshed live on every check-in/out event.
  const loadActive = useCallback(() => {
    apiFetch<ActivePerson[]>('/chat/active')
      .then(setActive)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void loadActive();
  }, [loadActive]);

  useEffect(() => {
    apiFetch<{ items: ChatMessage[]; hasMore: boolean }>('/chat/messages')
      .then((r) => {
        setMessages(r.items);
        setHasMore(r.hasMore);
        markRead();
      })
      .catch(() => setError('Could not load the chat.'));
  }, [markRead]);

  // Live delivery. Dedupe by id: our own send appends from the POST response too.
  useEffect(() => {
    const socket = connectPresence();
    socket.on('chat:message', (m: ChatMessage) => {
      setMessages((prev) => {
        if (!prev || prev.some((x) => x.id === m.id)) return prev;
        return [...prev, m];
      });
      markRead(); // the room is open on screen — nothing here is "unread"
    });
    socket.on('presence:update', () => loadActive());
    return () => {
      socket.close();
    };
  }, [markRead, loadActive]);

  // Keep the newest message in view unless the reader scrolled up on purpose.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  async function loadEarlier() {
    if (!messages || messages.length === 0) return;
    const el = scrollRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    try {
      const r = await apiFetch<{ items: ChatMessage[]; hasMore: boolean }>(
        `/chat/messages?before=${encodeURIComponent(messages[0]!.createdAt)}`,
      );
      setMessages((prev) => (prev ? [...r.items, ...prev] : r.items));
      setHasMore(r.hasMore);
      // Hold the reader's place instead of snapping to the top.
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - prevHeight;
      });
    } catch {
      /* the button stays; they can retry */
    }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    setError(null);
    try {
      const m = await apiFetch<ChatMessage>('/chat/messages', {
        method: 'POST',
        body: JSON.stringify({ body }),
      });
      setDraft('');
      stickToBottom.current = true;
      setMessages((prev) => {
        if (!prev || prev.some((x) => x.id === m.id)) return prev;
        return [...prev, m];
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send — try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!messages && !error) return <LoadingState />;

  return (
    <div className="mx-auto flex h-[calc(100vh-7.5rem)] max-w-3xl flex-col">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Chat</h1>
          <p className="mt-1 text-sm text-slate-500">The company room — everyone on staff is here.</p>
        </div>
        {/* Active = checked in for work right now, live-updated on check-in/out. */}
        <div className="flex items-center gap-2">
          {active.length === 0 ? (
            <span className="text-xs text-slate-400">Nobody is checked in right now</span>
          ) : (
            <>
              <div className="flex -space-x-1.5">
                {active.slice(0, 6).map((p) => (
                  <span
                    key={p.id}
                    title={p.id === me.id ? `${p.name} (you)` : p.name}
                    className="relative inline-flex h-7 w-7 items-center justify-center rounded-full bg-accent/10 text-[11px] font-semibold text-accent ring-2 ring-white"
                  >
                    {initials(p.name)}
                    <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-success ring-2 ring-white" />
                  </span>
                ))}
              </div>
              <span className="text-xs text-slate-500">
                {active.length > 6 ? `+${active.length - 6} more · ` : ''}
                {active.length} active
              </span>
            </>
          )}
        </div>
      </div>

      <div className="mt-4 flex min-h-0 flex-1 flex-col rounded-xl border border-white/70 bg-white/60 shadow-glass backdrop-blur-xl">
        <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto p-4">
          {hasMore ? (
            <div className="mb-3 flex justify-center">
              <Button size="sm" variant="ghost" onClick={() => void loadEarlier()}>
                Load earlier messages
              </Button>
            </div>
          ) : null}
          {messages && messages.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">
              Nothing here yet — say hello, everyone will see it.
            </p>
          ) : null}
          <ul className="flex flex-col gap-3">
            {(messages ?? []).map((m) => {
              const mine = m.author?.id === me.id;
              const name = m.author?.name ?? 'Someone';
              return (
                <li key={m.id} className="flex items-start gap-2.5">
                  <span
                    className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                      mine ? 'bg-accent text-accent-foreground' : 'bg-accent/10 text-accent'
                    }`}
                  >
                    {initials(name)}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-medium text-slate-800">{mine ? 'You' : name}</span>
                      <span className="text-[11px] text-slate-400" title={new Date(m.createdAt).toLocaleString()}>
                        {timeLabel(m.createdAt)}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{m.body}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <form onSubmit={send} className="flex items-center gap-2 border-t border-slate-100 p-3">
          <Input
            autoFocus
            placeholder="Write a message…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={2000}
          />
          <Button type="submit" size="sm" disabled={busy || !draft.trim()} aria-label="Send message">
            <SendHorizonal className="h-4 w-4" />
          </Button>
        </form>
      </div>
      {error ? <p className="mt-2 text-sm font-medium text-red-600">{error}</p> : null}
    </div>
  );
}
