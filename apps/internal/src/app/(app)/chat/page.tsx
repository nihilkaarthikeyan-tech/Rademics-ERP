'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check,
  Download,
  FileText,
  Loader2,
  MessagesSquare,
  Paperclip,
  Pencil,
  Pin,
  PinOff,
  SendHorizonal,
  ShieldAlert,
  ShieldCheck,
  SmilePlus,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { Button, LoadingState } from '@rademics/ui';
import { apiFetch, ApiError } from '@/lib/api';
import { useMe } from '@/lib/me-context';
import { connectPresence } from '@/lib/socket';

interface Attachment {
  id: string;
  versionId: string;
  name: string;
  sizeBytes: number | null;
  contentType: string | null;
  scanStatus: 'PENDING' | 'SCANNING' | 'AVAILABLE' | 'INFECTED' | 'ERROR';
}

interface Reaction {
  emoji: string;
  userId: string;
  userName: string;
}

interface ChatMessage {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string } | null;
  files: Attachment[];
  reactions: Reaction[];
  edited: boolean;
  pinned: boolean;
  deleted: boolean;
}

/** Matches the API's CAN_MODERATE — HR/Super Admin may remove ANYONE's message. */
const CAN_MODERATE = ['SUPER_ADMIN', 'HR'];

/** Must match the API's REACTION_EMOJI whitelist. */
const REACTION_EMOJI = ['👍', '❤️', '😂', '🎉', '👏', '😮', '😢', '🙏'];

/** Mirrors the API's edit window so the button hides when a PATCH would fail. */
const EDIT_WINDOW_MS = 15 * 60 * 1000;

/** How long "X is typing…" stays up after their last keystroke reached us. */
const TYPING_TTL_MS = 3500;

interface ActivePerson {
  id: string;
  name: string;
}

/** A file picked but not yet sent — lives only in the composer. */
interface PendingFile {
  key: string;
  name: string;
  fileAssetId?: string;
  versionId?: string;
  state: 'uploading' | 'ready' | 'failed';
}

function initials(name: string): string {
  const parts = name
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '·';
}

function fmtSize(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** "Today" / "Yesterday" / "12 Mar" — the divider between days of conversation. */
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  if (d.getFullYear() !== today.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
}

const GROUP_WINDOW_MS = 5 * 60 * 1000;

function isImage(a: Attachment): boolean {
  return Boolean(a.contentType?.startsWith('image/'));
}

/** Collapse raw reactions into one chip per emoji: count, names, whether mine. */
function groupReactions(reactions: Reaction[], meId: string) {
  const map = new Map<string, { emoji: string; count: number; mine: boolean; names: string[] }>();
  for (const r of reactions) {
    const g = map.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false, names: [] };
    g.count += 1;
    if (r.userId === meId) g.mine = true;
    g.names.push(r.userName);
    map.set(r.emoji, g);
  }
  return [...map.values()];
}

export default function ChatPage() {
  const me = useMe();
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [active, setActive] = useState<ActivePerson[]>([]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [members, setMembers] = useState<ActivePerson[]>([]);
  const [pinnedMsgs, setPinnedMsgs] = useState<ChatMessage[]>([]);
  const [typing, setTyping] = useState<Record<string, { name: string; at: number }>>({});
  const [reactForId, setReactForId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stickToBottom = useRef(true);
  const socketRef = useRef<ReturnType<typeof connectPresence> | null>(null);
  const lastTypingSentAt = useRef(0);
  // The read pointer AS OF page load — the anchor for the "new messages" line.
  // Never updated afterwards: the line marks where you left off, then fades on
  // the next visit (by which time the room was already marked read).
  const initialLastReadAt = useRef<string | null>(null);

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
    apiFetch<{ items: ChatMessage[]; hasMore: boolean; lastReadAt: string | null }>('/chat/messages')
      .then((r) => {
        initialLastReadAt.current = r.lastReadAt;
        setMessages(r.items);
        setHasMore(r.hasMore);
        markRead();
      })
      .catch(() => setError('Could not load the chat.'));
    // Staff directory (mentions) + pinned announcements load alongside history.
    apiFetch<ActivePerson[]>('/chat/members').then(setMembers).catch(() => undefined);
    apiFetch<ChatMessage[]>('/chat/pinned').then(setPinnedMsgs).catch(() => undefined);
  }, [markRead]);

  // Live delivery. Dedupe by id: our own send appends from the POST response too.
  useEffect(() => {
    const socket = connectPresence();
    socketRef.current = socket;
    socket.on('chat:message', (m: ChatMessage) => {
      setMessages((prev) => {
        if (!prev || prev.some((x) => x.id === m.id)) return prev;
        return [...prev, m];
      });
      // Their message arrived — they are no longer "typing".
      const authorId = m.author?.id;
      if (authorId) {
        setTyping((prev) => {
          if (!prev[authorId]) return prev;
          const next = { ...prev };
          delete next[authorId];
          return next;
        });
      }
      markRead(); // the room is open on screen — nothing here is "unread"
    });
    socket.on('presence:update', () => loadActive());
    socket.on('chat:messageDeleted', ({ id }: { id: string }) => {
      // Live for every open room, not just the person who clicked delete —
      // becomes a quiet tombstone rather than vanishing (which would look
      // like a rendering glitch to anyone mid-read).
      setMessages((prev) =>
        prev
          ? prev.map((m) =>
              m.id === id ? { ...m, deleted: true, body: '', files: [], reactions: [], pinned: false } : m,
            )
          : prev,
      );
      setPinnedMsgs((prev) => prev.filter((p) => p.id !== id));
    });
    socket.on('chat:messageEdited', (m: ChatMessage) => {
      setMessages((prev) => (prev ? prev.map((x) => (x.id === m.id ? m : x)) : prev));
      setPinnedMsgs((prev) => prev.map((p) => (p.id === m.id ? m : p)));
    });
    socket.on('chat:reactions', ({ id, reactions }: { id: string; reactions: Reaction[] }) => {
      setMessages((prev) => (prev ? prev.map((m) => (m.id === id ? { ...m, reactions } : m)) : prev));
    });
    socket.on('chat:pinned', (m: ChatMessage) => {
      setPinnedMsgs((prev) => [m, ...prev.filter((p) => p.id !== m.id)]);
      setMessages((prev) => (prev ? prev.map((x) => (x.id === m.id ? { ...x, pinned: true } : x)) : prev));
    });
    socket.on('chat:unpinned', ({ id }: { id: string }) => {
      setPinnedMsgs((prev) => prev.filter((p) => p.id !== id));
      setMessages((prev) => (prev ? prev.map((x) => (x.id === id ? { ...x, pinned: false } : x)) : prev));
    });
    socket.on('chat:typing', ({ userId, name }: { userId: string; name: string }) => {
      setTyping((prev) => ({ ...prev, [userId]: { name: name || 'Someone', at: Date.now() } }));
    });
    return () => {
      socketRef.current = null;
      socket.close();
    };
  }, [markRead, loadActive]);

  // Sweep out stale typing entries (someone typed, then walked away).
  useEffect(() => {
    if (Object.keys(typing).length === 0) return;
    const t = setInterval(() => {
      setTyping((prev) => {
        const now = Date.now();
        const next = Object.fromEntries(Object.entries(prev).filter(([, v]) => now - v.at < TYPING_TTL_MS));
        return Object.keys(next).length === Object.keys(prev).length ? prev : next;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [typing]);

  // Keep the newest message in view unless the reader scrolled up on purpose.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Resolve presigned URLs for image attachments so they preview inline.
  useEffect(() => {
    if (!messages) return;
    const wanted = messages
      .flatMap((m) => m.files)
      .filter((f) => isImage(f) && f.scanStatus === 'AVAILABLE' && !imageUrls[f.versionId]);
    if (wanted.length === 0) return;
    let cancelled = false;
    void Promise.all(
      wanted.map((f) =>
        apiFetch<{ url: string }>(`/chat/attachments/${f.versionId}/download?inline=true`)
          .then((r) => [f.versionId, r.url] as const)
          .catch(() => null),
      ),
    ).then((pairs) => {
      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const p of pairs) if (p) next[p[0]] = p[1];
      if (Object.keys(next).length) setImageUrls((prev) => ({ ...prev, ...next }));
    });
    return () => {
      cancelled = true;
    };
  }, [messages, imageUrls]);

  // Poll while any visible attachment is still being scanned.
  useEffect(() => {
    const scanning = (messages ?? [])
      .flatMap((m) => m.files)
      .some((f) => f.scanStatus === 'PENDING' || f.scanStatus === 'SCANNING');
    if (!scanning) return;
    const t = setInterval(() => {
      apiFetch<{ items: ChatMessage[]; hasMore: boolean }>('/chat/messages')
        .then((r) => setMessages((prev) => (prev && prev.length > r.items.length ? prev : r.items)))
        .catch(() => undefined);
    }, 2500);
    return () => clearInterval(t);
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

  /** Upload starts the moment a file is picked, so sending is instant. */
  async function attach(files: FileList) {
    setError(null);
    for (const file of Array.from(files).slice(0, 10)) {
      const key = `${file.name}-${Date.now()}-${Math.round(performance.now())}`;
      setPending((prev) => [...prev, { key, name: file.name, state: 'uploading' }]);
      try {
        const init = await apiFetch<{ fileAssetId: string; versionId: string; uploadUrl: string }>(
          '/chat/attachments/init',
          {
            method: 'POST',
            body: JSON.stringify({
              filename: file.name,
              contentType: file.type || 'application/octet-stream',
              sizeBytes: file.size,
            }),
          },
        );
        const put = await fetch(init.uploadUrl, { method: 'PUT', body: file });
        if (!put.ok) throw new Error('Upload to storage failed');
        await apiFetch(`/chat/attachments/${init.versionId}/finalize`, { method: 'POST', body: '{}' });
        setPending((prev) =>
          prev.map((p) =>
            p.key === key ? { ...p, fileAssetId: init.fileAssetId, versionId: init.versionId, state: 'ready' } : p,
          ),
        );
      } catch (err) {
        setPending((prev) => prev.map((p) => (p.key === key ? { ...p, state: 'failed' } : p)));
        setError(err instanceof ApiError ? err.message : `Could not attach ${file.name}`);
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function deleteMessage(id: string) {
    setError(null);
    try {
      await apiFetch(`/chat/messages/${id}`, { method: 'DELETE' });
      setConfirmDeleteId(null);
      // The socket echo also does this for us, but resolving locally means
      // it settles the instant the request succeeds, not after a round trip.
      setMessages((prev) =>
        prev ? prev.map((m) => (m.id === id ? { ...m, deleted: true, body: '', files: [] } : m)) : prev,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete that message.');
    }
  }

  /** Images open for viewing (inline); everything else prompts to save. */
  async function download(versionId: string, inline = false) {
    try {
      const { url } = await apiFetch<{ url: string }>(
        `/chat/attachments/${versionId}/download${inline ? '?inline=true' : ''}`,
      );
      window.open(url, '_blank');
    } catch {
      setError('Could not open that file.');
    }
  }

  /** Toggle an emoji on a message. The socket echo updates everyone else. */
  async function react(messageId: string, emoji: string) {
    setReactForId(null);
    try {
      const r = await apiFetch<{ id: string; reactions: Reaction[] }>(`/chat/messages/${messageId}/reactions`, {
        method: 'POST',
        body: JSON.stringify({ emoji }),
      });
      setMessages((prev) => (prev ? prev.map((m) => (m.id === r.id ? { ...m, reactions: r.reactions } : m)) : prev));
    } catch {
      setError('Could not react to that message.');
    }
  }

  function startEdit(m: ChatMessage) {
    setEditingId(m.id);
    setEditDraft(m.body);
  }

  async function saveEdit() {
    if (!editingId || !editDraft.trim()) return;
    try {
      const updated = await apiFetch<ChatMessage>(`/chat/messages/${editingId}`, {
        method: 'PATCH',
        body: JSON.stringify({ body: editDraft.trim() }),
      });
      setMessages((prev) => (prev ? prev.map((m) => (m.id === updated.id ? updated : m)) : prev));
      setEditingId(null);
      setEditDraft('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the edit.');
    }
  }

  async function togglePin(m: ChatMessage) {
    try {
      await apiFetch(`/chat/messages/${m.id}/pin`, { method: m.pinned ? 'DELETE' : 'POST', body: '{}' });
      // Socket echo updates the banner + flags for everyone, including us.
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not pin that message.');
    }
  }

  /** Throttled "I'm typing" ping — at most one every 2s while keys are moving. */
  const myName = members.find((p) => p.id === me.id)?.name ?? 'Someone';
  function emitTyping() {
    const now = Date.now();
    if (now - lastTypingSentAt.current < 2000) return;
    lastTypingSentAt.current = now;
    socketRef.current?.emit('chat:typing', { name: myName });
  }

  // ── @mention autocomplete: the token being typed after the last '@' ──
  const mentionToken = (() => {
    const at = draft.lastIndexOf('@');
    if (at === -1) return null;
    const token = draft.slice(at + 1);
    if (token.length > 40 || token.includes('\n')) return null;
    return { at, token };
  })();
  const mentionMatches =
    mentionToken === null
      ? []
      : members
          .filter((p) => p.id !== me.id && p.name.toLowerCase().startsWith(mentionToken.token.toLowerCase()))
          .slice(0, 6);

  function insertMention(person: ActivePerson) {
    if (mentionToken === null) return;
    setDraft(`${draft.slice(0, mentionToken.at)}@${person.name} `);
    textareaRef.current?.focus();
  }

  /** Render a body with real @mentions highlighted (matched against staff names). */
  function renderBody(body: string) {
    if (!body.includes('@') || members.length === 0) return body;
    const names = [...members.map((p) => p.name)]
      .sort((a, b) => b.length - a.length)
      .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const re = new RegExp(`@(${names.join('|')})`, 'gi');
    const parts: React.ReactNode[] = [];
    let last = 0;
    for (let match = re.exec(body); match !== null; match = re.exec(body)) {
      if (match.index > last) parts.push(body.slice(last, match.index));
      parts.push(
        <span key={`${match.index}`} className="rounded bg-accent/10 px-1 font-medium text-accent">
          {match[0]}
        </span>,
      );
      last = match.index + match[0].length;
    }
    if (parts.length === 0) return body;
    if (last < body.length) parts.push(body.slice(last));
    return parts;
  }

  const typingNames = Object.entries(typing)
    .filter(([id]) => id !== me.id)
    .map(([, v]) => v.name);

  const readyFiles = pending.filter((p) => p.state === 'ready');
  const uploading = pending.some((p) => p.state === 'uploading');
  const canSend = (draft.trim().length > 0 || readyFiles.length > 0) && !uploading && !busy;

  async function send() {
    if (!canSend) return;
    setBusy(true);
    setError(null);
    try {
      const m = await apiFetch<ChatMessage>('/chat/messages', {
        method: 'POST',
        body: JSON.stringify({
          body: draft.trim() || undefined,
          fileAssetIds: readyFiles.map((p) => p.fileAssetId!),
        }),
      });
      setDraft('');
      setPending([]);
      stickToBottom.current = true;
      setMessages((prev) => {
        if (!prev || prev.some((x) => x.id === m.id)) return prev;
        return [...prev, m];
      });
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send — try again.');
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter is a new line — the convention everywhere.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  function autoGrow(el: HTMLTextAreaElement) {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  if (!messages && !error) return <LoadingState />;

  // The "new messages" line sits before the first message someone else sent
  // after your last visit. Anchored to page load — it doesn't chase live arrivals.
  const lastRead = initialLastReadAt.current;
  const firstUnreadId =
    lastRead && messages
      ? (messages.find(
          (m) => m.author?.id !== me.id && new Date(m.createdAt).getTime() > new Date(lastRead).getTime(),
        )?.id ?? null)
      : null;
  const isModerator = CAN_MODERATE.includes(me.role);
  const topPin = pinnedMsgs[0];

  return (
    <div className="mx-auto flex h-[calc(100dvh-6.5rem)] max-w-5xl flex-col sm:h-[calc(100vh-7.5rem)]">
      {/* Header: room identity + who is actually around */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Chat</h1>
          <p className="mt-1 text-sm text-slate-500">
            The company room — a group chat where everyone on staff reads and writes.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-white/70 bg-white/60 py-1 pl-1.5 pr-3 shadow-glass backdrop-blur-xl">
          {active.length === 0 ? (
            <span className="px-1.5 text-xs text-slate-400">Nobody checked in</span>
          ) : (
            <>
              <div className="flex -space-x-1.5">
                {active.slice(0, 5).map((p) => (
                  <span
                    key={p.id}
                    title={p.id === me.id ? `${p.name} (you)` : p.name}
                    className="relative inline-flex h-6 w-6 items-center justify-center rounded-full bg-accent/10 text-[10px] font-semibold text-accent ring-2 ring-white"
                  >
                    {initials(p.name)}
                  </span>
                ))}
              </div>
              <span className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                {active.length} active
              </span>
            </>
          )}
        </div>
      </div>

      {/* The room */}
      <div className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/70 bg-white/60 shadow-glass backdrop-blur-xl">
        {/* Pinned announcement — the newest pin leads the room. */}
        {topPin ? (
          <div className="flex items-start gap-2.5 border-b border-white/70 bg-accent/5 px-4 py-2.5">
            <Pin className="mt-1 h-3.5 w-3.5 shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-accent">
                Pinned{pinnedMsgs.length > 1 ? ` · ${pinnedMsgs.length} announcements` : ''}
              </span>
              <p className="truncate text-sm text-slate-700">
                <span className="font-medium">{topPin.author?.name ?? 'Someone'}: </span>
                {topPin.body || 'Shared a file'}
              </p>
            </div>
            {isModerator ? (
              <button
                onClick={() => void togglePin(topPin)}
                title="Unpin this announcement"
                aria-label="Unpin"
                className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-white/70 hover:text-slate-600"
              >
                <PinOff className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        ) : null}
        <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-4 py-3">
          {hasMore ? (
            <div className="mb-3 flex justify-center">
              <Button size="sm" variant="ghost" onClick={() => void loadEarlier()}>
                Load earlier messages
              </Button>
            </div>
          ) : null}

          {messages && messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-4 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10 text-accent">
                <MessagesSquare className="h-7 w-7" />
              </span>
              <h2 className="mt-4 text-lg font-semibold text-slate-800">Welcome to the company room</h2>
              <p className="mt-1 max-w-md text-sm text-slate-500">
                This is where the whole team talks. Be the first to say hello.
              </p>

              <div className="mt-8 grid w-full max-w-2xl gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-white/70 bg-white/70 p-4 text-left shadow-glass">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-accent">
                    <Users className="h-4 w-4" />
                  </span>
                  <p className="mt-2.5 text-sm font-semibold text-slate-700">One room, everyone</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">
                    Every message is visible to all staff — announcements, questions, quick coordination.
                  </p>
                </div>
                <div className="rounded-xl border border-white/70 bg-white/70 p-4 text-left shadow-glass">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-accent">
                    <Paperclip className="h-4 w-4" />
                  </span>
                  <p className="mt-2.5 text-sm font-semibold text-slate-700">Share files safely</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">
                    Drop in documents and images — every upload is virus-checked before anyone can open it.
                  </p>
                </div>
                <div className="rounded-xl border border-white/70 bg-white/70 p-4 text-left shadow-glass">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-accent">
                    <ShieldCheck className="h-4 w-4" />
                  </span>
                  <p className="mt-2.5 text-sm font-semibold text-slate-700">Keep it professional</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">
                    This is a workplace space. HR and admins can remove messages that don&apos;t belong.
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          {/* Bottom-anchored: a short conversation sits at the composer, not
              stranded at the top of an empty slab. Rendered only when there ARE
              messages — its min-h-full plus the welcome panel's h-full made the
              empty room twice the viewport tall, scrolling the welcome out of view. */}
          <ul className={messages && messages.length > 0 ? 'flex min-h-full flex-col justify-end gap-0.5' : 'hidden'}>
            {(messages ?? []).map((m, i) => {
              const prev = i > 0 ? messages![i - 1] : null;
              const mine = m.author?.id === me.id;
              const canDeleteThis = !m.deleted && (mine || CAN_MODERATE.includes(me.role));
              const name = m.author?.name ?? 'Someone';
              const newDay = !prev || dayLabel(prev.createdAt) !== dayLabel(m.createdAt);
              // Consecutive messages from one person collapse under one avatar.
              const grouped =
                !newDay &&
                prev?.author?.id === m.author?.id &&
                new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_WINDOW_MS;

              const canEditThis =
                !m.deleted && mine && Date.now() - new Date(m.createdAt).getTime() < EDIT_WINDOW_MS;

              return (
                <li key={m.id}>
                  {newDay ? (
                    <div className="my-3 flex items-center gap-3">
                      <span className="h-px flex-1 bg-slate-200" />
                      <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                        {dayLabel(m.createdAt)}
                      </span>
                      <span className="h-px flex-1 bg-slate-200" />
                    </div>
                  ) : null}

                  {m.id === firstUnreadId ? (
                    <div className="my-3 flex items-center gap-3">
                      <span className="h-px flex-1 bg-accent/40" />
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-accent">
                        New messages
                      </span>
                      <span className="h-px flex-1 bg-accent/40" />
                    </div>
                  ) : null}

                  <div
                    className={`group relative flex items-start gap-2.5 rounded-lg px-2 py-1 transition-colors hover:bg-white/70 ${
                      grouped ? '' : 'mt-2'
                    }`}
                  >
                    {grouped ? (
                      // Keeps the text aligned with the avatar column and carries
                      // the time. Always visible, never hover-only: there is no
                      // hover on a touch screen, and a time you can only reveal
                      // by pointing at it cannot be scanned down the column —
                      // which is the whole reason a timestamp is on every line.
                      <span
                        className="w-7 shrink-0 pt-0.5 text-right text-[10px] leading-5 text-slate-300"
                        title={new Date(m.createdAt).toLocaleString()}
                      >
                        {clockTime(m.createdAt)}
                      </span>
                    ) : (
                      <span
                        className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                          mine ? 'bg-accent text-accent-foreground' : 'bg-accent/10 text-accent'
                        }`}
                      >
                        {initials(name)}
                      </span>
                    )}

                    <div className="min-w-0 flex-1">
                      {grouped ? null : (
                        <div className="flex items-baseline gap-2">
                          <span className="text-sm font-semibold text-slate-800">{mine ? 'You' : name}</span>
                          <span
                            className="text-[11px] text-slate-400"
                            title={new Date(m.createdAt).toLocaleString()}
                          >
                            {clockTime(m.createdAt)}
                          </span>
                        </div>
                      )}

                      {m.deleted ? (
                        <p className="text-sm italic text-slate-400">Message removed</p>
                      ) : (
                        <>
                          {editingId === m.id ? (
                            <div className="mt-1 flex items-end gap-1.5">
                              <textarea
                                value={editDraft}
                                maxLength={2000}
                                rows={2}
                                autoFocus
                                onChange={(e) => setEditDraft(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    void saveEdit();
                                  }
                                  if (e.key === 'Escape') setEditingId(null);
                                }}
                                className="flex-1 resize-none rounded-lg border border-accent/40 bg-white px-2 py-1.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-accent/20"
                              />
                              <button
                                onClick={() => void saveEdit()}
                                title="Save (Enter)"
                                aria-label="Save edit"
                                className="rounded-md bg-accent p-1.5 text-white hover:opacity-90"
                              >
                                <Check className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => setEditingId(null)}
                                title="Cancel (Esc)"
                                aria-label="Cancel edit"
                                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ) : m.body ? (
                            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">
                              {renderBody(m.body)}
                              {m.edited ? (
                                <span className="ml-1.5 text-[10px] text-slate-400">(edited)</span>
                              ) : null}
                            </p>
                          ) : null}

                          {confirmDeleteId === m.id ? (
                            <div className="mt-1 flex items-center gap-2 rounded-md bg-danger-soft px-2 py-1">
                              <span className="text-xs text-danger">Delete this message? This can't be undone.</span>
                              <button
                                onClick={() => setConfirmDeleteId(null)}
                                className="text-xs text-slate-500 hover:text-slate-700"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => void deleteMessage(m.id)}
                                className="text-xs font-medium text-danger hover:underline"
                              >
                                Delete
                              </button>
                            </div>
                          ) : null}
                        </>
                      )}

                      {!m.deleted && m.files.length > 0 ? (
                        <div className="mt-1.5 flex flex-wrap gap-2">
                          {m.files.map((f) => {
                            if (f.scanStatus === 'INFECTED') {
                              return (
                                <span
                                  key={f.id}
                                  className="inline-flex items-center gap-1.5 rounded-lg bg-danger-soft px-2.5 py-1.5 text-xs font-medium text-danger"
                                >
                                  <ShieldAlert className="h-3.5 w-3.5" />
                                  {f.name} — quarantined
                                </span>
                              );
                            }
                            if (f.scanStatus !== 'AVAILABLE') {
                              return (
                                <span
                                  key={f.id}
                                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs text-slate-500"
                                >
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  {f.name} — checking for viruses
                                </span>
                              );
                            }
                            if (isImage(f) && imageUrls[f.versionId]) {
                              return (
                                <button
                                  key={f.id}
                                  onClick={() => void download(f.versionId, true)}
                                  title={`View ${f.name}`}
                                  className="block overflow-hidden rounded-lg border border-white/70 shadow-glass"
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={imageUrls[f.versionId]}
                                    alt={f.name}
                                    className="max-h-56 max-w-full object-cover"
                                  />
                                </button>
                              );
                            }
                            return (
                              <button
                                key={f.id}
                                onClick={() => void download(f.versionId)}
                                className="inline-flex items-center gap-2 rounded-lg border border-white/70 bg-white/70 px-2.5 py-1.5 text-left transition-colors hover:bg-white"
                              >
                                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent/10 text-accent">
                                  <FileText className="h-3.5 w-3.5" />
                                </span>
                                <span className="min-w-0">
                                  <span className="block max-w-[14rem] truncate text-xs font-medium text-slate-700">
                                    {f.name}
                                  </span>
                                  <span className="block text-[11px] text-slate-400">
                                    {fmtSize(f.sizeBytes) || 'File'}
                                  </span>
                                </span>
                                <Download className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                              </button>
                            );
                          })}
                        </div>
                      ) : null}

                      {!m.deleted && m.reactions.length > 0 ? (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {groupReactions(m.reactions, me.id).map((g) => (
                            <button
                              key={g.emoji}
                              onClick={() => void react(m.id, g.emoji)}
                              title={g.names.join(', ')}
                              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors ${
                                g.mine
                                  ? 'border-accent/40 bg-accent/10 text-accent'
                                  : 'border-slate-200 bg-white/70 text-slate-600 hover:bg-white'
                              }`}
                            >
                              <span>{g.emoji}</span>
                              <span className="font-medium">{g.count}</span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    {!m.deleted ? (
                      <div
                        // Always visible below sm — touch screens have no hover.
                        className="flex shrink-0 items-center gap-0.5 self-start opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100"
                      >
                        <button
                          onClick={() => setReactForId(reactForId === m.id ? null : m.id)}
                          title="Add a reaction"
                          aria-label="Add a reaction"
                          className="rounded-md p-1 text-slate-300 hover:bg-white hover:text-slate-600"
                        >
                          <SmilePlus className="h-3.5 w-3.5" />
                        </button>
                        {canEditThis ? (
                          <button
                            onClick={() => startEdit(m)}
                            title="Edit your message"
                            aria-label="Edit message"
                            className="rounded-md p-1 text-slate-300 hover:bg-white hover:text-slate-600"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                        {isModerator ? (
                          <button
                            onClick={() => void togglePin(m)}
                            title={m.pinned ? 'Unpin' : 'Pin as announcement'}
                            aria-label={m.pinned ? 'Unpin message' : 'Pin message'}
                            className="rounded-md p-1 text-slate-300 hover:bg-white hover:text-slate-600"
                          >
                            {m.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                          </button>
                        ) : null}
                        {canDeleteThis ? (
                          <button
                            onClick={() => setConfirmDeleteId(m.id)}
                            title={mine ? 'Delete your message' : 'Remove this message (moderation)'}
                            aria-label="Delete message"
                            className="rounded-md p-1 text-slate-300 hover:bg-white hover:text-danger"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                      </div>
                    ) : null}

                    {reactForId === m.id ? (
                      <div className="absolute right-2 top-7 z-10 flex gap-0.5 rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
                        {REACTION_EMOJI.map((e) => (
                          <button
                            key={e}
                            onClick={() => void react(m.id, e)}
                            aria-label={`React ${e}`}
                            className="rounded-lg px-1.5 py-0.5 text-base hover:bg-slate-100"
                          >
                            {e}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Composer */}
        <div className="relative border-t border-white/70 bg-white/50 p-3">
          {typingNames.length > 0 ? (
            <p className="mb-1 px-1 text-xs text-slate-400">
              {typingNames.length === 1
                ? `${typingNames[0]} is typing…`
                : typingNames.length === 2
                  ? `${typingNames[0]} and ${typingNames[1]} are typing…`
                  : 'Several people are typing…'}
            </p>
          ) : null}

          {mentionMatches.length > 0 ? (
            <div className="absolute bottom-full left-3 z-10 mb-1 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
              <p className="border-b border-slate-100 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Mention someone
              </p>
              {mentionMatches.map((p) => (
                <button
                  key={p.id}
                  onClick={() => insertMention(p)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-slate-50"
                >
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-accent/10 text-[10px] font-semibold text-accent">
                    {initials(p.name)}
                  </span>
                  <span className="text-sm text-slate-700">{p.name}</span>
                </button>
              ))}
            </div>
          ) : null}
          {pending.length > 0 ? (
            <div className="mb-2 flex flex-wrap gap-2">
              {pending.map((p) => (
                <span
                  key={p.key}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs ${
                    p.state === 'failed' ? 'bg-danger-soft text-danger' : 'bg-white/80 text-slate-600'
                  }`}
                >
                  {p.state === 'uploading' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <FileText className="h-3.5 w-3.5" />
                  )}
                  <span className="max-w-[12rem] truncate font-medium">{p.name}</span>
                  {p.state === 'failed' ? <span>failed</span> : null}
                  <button
                    onClick={() => setPending((prev) => prev.filter((x) => x.key !== p.key))}
                    aria-label={`Remove ${p.name}`}
                    className="text-slate-400 hover:text-slate-700"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          <div className="flex items-end gap-2 rounded-xl border border-slate-200 bg-white px-2 py-1.5 focus-within:border-accent/40 focus-within:ring-2 focus-within:ring-accent/20">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => e.target.files && attach(e.target.files)}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              title="Attach a file"
              aria-label="Attach a file"
              className="shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <textarea
              ref={textareaRef}
              rows={1}
              placeholder="Write a message…  (Enter to send, @ to mention someone)"
              value={draft}
              maxLength={2000}
              onChange={(e) => {
                setDraft(e.target.value);
                autoGrow(e.target);
                emitTyping();
              }}
              onKeyDown={onKeyDown}
              className="max-h-40 flex-1 resize-none bg-transparent py-1.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
            />
            <Button
              size="sm"
              disabled={!canSend}
              onClick={() => void send()}
              aria-label="Send message"
              className="shrink-0"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizonal className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>
      {error ? <p className="mt-2 text-sm font-medium text-red-600">{error}</p> : null}
    </div>
  );
}
