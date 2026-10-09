'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  Bell,
  BellOff,
  Building2,
  Check,
  CheckCheck,
  Clock,
  CornerUpLeft,
  FolderOpen,
  Forward,
  HardDrive,
  ListPlus,
  Settings2,
  UploadCloud,
  Download,
  FileText,
  Loader2,
  MessagesSquare,
  Paperclip,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  SendHorizonal,
  ShieldAlert,
  ShieldCheck,
  SmilePlus,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { Button, LoadingState } from '@rademics/ui';
import { apiFetch, ApiError } from '@/lib/api';
import { useMe } from '@/lib/me-context';
import { connectPresence } from '@/lib/socket';
import { desktopHost } from '@/lib/desktop-host';
import {
  MUTE_EVENT,
  plainText,
  popupsEnabled,
  setOpenRoom,
  setPopupsEnabled,
  setSoundEnabled,
  soundEnabled,
} from '@/lib/chat-alerts';

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
  roomId?: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string } | null;
  files: Attachment[];
  reactions: Reaction[];
  /** The message this one answers, quoted above it. */
  replyTo?: { id: string; authorName: string; body: string; deleted: boolean } | null;
  /** Sent with "Forward" from another conversation. */
  forwarded?: boolean;
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

/** One conversation in the left list — the company room, a group, or a one-to-one. */
interface Room {
  id: string;
  kind: 'COMPANY' | 'GROUP' | 'DIRECT';
  name: string;
  memberCount: number | null;
  other: ActivePerson | null;
  createdBy: ActivePerson | null;
  muted: boolean;
  unread: number;
  lastMessageAt: string | null;
  lastMessage: { body: string; authorId: string | null; authorName: string | null } | null;
}

/** A project the caller may add tasks to (HR / Super Admin: any; otherwise ones they manage). */
interface TaskProject {
  id: string;
  name: string;
  pm: { id: string } | null;
}

/** How far one person has read a room — powers "Seen". */
interface ReadMark {
  userId: string;
  name: string;
  lastReadAt: string;
}

/** Must match the API's COMPANY_ROOM_ID. */
const COMPANY_ROOM_ID = '00000000-0000-4000-8000-000000000001';

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

interface RoomViewProps {
  room: Room;
  /** Every active staff member — names for typing hints and the people panel. */
  staff: ActivePerson[];
  /** Back to the conversation list (small screens only). */
  onBack: () => void;
  /** Open the people panel for this group. */
  onPeople: () => void;
  /** A message to scroll to and briefly highlight (a mention notification, a search result). */
  focusMessageId: string | null;
  /** The room was muted / unmuted here. */
  onMutedChange: (muted: boolean) => void;
  /** Projects the caller may add tasks to; empty hides "Make a task". */
  taskProjects: TaskProject[];
  /** Every conversation the caller has — where a message can be forwarded to. */
  rooms: Room[];
  /** Switch to another conversation (after forwarding there). */
  onOpenRoom: (roomId: string) => void;
}

function RoomView({
  room,
  staff,
  onBack,
  onPeople,
  focusMessageId,
  onMutedChange,
  taskProjects,
  rooms,
  onOpenRoom,
}: RoomViewProps) {
  const me = useMe();
  const isCompany = room.kind === 'COMPANY';
  /** `?roomId=` / `&roomId=` for private rooms; nothing for the company room. */
  const roomParam = useCallback(
    (sep: '?' | '&') => (room.kind === 'COMPANY' ? '' : `${sep}roomId=${room.id}`),
    [room.kind, room.id],
  );
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
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [reads, setReads] = useState<Record<string, ReadMark>>({});
  const [dragging, setDragging] = useState(false);
  const [taskFor, setTaskFor] = useState<ChatMessage | null>(null);
  const [forwardFor, setForwardFor] = useState<ChatMessage | null>(null);
  const [panel, setPanel] = useState<'files' | 'pins' | 'seen' | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduled, setScheduled] = useState<ScheduledItem[]>([]);
  const [scheduledOpen, setScheduledOpen] = useState(false);
  const [jumpId, setJumpId] = useState<string | null>(null);
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
    apiFetch(`/chat/read${roomParam('?')}`, { method: 'POST', body: '{}' }).catch(() => undefined);
  }, [roomParam]);

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
    apiFetch<{ items: ChatMessage[]; hasMore: boolean; lastReadAt: string | null }>(`/chat/messages${roomParam('?')}`)
      .then((r) => {
        initialLastReadAt.current = r.lastReadAt;
        setMessages(r.items);
        setHasMore(r.hasMore);
        markRead();
      })
      .catch(() => setError('Could not load the chat.'));
    // The room's people (mentions) + pinned announcements load alongside history.
    apiFetch<ActivePerson[]>(`/chat/rooms/${room.id}/members`).then(setMembers).catch(() => undefined);
    apiFetch<ChatMessage[]>(`/chat/pinned${roomParam('?')}`).then(setPinnedMsgs).catch(() => undefined);
    apiFetch<ReadMark[]>(`/chat/rooms/${room.id}/reads`)
      .then((list) => setReads(Object.fromEntries(list.map((r) => [r.userId, r]))))
      .catch(() => undefined);
    loadScheduled();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markRead, roomParam, room.id]);

  // Tell the browser alerts which conversation is on screen (no chime for it).
  useEffect(() => {
    setOpenRoom(room.id);
    return () => setOpenRoom(null);
  }, [room.id]);

  // Live delivery. Dedupe by id: our own send appends from the POST response too.
  useEffect(() => {
    const socket = connectPresence();
    socketRef.current = socket;
    // Every event names its room; this view only acts on its own.
    const mine = (roomId: string | null | undefined) => (roomId ?? COMPANY_ROOM_ID) === room.id;
    socket.on('chat:message', (m: ChatMessage) => {
      if (!mine(m.roomId)) return;
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
    socket.on('chat:messageDeleted', ({ id, roomId }: { id: string; roomId?: string }) => {
      if (!mine(roomId)) return;
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
      if (!mine(m.roomId)) return;
      setMessages((prev) => (prev ? prev.map((x) => (x.id === m.id ? m : x)) : prev));
      setPinnedMsgs((prev) => prev.map((p) => (p.id === m.id ? m : p)));
    });
    socket.on('chat:reactions', ({ id, roomId, reactions }: { id: string; roomId?: string; reactions: Reaction[] }) => {
      if (!mine(roomId)) return;
      setMessages((prev) => (prev ? prev.map((m) => (m.id === id ? { ...m, reactions } : m)) : prev));
    });
    socket.on('chat:pinned', (m: ChatMessage) => {
      if (!mine(m.roomId)) return;
      setPinnedMsgs((prev) => [m, ...prev.filter((p) => p.id !== m.id)]);
      setMessages((prev) => (prev ? prev.map((x) => (x.id === m.id ? { ...x, pinned: true } : x)) : prev));
    });
    socket.on('chat:unpinned', ({ id, roomId }: { id: string; roomId?: string }) => {
      if (!mine(roomId)) return;
      setPinnedMsgs((prev) => prev.filter((p) => p.id !== id));
      setMessages((prev) => (prev ? prev.map((x) => (x.id === id ? { ...x, pinned: false } : x)) : prev));
    });
    socket.on('chat:typing', ({ userId, name, roomId }: { userId: string; name: string; roomId?: string | null }) => {
      if (!mine(roomId)) return;
      setTyping((prev) => ({ ...prev, [userId]: { name: name || 'Someone', at: Date.now() } }));
    });
    socket.on('chat:scheduledSent', ({ roomId }: { roomId: string }) => {
      if (mine(roomId)) loadScheduled();
    });
    socket.on('chat:read', ({ roomId, userId, lastReadAt }: { roomId: string; userId: string; lastReadAt: string }) => {
      if (!mine(roomId)) return;
      setReads((prev) => ({
        ...prev,
        [userId]: { userId, name: prev[userId]?.name ?? '', lastReadAt },
      }));
    });
    return () => {
      socketRef.current = null;
      socket.close();
    };
  }, [markRead, loadActive, room.id]);

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

  // Opening a conversation puts the cursor in the message box (not on phones,
  // where that would throw the keyboard over the history).
  const loaded = messages !== null;
  useEffect(() => {
    if (loaded && window.matchMedia('(min-width: 768px)').matches) textareaRef.current?.focus();
  }, [loaded]);

  // Arriving from a mention: bring that message into view and flash it.
  const [flashId, setFlashId] = useState<string | null>(null);
  const focusedOnce = useRef(false);
  const pagesBack = useRef(0);
  const flash = useCallback((id: string) => {
    stickToBottom.current = false;
    requestAnimationFrame(() => document.getElementById(`msg-${id}`)?.scrollIntoView({ block: 'center' }));
    setFlashId(id);
    setTimeout(() => setFlashId((cur) => (cur === id ? null : cur)), 2500);
  }, []);
  useEffect(() => {
    if (!focusMessageId || focusedOnce.current || !messages) return;
    if (messages.some((m) => m.id === focusMessageId)) {
      focusedOnce.current = true;
      flash(focusMessageId);
    } else if (hasMore && pagesBack.current < 20) {
      // An older message (a search result): page back until it is loaded.
      pagesBack.current += 1;
      void loadEarlier();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusMessageId, messages, hasMore, flash]);

  // "Show in chat" from the files or pinned panel: page back until it is loaded.
  useEffect(() => {
    if (!jumpId || !messages) return;
    if (messages.some((m) => m.id === jumpId)) {
      flash(jumpId);
      setJumpId(null);
    } else if (hasMore) {
      void loadEarlier();
    } else {
      setJumpId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpId, messages, hasMore, flash]);

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
      apiFetch<{ items: ChatMessage[]; hasMore: boolean }>(`/chat/messages${roomParam('?')}`)
        .then((r) => setMessages((prev) => (prev && prev.length > r.items.length ? prev : r.items)))
        .catch(() => undefined);
    }, 2500);
    return () => clearInterval(t);
  }, [messages, roomParam]);

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
        `/chat/messages?before=${encodeURIComponent(messages[0]!.createdAt)}${roomParam('&')}`,
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
  async function attach(files: FileList | File[]) {
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

  function loadScheduled() {
    apiFetch<ScheduledItem[]>(`/chat/scheduled${roomParam('?')}`)
      .then(setScheduled)
      .catch(() => undefined);
  }

  async function scheduleDraft(when: Date) {
    const text = draft.trim();
    if (!text) return;
    setError(null);
    try {
      await apiFetch('/chat/scheduled', {
        method: 'POST',
        body: JSON.stringify({ body: text, sendAt: when.toISOString(), roomId: isCompany ? undefined : room.id }),
      });
      setDraft('');
      setScheduleOpen(false);
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
      loadScheduled();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not schedule that message.');
    }
  }

  async function cancelScheduled(id: string) {
    try {
      await apiFetch(`/chat/scheduled/${id}`, { method: 'DELETE' });
    } catch {
      /* already sent or cancelled — the reload shows the truth */
    }
    loadScheduled();
  }

  function startReply(m: ChatMessage) {
    setReplyTo(m);
    textareaRef.current?.focus();
  }

  async function toggleMute() {
    try {
      const r = await apiFetch<{ muted: boolean }>(`/chat/rooms/${room.id}/mute`, {
        method: 'POST',
        body: JSON.stringify({ muted: !room.muted }),
      });
      onMutedChange(r.muted);
      window.dispatchEvent(new Event(MUTE_EVENT));
    } catch {
      setError('Could not change the notification setting.');
    }
  }

  /** A screenshot pasted into the message box becomes an attachment. */
  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData.files);
    if (files.length === 0) return;
    e.preventDefault();
    const stamp = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }).replace(':', '.');
    void attach(
      files.map((f) =>
        f.name === 'image.png' ? new File([f], `Screenshot ${stamp}.png`, { type: f.type }) : f,
      ),
    );
  }

  function onDragOver(e: React.DragEvent) {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    setDragging(true);
  }

  function onDrop(e: React.DragEvent) {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    setDragging(false);
    void attach(e.dataTransfer.files);
  }

  /** Throttled "I'm typing" ping — at most one every 2s while keys are moving. */
  const myName = staff.find((p) => p.id === me.id)?.name ?? 'Someone';
  function emitTyping() {
    const now = Date.now();
    if (now - lastTypingSentAt.current < 2000) return;
    lastTypingSentAt.current = now;
    socketRef.current?.emit('chat:typing', { name: myName, roomId: isCompany ? undefined : room.id });
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

  /** Render a body: @mentions, links, **bold**, _italic_, `code` and "- " bullet lists. */
  function renderBody(body: string) {
    return <RichText body={body} names={members.map((p) => p.name)} />;
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
          roomId: isCompany ? undefined : room.id,
          replyToId: replyTo?.id,
        }),
      });
      setDraft('');
      setPending([]);
      setReplyTo(null);
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
    if (e.key === 'Escape' && replyTo) setReplyTo(null);
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
  const otherActive = room.other ? active.some((p) => p.id === room.other!.id) : false;
  const activeIds = new Set(active.map((p) => p.id));

  // "Seen" sits under your most recent message: who (else) has read up to it.
  const lastMine = [...(messages ?? [])].reverse().find((m) => m.author?.id === me.id && !m.deleted);
  const seenBy = lastMine
    ? Object.values(reads).filter(
        (r) => r.userId !== me.id && new Date(r.lastReadAt).getTime() >= new Date(lastMine.createdAt).getTime(),
      )
    : [];
  const nameOf = (id: string) => reads[id]?.name || members.find((p) => p.id === id)?.name || staff.find((p) => p.id === id)?.name || 'Someone';
  const othersInRoom = room.kind === 'GROUP' ? Math.max((room.memberCount ?? members.length) - 1, 0) : null;
  const receipt = !lastMine
    ? null
    : seenBy.length === 0
      ? 'Sent'
      : room.kind === 'DIRECT'
        ? 'Seen'
        : othersInRoom !== null && seenBy.length >= othersInRoom
          ? 'Seen by everyone'
          : `Seen by ${seenBy.length}${othersInRoom !== null ? ` of ${othersInRoom}` : ''}`;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        onDragOver={onDragOver}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
        }}
        onDrop={onDrop}
        className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-glass"
      >
        {dragging ? (
          <div className="pointer-events-none absolute inset-2 z-20 flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-accent/50 bg-white text-accent">
            <UploadCloud className="h-8 w-8" />
            <p className="mt-2 text-sm font-semibold">Drop files to attach</p>
            <p className="text-xs text-slate-500">They&apos;re virus-checked before anyone can open them</p>
          </div>
        ) : null}
        {/* Room header: who this conversation is with, and who is around */}
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          <button
            onClick={onBack}
            aria-label="Back to conversations"
            className="-ml-1 rounded-md p-1.5 text-slate-500 hover:bg-slate-50 hover:text-slate-700 md:hidden"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <RoomAvatar room={room} active={otherActive} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[15px] font-semibold text-slate-800">{room.name}</h1>
            <p className="truncate text-xs text-slate-500">
              {isCompany
                ? 'Everyone on staff reads and writes here'
                : room.kind === 'DIRECT'
                  ? otherActive
                    ? 'Checked in now'
                    : 'Not checked in'
                  : `${room.memberCount ?? members.length} people`}
            </p>
          </div>
          {isCompany ? (
            <div className="hidden items-center gap-2 sm:flex">
              {active.length === 0 ? (
                <span className="text-xs text-slate-400">Nobody checked in</span>
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
          ) : null}
          <button
            onClick={() => setPanel('files')}
            title="Files shared in this conversation"
            aria-label="Files shared in this conversation"
            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-white hover:text-slate-600"
          >
            <FolderOpen className="h-4 w-4" />
          </button>
          <button
            onClick={() => void toggleMute()}
            title={room.muted ? 'Unmute: get sounds and pop-ups again' : 'Mute: no sounds or pop-ups (mentions still notify)'}
            aria-label={room.muted ? 'Unmute conversation' : 'Mute conversation'}
            aria-pressed={room.muted}
            className={`rounded-lg p-2 transition-colors ${
              room.muted ? 'bg-slate-100 text-slate-600' : 'text-slate-400 hover:bg-white hover:text-slate-600'
            }`}
          >
            {room.muted ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
          </button>
          {room.kind === 'GROUP' ? (
            <button
              onClick={onPeople}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-white"
            >
              <Users className="h-3.5 w-3.5" />
              {isModerator ? 'Manage people' : 'People'}
            </button>
          ) : null}
        </div>
        {/* Pinned announcement — the newest pin leads the room. */}
        {topPin ? (
          <div className="flex items-start gap-2.5 border-b border-slate-200 bg-accent/5 px-4 py-2.5">
            <Pin className="mt-1 h-3.5 w-3.5 shrink-0 text-accent" />
            <button onClick={() => setPanel('pins')} className="min-w-0 flex-1 text-left" title="See all pinned messages">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-accent">
                Pinned{pinnedMsgs.length > 1 ? ` · ${pinnedMsgs.length} messages · see all` : ''}
              </span>
              <p className="truncate text-sm text-slate-700">
                <span className="font-medium">{topPin.author?.name ?? 'Someone'}: </span>
                {plainText(topPin.body) || 'Shared a file'}
              </p>
            </button>
            {isModerator ? (
              <button
                onClick={() => void togglePin(topPin)}
                title="Unpin this announcement"
                aria-label="Unpin"
                className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-50 hover:text-slate-600"
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
              <h2 className="mt-4 text-lg font-semibold text-slate-800">
                {isCompany
                  ? 'Welcome to the company room'
                  : room.kind === 'DIRECT'
                    ? `This is the start of your chat with ${room.name}`
                    : `Welcome to ${room.name}`}
              </h2>
              <p className="mt-1 max-w-md text-sm text-slate-500">
                {isCompany
                  ? 'This is where the whole team talks. Be the first to say hello.'
                  : room.kind === 'DIRECT'
                    ? 'Only the two of you can see these messages.'
                    : 'Only the people in this group can see these messages.'}
              </p>

              {isCompany ? (
              <div className="mt-8 grid w-full max-w-2xl gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-left shadow-glass">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-accent">
                    <Users className="h-4 w-4" />
                  </span>
                  <p className="mt-2.5 text-sm font-semibold text-slate-700">One room, everyone</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">
                    Every message is visible to all staff — announcements, questions, quick coordination.
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-left shadow-glass">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-accent">
                    <Paperclip className="h-4 w-4" />
                  </span>
                  <p className="mt-2.5 text-sm font-semibold text-slate-700">Share files safely</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">
                    Drop in documents and images — every upload is virus-checked before anyone can open it.
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-left shadow-glass">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-accent">
                    <ShieldCheck className="h-4 w-4" />
                  </span>
                  <p className="mt-2.5 text-sm font-semibold text-slate-700">Keep it professional</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">
                    This is a workplace space. HR and admins can remove messages that don&apos;t belong.
                  </p>
                </div>
              </div>
              ) : null}
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
                <li key={m.id} id={`msg-${m.id}`}>
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
                    className={`group relative flex items-start gap-2.5 rounded-lg px-2 py-1 transition-colors duration-700 hover:bg-slate-50 ${
                      grouped ? '' : 'mt-2'
                    } ${flashId === m.id ? 'bg-accent/10 ring-1 ring-accent/30' : ''}`}
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
                        title={m.author && activeIds.has(m.author.id) ? `${name} is checked in` : undefined}
                        className={`relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                          mine ? 'bg-accent text-accent-foreground' : 'bg-accent/10 text-accent'
                        }`}
                      >
                        {initials(name)}
                        {m.author && activeIds.has(m.author.id) ? (
                          <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-success ring-2 ring-white" />
                        ) : null}
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

                      {!m.deleted && m.replyTo ? (
                        <button
                          onClick={() => m.replyTo && !m.replyTo.deleted && messages?.some((x) => x.id === m.replyTo!.id) && flash(m.replyTo.id)}
                          className="mb-1 mt-0.5 flex max-w-full flex-col rounded-md border-l-2 border-accent/50 bg-slate-100/80 px-2.5 py-1 text-left hover:bg-slate-100"
                        >
                          <span className="text-[11px] font-semibold text-accent">{m.replyTo.authorName}</span>
                          <span className="truncate text-xs text-slate-500">
                            {m.replyTo.deleted ? 'Message removed' : plainText(m.replyTo.body)}
                          </span>
                        </button>
                      ) : null}

                      {!m.deleted && m.forwarded ? (
                        <p className="mb-0.5 flex items-center gap-1 text-[11px] italic text-slate-400">
                          <Forward className="h-3 w-3" />
                          Forwarded
                        </p>
                      ) : null}

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
                            <div className="break-words text-sm leading-relaxed text-slate-700">
                              {renderBody(m.body)}
                              {m.edited ? (
                                <span className="ml-1.5 text-[10px] text-slate-400">(edited)</span>
                              ) : null}
                            </div>
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
                                  className="block overflow-hidden rounded-lg border border-slate-200 shadow-glass"
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
                                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-left transition-colors hover:bg-white"
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
                                  : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-white'
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
                          onClick={() => startReply(m)}
                          title="Reply"
                          aria-label="Reply to this message"
                          className="rounded-md p-1 text-slate-300 hover:bg-white hover:text-slate-600"
                        >
                          <CornerUpLeft className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setReactForId(reactForId === m.id ? null : m.id)}
                          title="Add a reaction"
                          aria-label="Add a reaction"
                          className="rounded-md p-1 text-slate-300 hover:bg-white hover:text-slate-600"
                        >
                          <SmilePlus className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setForwardFor(m)}
                          title="Forward to another chat"
                          aria-label="Forward to another chat"
                          className="rounded-md p-1 text-slate-300 hover:bg-white hover:text-slate-600"
                        >
                          <Forward className="h-3.5 w-3.5" />
                        </button>
                        {taskProjects.length > 0 ? (
                          <button
                            onClick={() => setTaskFor(m)}
                            title="Make a task from this message"
                            aria-label="Make a task from this message"
                            className="rounded-md p-1 text-slate-300 hover:bg-white hover:text-slate-600"
                          >
                            <ListPlus className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
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
                  {lastMine?.id === m.id && receipt ? (
                    <div className="mt-0.5 flex justify-end pr-2">
                      <button
                        onClick={() => (room.kind === 'DIRECT' ? undefined : setPanel('seen'))}
                        className={`flex items-center gap-1 rounded px-1 text-[11px] ${
                          receipt === 'Sent' ? 'text-slate-400' : 'text-accent'
                        } ${room.kind === 'DIRECT' ? 'cursor-default' : 'hover:bg-slate-50 hover:underline'}`}
                        title={room.kind === 'DIRECT' ? undefined : 'See who has seen it'}
                      >
                        {receipt === 'Sent' ? <Check className="h-3 w-3" /> : <CheckCheck className="h-3 w-3" />}
                        {receipt}
                        {room.kind !== 'DIRECT' && seenBy.length > 0 ? (
                          <span className="text-slate-400">
                            {' '}
                            · {seenBy.slice(0, 2).map((r) => nameOf(r.userId).split(' ')[0]).join(', ')}
                            {seenBy.length > 2 ? ` +${seenBy.length - 2}` : ''}
                          </span>
                        ) : null}
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>

        {/* Composer */}
        <div className="relative border-t border-slate-200 bg-white p-3">
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
                  <span className="relative inline-flex h-6 w-6 items-center justify-center rounded-full bg-accent/10 text-[10px] font-semibold text-accent">
                    {initials(p.name)}
                    {activeIds.has(p.id) ? (
                      <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-success ring-2 ring-white" />
                    ) : null}
                  </span>
                  <span className="text-sm text-slate-700">{p.name}</span>
                </button>
              ))}
            </div>
          ) : null}
          {scheduled.length > 0 ? (
            <div className="mb-2 rounded-lg bg-slate-50 px-3 py-1.5 text-xs">
              <button
                onClick={() => setScheduledOpen((o) => !o)}
                className="flex w-full items-center gap-1.5 font-medium text-slate-600"
              >
                <Clock className="h-3.5 w-3.5 text-accent" />
                {scheduled.length} scheduled message{scheduled.length === 1 ? '' : 's'}
                <span className="ml-auto text-slate-400">{scheduledOpen ? 'Hide' : 'Show'}</span>
              </button>
              {scheduledOpen ? (
                <ul className="mt-1.5 divide-y divide-slate-100">
                  {scheduled.map((sm) => (
                    <li key={sm.id} className="flex items-center gap-2 py-1.5">
                      <span className="shrink-0 font-medium text-accent">{fmtWhen(sm.sendAt)}</span>
                      <span className="min-w-0 flex-1 truncate text-slate-600">{sm.body}</span>
                      <button
                        onClick={() => void cancelScheduled(sm.id)}
                        className="shrink-0 text-slate-400 hover:text-danger"
                        title="Cancel this scheduled message"
                      >
                        Cancel
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          {replyTo ? (
            <div className="mb-2 flex items-start gap-2 rounded-lg border-l-2 border-accent bg-slate-50 px-3 py-1.5">
              <CornerUpLeft className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold text-accent">
                  Replying to {replyTo.author?.id === me.id ? 'yourself' : (replyTo.author?.name ?? 'Someone')}
                </p>
                <p className="truncate text-xs text-slate-500">{plainText(replyTo.body) || 'Shared a file'}</p>
              </div>
              <button
                onClick={() => setReplyTo(null)}
                aria-label="Cancel reply"
                title="Cancel reply (Esc)"
                className="rounded p-0.5 text-slate-400 hover:text-slate-700"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : null}
          {pending.length > 0 ? (
            <div className="mb-2 flex flex-wrap gap-2">
              {pending.map((p) => (
                <span
                  key={p.key}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs ${
                    p.state === 'failed' ? 'bg-danger-soft text-danger' : 'bg-slate-50 text-slate-600'
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
              title="Attach a file (or drag files here, or paste a screenshot)"
              aria-label="Attach a file"
              className="shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <textarea
              ref={textareaRef}
              rows={1}
              placeholder={`Message ${isCompany ? "everyone" : room.name}…`}
              value={draft}
              maxLength={2000}
              onChange={(e) => {
                setDraft(e.target.value);
                autoGrow(e.target);
                emitTyping();
              }}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              title="Formatting: **bold**  _italic_  `code`  and start a line with - for a list"
              className="max-h-40 flex-1 resize-none bg-transparent py-1.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
            />
            <div className="relative shrink-0">
              <button
                onClick={() => setScheduleOpen((o) => !o)}
                disabled={!draft.trim() || pending.length > 0}
                title={
                  pending.length > 0
                    ? 'Files can not be scheduled; send them now'
                    : draft.trim()
                      ? 'Send later'
                      : 'Write a message, then choose when to send it'
                }
                aria-label="Send later"
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <Clock className="h-4 w-4" />
              </button>
              {scheduleOpen ? (
                <SchedulePicker onPick={(d) => void scheduleDraft(d)} onClose={() => setScheduleOpen(false)} />
              ) : null}
            </div>
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
      {taskFor ? (
        <TaskFromMessageDialog
          message={taskFor}
          roomName={room.name}
          projects={taskProjects}
          onClose={() => setTaskFor(null)}
        />
      ) : null}
      {forwardFor ? (
        <ForwardDialog
          message={forwardFor}
          rooms={rooms.filter((r) => r.id !== room.id)}
          onClose={() => setForwardFor(null)}
          onOpen={(id) => {
            setForwardFor(null);
            onOpenRoom(id);
          }}
        />
      ) : null}
      {panel === 'files' ? (
        <FilesDialog
          room={room}
          onClose={() => setPanel(null)}
          onDownload={(versionId) => void download(versionId)}
          onShow={(id) => {
            setPanel(null);
            setJumpId(id);
          }}
        />
      ) : null}
      {panel === 'pins' ? (
        <Dialog title="Pinned messages" onClose={() => setPanel(null)}>
          <ul className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto px-2 py-2">
            {pinnedMsgs.map((pm) => (
              <li key={pm.id} className="flex items-start gap-3 px-3 py-2.5">
                <Pin className="mt-1 h-3.5 w-3.5 shrink-0 text-accent" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-slate-400">
                    <span className="font-semibold text-slate-700">{pm.author?.name ?? 'Someone'}</span> ·{' '}
                    {new Date(pm.createdAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                  </p>
                  <p className="mt-0.5 line-clamp-3 text-sm text-slate-700">{plainText(pm.body) || 'Shared a file'}</p>
                  <div className="mt-1 flex gap-3 text-xs">
                    <button
                      className="font-medium text-accent hover:underline"
                      onClick={() => {
                        setPanel(null);
                        setJumpId(pm.id);
                      }}
                    >
                      Show in chat
                    </button>
                    {isModerator ? (
                      <button className="text-slate-400 hover:text-slate-600" onClick={() => void togglePin(pm)}>
                        Unpin
                      </button>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
            {pinnedMsgs.length === 0 ? <li className="px-3 py-6 text-center text-sm text-slate-400">Nothing is pinned.</li> : null}
          </ul>
        </Dialog>
      ) : null}
      {panel === 'seen' && lastMine ? (
        <Dialog title="Who has seen your message" onClose={() => setPanel(null)}>
          {(() => {
            const people = (isCompany ? staff : members).filter((p) => p.id !== me.id);
            const seenIds = new Set(seenBy.map((r) => r.userId));
            const notSeen = people.filter((p) => !seenIds.has(p.id));
            return (
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                <p className="line-clamp-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">{lastMine.body || 'Shared a file'}</p>
                <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-accent">
                  Seen · {seenBy.length}
                </p>
                <ul className="mt-1">
                  {seenBy
                    .slice()
                    .sort((a, b) => new Date(a.lastReadAt).getTime() - new Date(b.lastReadAt).getTime())
                    .map((r) => (
                      <li key={r.userId} className="flex items-center gap-3 py-1.5">
                        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[10px] font-semibold text-accent">
                          {initials(nameOf(r.userId))}
                        </span>
                        <span className="flex-1 truncate text-sm text-slate-700">{nameOf(r.userId)}</span>
                        <span className="shrink-0 text-xs text-slate-400">{fmtWhen(r.lastReadAt)}</span>
                      </li>
                    ))}
                  {seenBy.length === 0 ? <li className="py-1.5 text-sm text-slate-400">Nobody yet.</li> : null}
                </ul>
                <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Not seen yet · {notSeen.length}
                </p>
                <ul className="mt-1">
                  {notSeen.map((p) => (
                    <li key={p.id} className="flex items-center gap-3 py-1.5">
                      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-500">
                        {initials(p.name)}
                      </span>
                      <span className="flex-1 truncate text-sm text-slate-500">{p.name}</span>
                    </li>
                  ))}
                  {notSeen.length === 0 ? <li className="py-1.5 text-sm text-slate-400">Everyone has seen it.</li> : null}
                </ul>
              </div>
            );
          })()}
        </Dialog>
      ) : null}
    </div>
  );
}

/** The round mark beside a conversation: building for company, initials otherwise. */
function RoomAvatar({ room, active = false }: { room: Room; active?: boolean }) {
  if (room.kind === 'COMPANY') {
    return (
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
        <Building2 className="h-4 w-4" />
      </span>
    );
  }
  if (room.kind === 'GROUP') {
    return (
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-xs font-semibold text-accent">
        {initials(room.name)}
      </span>
    );
  }
  return (
    <span className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
      {initials(room.name)}
      {active ? (
        <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-success ring-2 ring-white" />
      ) : null}
    </span>
  );
}

/** "10:42" today, "Mon" this week, "12 Mar" before that. */
function listTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return clockTime(iso);
  if (now.getTime() - d.getTime() < 6 * 24 * 60 * 60 * 1000) {
    return d.toLocaleDateString(undefined, { weekday: 'short' });
  }
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** A centred panel over a dimmed page; Escape or the backdrop closes it. */
function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/30 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:max-w-md sm:rounded-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-800">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Searchable staff list. With `selected` each row is a checkbox; otherwise a button. */
function PersonList({
  people,
  selected,
  onPick,
  empty = 'Nobody matches that name.',
  focusSearch = true,
  activeIds,
}: {
  people: ActivePerson[];
  selected?: Set<string>;
  onPick: (p: ActivePerson) => void;
  empty?: string;
  focusSearch?: boolean;
  /** People checked in right now get a green dot. */
  activeIds?: string[];
}) {
  const [q, setQ] = useState('');
  const shown = people.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <>
      <div className="px-5 pt-4">
        <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 focus-within:border-accent/40 focus-within:ring-2 focus-within:ring-accent/20">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            autoFocus={focusSearch}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name"
            className="flex-1 bg-transparent text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
          />
        </label>
      </div>
      <ul className="mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {shown.length === 0 ? <li className="px-3 py-6 text-center text-sm text-slate-400">{empty}</li> : null}
        {shown.map((p) => {
          const on = selected?.has(p.id) ?? false;
          return (
            <li key={p.id}>
              <button
                onClick={() => onPick(p)}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-slate-50"
              >
                <span className="relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600">
                  {initials(p.name)}
                  {activeIds?.includes(p.id) ? (
                    <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-success ring-2 ring-white" />
                  ) : null}
                </span>
                <span className="flex-1 truncate text-sm text-slate-700">{p.name}</span>
                {selected ? (
                  <span
                    className={`inline-flex h-5 w-5 items-center justify-center rounded-md border ${
                      on ? 'border-accent bg-accent text-accent-foreground' : 'border-slate-300'
                    }`}
                  >
                    {on ? <Check className="h-3.5 w-3.5" /> : null}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** HR / Super Admin: name a group and choose who is in it. */
function NewGroupDialog({
  staff,
  meId,
  onClose,
  onCreated,
}: {
  staff: ActivePerson[];
  meId: string;
  onClose: () => void;
  onCreated: (roomId: string) => void;
}) {
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(p: ActivePerson) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(p.id)) next.delete(p.id);
      else next.add(p.id);
      return next;
    });
  }

  async function create() {
    if (!name.trim() || picked.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      const room = await apiFetch<{ id: string }>('/chat/rooms', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), memberIds: [...picked] }),
      });
      onCreated(room.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the group.');
      setBusy(false);
    }
  }

  return (
    <Dialog title="New group" onClose={onClose}>
      <div className="px-5 pt-4">
        <label className="text-xs font-medium text-slate-600" htmlFor="group-name">
          Group name
        </label>
        <input
          id="group-name"
          autoFocus
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Research team"
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-accent/40 focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
        <p className="mt-4 text-xs font-medium text-slate-600">
          Add people {picked.size > 0 ? <span className="text-accent">· {picked.size} chosen</span> : null}
        </p>
      </div>
      <PersonList people={staff.filter((p) => p.id !== meId)} selected={picked} onPick={toggle} focusSearch={false} />
      <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-3">
        <span className="text-xs text-red-600">{error}</span>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={!name.trim() || picked.size === 0 || busy} onClick={() => void create()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create group'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** Anyone: pick a colleague to message one-to-one. */
function NewChatDialog({
  staff,
  meId,
  activeIds,
  onClose,
  onOpened,
}: {
  staff: ActivePerson[];
  meId: string;
  activeIds: string[];
  onClose: () => void;
  onOpened: (roomId: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  async function open(p: ActivePerson) {
    setError(null);
    try {
      const room = await apiFetch<{ id: string }>('/chat/direct', {
        method: 'POST',
        body: JSON.stringify({ userId: p.id }),
      });
      onOpened(room.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not open that chat.');
    }
  }
  return (
    <Dialog title="Message someone" onClose={onClose}>
      <PersonList people={staff.filter((p) => p.id !== meId)} activeIds={activeIds} onPick={(p) => void open(p)} />
      {error ? <p className="border-t border-slate-100 px-5 py-3 text-xs text-red-600">{error}</p> : null}
    </Dialog>
  );
}

/** A group's people. HR / Super Admin can add and remove; everyone else can look. */
function PeopleDialog({
  room,
  staff,
  activeIds,
  canManage,
  onClose,
}: {
  room: Room;
  staff: ActivePerson[];
  activeIds: string[];
  canManage: boolean;
  onClose: () => void;
}) {
  const [members, setMembers] = useState<ActivePerson[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<ActivePerson[]>(`/chat/rooms/${room.id}/members`)
      .then(setMembers)
      .catch(() => setError('Could not load the people in this group.'));
  }, [room.id]);

  async function add(p: ActivePerson) {
    setError(null);
    try {
      const next = await apiFetch<ActivePerson[]>(`/chat/rooms/${room.id}/members`, {
        method: 'POST',
        body: JSON.stringify({ memberIds: [p.id] }),
      });
      setMembers(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Could not add ${p.name}.`);
    }
  }

  async function remove(p: ActivePerson) {
    setError(null);
    try {
      await apiFetch(`/chat/rooms/${room.id}/members/${p.id}`, { method: 'DELETE' });
      setMembers((prev) => (prev ? prev.filter((m) => m.id !== p.id) : prev));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Could not remove ${p.name}.`);
    }
  }

  const inGroup = new Set((members ?? []).map((m) => m.id));
  const [name, setName] = useState(room.name);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function rename() {
    if (!name.trim() || name.trim() === room.name) return;
    setError(null);
    try {
      await apiFetch(`/chat/rooms/${room.id}`, { method: 'PATCH', body: JSON.stringify({ name: name.trim() }) });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not rename the group.');
    }
  }

  async function deleteGroup() {
    setError(null);
    try {
      await apiFetch(`/chat/rooms/${room.id}`, { method: 'DELETE' });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete the group.');
    }
  }

  if (adding) {
    return (
      <Dialog title={`Add people to ${room.name}`} onClose={onClose}>
        <PersonList
          activeIds={activeIds}
          people={staff.filter((p) => !inGroup.has(p.id))}
          onPick={(p) => void add(p)}
          empty="Everyone matching is already in the group."
        />
        <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-3">
          <span className="text-xs text-red-600">{error}</span>
          <Button size="sm" onClick={() => setAdding(false)}>
            Done
          </Button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title={room.name} onClose={onClose}>
      {canManage ? (
        <div className="flex items-end gap-2 border-b border-slate-100 px-5 py-4">
          <label className="block min-w-0 flex-1 text-xs font-medium text-slate-600">
            Group name
            <input
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void rename()}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-accent/40 focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </label>
          <Button size="sm" variant="outline" disabled={!name.trim() || name.trim() === room.name} onClick={() => void rename()}>
            Save
          </Button>
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-3 px-5 pt-4">
        <p className="text-xs font-medium text-slate-600">
          {members ? `${members.length} people` : 'Loading…'}
          {room.createdBy ? (
            <span className="font-normal text-slate-400"> · created by {room.createdBy.name}</span>
          ) : null}
        </p>
        {canManage ? (
          <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
            <UserPlus className="mr-1.5 h-4 w-4" />
            Add people
          </Button>
        ) : null}
      </div>
      <ul className="mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {(members ?? []).map((p) => (
          <li key={p.id} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-slate-50">
            <span className="relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600">
              {initials(p.name)}
              {activeIds.includes(p.id) ? (
                <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-success ring-2 ring-white" />
              ) : null}
            </span>
            <span className="flex-1 truncate text-sm text-slate-700">{p.name}</span>
            {canManage ? (
              <button
                onClick={() => void remove(p)}
                title={`Remove ${p.name} from the group`}
                aria-label={`Remove ${p.name}`}
                className="rounded-md p-1.5 text-slate-400 hover:bg-danger-soft hover:text-danger"
              >
                <UserMinus className="h-4 w-4" />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {canManage ? (
        <div className="border-t border-slate-100 px-5 py-3">
          {confirmDelete ? (
            <div className="flex items-center justify-between gap-3 rounded-lg bg-danger-soft px-3 py-2">
              <span className="text-xs text-danger">
                Delete this group for everyone? Its messages stay on the server as a record.
              </span>
              <div className="flex shrink-0 gap-2">
                <button className="text-xs text-slate-500 hover:text-slate-700" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </button>
                <button className="text-xs font-semibold text-danger hover:underline" onClick={() => void deleteGroup()}>
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-danger"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete group
            </button>
          )}
        </div>
      ) : null}
      {error ? <p className="border-t border-slate-100 px-5 py-3 text-xs text-red-600">{error}</p> : null}
    </Dialog>
  );
}

/** One row in the conversation list. */
function RoomRow({
  room,
  selected,
  meId,
  active,
  typing,
  onSelect,
}: {
  room: Room;
  selected: boolean;
  meId: string;
  active: boolean;
  /** Who is typing in this conversation right now, if anyone. */
  typing?: string;
  onSelect: () => void;
}) {
  const last = room.lastMessage;
  const who = !last
    ? ''
    : last.authorId === meId
      ? 'You: '
      : room.kind !== 'DIRECT' && last.authorName
        ? `${last.authorName.split(' ')[0]}: `
        : '';
  const preview = last ? `${who}${plainText(last.body)}` : room.kind === 'DIRECT' ? 'Say hello' : 'No messages yet';
  const unread = room.unread > 0;
  return (
    <button
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors ${
        selected ? 'bg-white shadow-sm ring-1 ring-slate-200/70' : 'hover:bg-slate-50'
      }`}
    >
      <RoomAvatar room={room} active={active} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className={`truncate text-sm ${unread ? 'font-semibold text-slate-900' : 'font-medium text-slate-700'}`}>
            {room.name}
          </span>
          <span className={`flex shrink-0 items-center gap-1 text-[11px] ${unread && !room.muted ? 'font-medium text-accent' : 'text-slate-400'}`}>
            {room.muted ? <BellOff className="h-3 w-3" aria-label="Muted" /> : null}
            {listTime(room.lastMessageAt)}
          </span>
        </span>
        <span className="flex items-center justify-between gap-2">
          {typing ? (
            <span className="truncate text-xs font-medium text-accent">
              {room.kind === 'DIRECT' ? 'typing…' : `${typing.split(' ')[0]} is typing…`}
            </span>
          ) : (
            <span className={`truncate text-xs ${unread ? 'text-slate-700' : 'text-slate-500'}`}>{preview}</span>
          )}
          {unread ? (
            <span
              className={`inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-semibold ${
                room.muted ? 'bg-slate-300 text-white' : 'bg-accent text-accent-foreground'
              }`}
            >
              {room.unread > 99 ? '99+' : room.unread}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}

/** A message-search result in the conversation list. */
interface SearchHit {
  id: string;
  roomId: string;
  roomName: string;
  roomKind: Room['kind'];
  body: string;
  fileNames: string[];
  createdAt: string;
  author: ActivePerson | null;
}

/** The matched words in a search result, marked. */
function Highlight({ text, term }: { text: string; term: string }) {
  const i = text.toLowerCase().indexOf(term.toLowerCase());
  if (!term || i === -1) return <>{text}</>;
  // Start a little before the match so it is visible in a two-line preview.
  const from = Math.max(0, i - 40);
  return (
    <>
      {from > 0 ? '\u2026' : ''}
      {text.slice(from, i)}
      <mark className="rounded bg-accent/15 px-0.5 text-slate-800">{text.slice(i, i + term.length)}</mark>
      {text.slice(i + term.length)}
    </>
  );
}

/** Sound and browser pop-ups for this browser (the desktop app has its own). */
function AlertSettings({ onClose }: { onClose: () => void }) {
  const [sound, setSound] = useState(soundEnabled);
  const [popups, setPopups] = useState(popupsEnabled);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() =>
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  );
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  async function togglePopups() {
    if (permission === 'default') {
      const p = await Notification.requestPermission();
      setPermission(p);
      setPopupsEnabled(p === 'granted');
      setPopups(p === 'granted');
      return;
    }
    setPopupsEnabled(!popups);
    setPopups(!popups);
  }

  const row = 'flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-slate-50';
  const knob = (on: boolean) => (
    <span className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${on ? 'bg-accent' : 'bg-slate-300'}`}>
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
    </span>
  );

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Sounds and pop-ups"
      className="absolute right-0 top-full z-30 mt-2 w-72 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl"
    >
      <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        New messages in this browser
      </p>
      <button
        className={row}
        onClick={() => {
          setSoundEnabled(!sound);
          setSound(!sound);
        }}
      >
        <span>
          <span className="block text-sm font-medium text-slate-700">Play a sound</span>
          <span className="block text-xs text-slate-500">A soft chime while the ERP is open</span>
        </span>
        {knob(sound)}
      </button>
      <button className={row} disabled={permission === 'denied' || permission === 'unsupported'} onClick={() => void togglePopups()}>
        <span>
          <span className="block text-sm font-medium text-slate-700">Show pop-ups</span>
          <span className="block text-xs text-slate-500">
            {permission === 'denied'
              ? 'Blocked in your browser settings for this site'
              : permission === 'unsupported'
                ? 'Not available in this browser'
                : permission === 'default'
                  ? 'Your browser will ask for permission'
                  : 'When you are on another tab or window'}
          </span>
        </span>
        {knob(popups && permission === 'granted')}
      </button>
      <p className="px-3 pb-2 pt-1 text-[11px] leading-relaxed text-slate-400">
        Muted conversations stay quiet; @mentions always come through.
      </p>
    </div>
  );
}

/** Turn a chat message into a task on a project (HR / Super Admin, or the project manager). */
function TaskFromMessageDialog({
  message,
  roomName,
  projects,
  onClose,
}: {
  message: ChatMessage;
  roomName: string;
  projects: TaskProject[];
  onClose: () => void;
}) {
  const firstLine = (message.body || message.files.map((f) => f.name).join(', ') || 'Follow up').split('\n')[0]!;
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  const [title, setTitle] = useState(firstLine.slice(0, 120));
  const [assigneeId, setAssigneeId] = useState('');
  // Only people who can actually hold tasks (HR and admins can't, for example).
  const [assignable, setAssignable] = useState<ActivePerson[]>([]);
  useEffect(() => {
    apiFetch<ActivePerson[]>('/projects/assignable-users')
      .then((list) => {
        setAssignable(list);
        // The person who wrote the message is the usual owner, when they can be.
        if (message.author && list.some((p) => p.id === message.author!.id)) setAssigneeId(message.author.id);
      })
      .catch(() => setAssignable([]));
  }, [message.author]);
  const [deadline, setDeadline] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; projectId: string } | null>(null);

  async function save() {
    if (!projectId || title.trim().length < 3) return;
    setBusy(true);
    setError(null);
    try {
      const author = message.author?.name ?? 'Someone';
      const quoted = message.body || message.files.map((f) => f.name).join(', ');
      const task = await apiFetch<{ id: string }>('/tasks', {
        method: 'POST',
        body: JSON.stringify({
          projectId,
          title: title.trim(),
          description: `From chat (${roomName}), ${author} wrote:\n\n${quoted}`.slice(0, 5000),
          assigneeId: assigneeId || undefined,
          deadline: deadline || undefined,
        }),
      });
      setCreated({ id: task.id, projectId });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the task.');
    } finally {
      setBusy(false);
    }
  }

  const field =
    'mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-accent/40 focus:outline-none focus:ring-2 focus:ring-accent/20';

  if (created) {
    return (
      <Dialog title="Task created" onClose={onClose}>
        <div className="px-5 py-5">
          <p className="text-sm text-slate-700">
            <span className="font-semibold">{title.trim()}</span> was added to{' '}
            {projects.find((p) => p.id === created.projectId)?.name ?? 'the project'}.
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button
            size="sm"
            onClick={() => window.open(`/projects/${created.projectId}?task=${created.id}`, '_blank')}
          >
            Open task
          </Button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title="Make a task" onClose={onClose}>
      <div className="space-y-4 px-5 py-4">
        <div className="rounded-lg border-l-2 border-accent/50 bg-slate-50 px-3 py-2 text-xs text-slate-500">
          <span className="font-semibold text-slate-700">{message.author?.name ?? 'Someone'}: </span>
          <span className="line-clamp-3">{message.body || message.files.map((f) => f.name).join(', ')}</span>
        </div>
        <label className="block text-xs font-medium text-slate-600">
          Project
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={field}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-medium text-slate-600">
          Task title
          <input value={title} maxLength={255} autoFocus onChange={(e) => setTitle(e.target.value)} className={field} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs font-medium text-slate-600">
            Assign to
            <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={field}>
              <option value="">Nobody yet</option>
              {assignable.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium text-slate-600">
            Due date
            <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className={field} />
          </label>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-3">
        <span className="text-xs text-red-600">{error}</span>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={!projectId || title.trim().length < 3 || busy} onClick={() => void save()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create task'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** A message of yours waiting to be sent later. */
interface ScheduledItem {
  id: string;
  roomId: string;
  body: string;
  sendAt: string;
}

/** "Today 4:30 PM", "Tomorrow 9:00 AM", "Mon 12 Oct, 9:00 AM". */
function fmtWhen(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `Today ${time}`;
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow ${time}`;
  return `${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}, ${time}`;
}

const URL_RE = String.raw`https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]`;

/**
 * Message text with light formatting: @mentions (only real names), links that
 * open in a new tab, **bold**, _italic_, `code`, and lines starting with "- "
 * shown as a bulleted list. Plain text in, React elements out — never raw HTML.
 */
function RichText({ body, names }: { body: string; names: string[] }) {
  const escaped = names
    .slice()
    .sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const mention = escaped.length ? `|@(?<men>${escaped.join('|')})` : '';
  const re = new RegExp(
    `(?<url>${URL_RE})|\\*\\*(?<bold>[^*\\n]+)\\*\\*|\`(?<code>[^\`\\n]+)\`|(?<![\\w])_(?<it>[^_\\n]+)_(?![\\w])${mention}`,
    'gi',
  );

  const inline = (text: string, key: string): React.ReactNode[] => {
    const out: React.ReactNode[] = [];
    let last = 0;
    re.lastIndex = 0;
    for (let m = re.exec(text); m !== null; m = re.exec(text)) {
      if (m.index > last) out.push(text.slice(last, m.index));
      const g = m.groups ?? {};
      const k = `${key}-${m.index}`;
      if (g.url) {
        out.push(
          <a key={k} href={g.url} target="_blank" rel="noopener noreferrer" className="[overflow-wrap:anywhere] text-accent underline underline-offset-2 hover:opacity-80">
            {g.url}
          </a>,
        );
      } else if (g.bold) out.push(<strong key={k} className="font-semibold text-slate-800">{g.bold}</strong>);
      else if (g.code) out.push(<code key={k} className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[12px] text-slate-800">{g.code}</code>);
      else if (g.it) out.push(<em key={k}>{g.it}</em>);
      else if (g.men) out.push(<span key={k} className="rounded bg-accent/10 px-1 font-medium text-accent">{m[0]}</span>);
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  };

  // Group consecutive "- " lines into one list; keep everything else as text lines.
  const blocks: React.ReactNode[] = [];
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const bullet = /^\s*[-*\u2022]\s+(.*)$/.exec(lines[i]!);
    if (bullet) {
      const items: string[] = [];
      while (i < lines.length) {
        const b = /^\s*[-*\u2022]\s+(.*)$/.exec(lines[i]!);
        if (!b) break;
        items.push(b[1]!);
        i++;
      }
      i--;
      blocks.push(
        <ul key={`ul-${i}`} className="my-0.5 list-disc space-y-0.5 pl-5">
          {items.map((it, j) => (
            <li key={j}>{inline(it, `li-${i}-${j}`)}</li>
          ))}
        </ul>,
      );
    } else {
      blocks.push(
        <span key={`ln-${i}`} className="whitespace-pre-wrap">
          {inline(lines[i]!, `ln-${i}`)}
          {i < lines.length - 1 && !/^\s*[-*\u2022]\s+/.test(lines[i + 1] ?? '') ? '\n' : ''}
        </span>,
      );
    }
  }
  return <>{blocks}</>;
}

/** Quick "send later" choices, or any date and time. */
function SchedulePicker({ onPick, onClose }: { onPick: (d: Date) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [custom, setCustom] = useState('');
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const at9 = (daysAhead: number) => {
    const d = new Date();
    d.setDate(d.getDate() + daysAhead);
    d.setHours(9, 0, 0, 0);
    return d;
  };
  const nextMonday = () => {
    const d = new Date();
    const add = ((8 - d.getDay()) % 7) || 7;
    return at9(add);
  };
  const options: { label: string; when: Date }[] = [
    { label: 'In 1 hour', when: new Date(Date.now() + 60 * 60 * 1000) },
    { label: 'Tomorrow morning', when: at9(1) },
    { label: 'Monday morning', when: nextMonday() },
  ];
  const minLocal = new Date(Date.now() + 2 * 60 * 1000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Send later"
      className="absolute bottom-full right-0 z-30 mb-2 w-72 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl"
    >
      <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Send later</p>
      {options.map((o) => (
        <button
          key={o.label}
          onClick={() => onPick(o.when)}
          className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
        >
          <span className="whitespace-nowrap">{o.label}</span>
          <span className="whitespace-nowrap text-xs text-slate-400">{fmtWhen(o.when.toISOString())}</span>
        </button>
      ))}
      <div className="mt-1 border-t border-slate-100 px-3 pb-2 pt-2">
        <label className="text-xs font-medium text-slate-600">
          Pick a date and time
          <input
            type="datetime-local"
            min={minLocal}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm text-slate-800 focus:border-accent/40 focus:outline-none"
          />
        </label>
        <Button size="sm" className="mt-2 w-full" disabled={!custom} onClick={() => onPick(new Date(custom))}>
          Schedule
        </Button>
      </div>
    </div>
  );
}

/** Pick a conversation to forward a message to. */
function ForwardDialog({
  message,
  rooms,
  onClose,
  onOpen,
}: {
  message: ChatMessage;
  rooms: Room[];
  onClose: () => void;
  onOpen: (roomId: string) => void;
}) {
  const [q, setQ] = useState('');
  const [done, setDone] = useState<Room | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = rooms.filter((r) => r.name.toLowerCase().includes(q.trim().toLowerCase()));

  async function forwardTo(r: Room) {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/chat/messages/${message.id}/forward`, { method: 'POST', body: JSON.stringify({ roomId: r.id }) });
      setDone(r);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not forward that message.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Dialog title="Forwarded" onClose={onClose}>
        <p className="px-5 py-5 text-sm text-slate-700">
          Sent to <span className="font-semibold">{done.name}</span>.
        </p>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Stay here
          </Button>
          <Button size="sm" onClick={() => onOpen(done.id)}>
            Open {done.kind === 'DIRECT' ? 'chat' : done.name}
          </Button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title="Forward to" onClose={onClose}>
      <div className="px-5 pt-4">
        <p className="line-clamp-2 rounded-lg border-l-2 border-accent/50 bg-slate-50 px-3 py-2 text-xs text-slate-500">
          {message.body || message.files.map((f) => f.name).join(', ')}
        </p>
        <label className="mt-3 flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 focus-within:border-accent/40 focus-within:ring-2 focus-within:ring-accent/20">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search conversations"
            className="flex-1 bg-transparent text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
          />
        </label>
      </div>
      <ul className="mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {shown.map((r) => (
          <li key={r.id}>
            <button
              disabled={busy}
              onClick={() => void forwardTo(r)}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-slate-50 disabled:opacity-50"
            >
              <RoomAvatar room={r} />
              <span className="flex-1 truncate text-sm text-slate-700">{r.name}</span>
            </button>
          </li>
        ))}
        {shown.length === 0 ? <li className="px-3 py-6 text-center text-sm text-slate-400">No conversations match.</li> : null}
      </ul>
      {error ? <p className="border-t border-slate-100 px-5 py-3 text-xs text-red-600">{error}</p> : null}
    </Dialog>
  );
}

interface SharedFile extends Attachment {
  messageId: string;
  sharedAt: string;
  sharedBy: ActivePerson | null;
}

/** Everything ever shared in a conversation, newest first. */
function FilesDialog({
  room,
  onClose,
  onDownload,
  onShow,
}: {
  room: Room;
  onClose: () => void;
  onDownload: (versionId: string) => void;
  onShow: (messageId: string) => void;
}) {
  const [files, setFiles] = useState<SharedFile[] | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    apiFetch<SharedFile[]>(`/chat/rooms/${room.id}/files`)
      .then(setFiles)
      .catch(() => setFiles([]));
  }, [room.id]);
  const shown = (files ?? []).filter((f) => f.name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <Dialog title={`Files in ${room.name}`} onClose={onClose}>
      <div className="px-5 pt-4">
        <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 focus-within:border-accent/40 focus-within:ring-2 focus-within:ring-accent/20">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search file names"
            className="flex-1 bg-transparent text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
          />
        </label>
      </div>
      <ul className="mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {files === null ? <li className="px-3 py-6 text-center text-sm text-slate-400">Loading…</li> : null}
        {files !== null && shown.length === 0 ? (
          <li className="px-3 py-6 text-center text-sm text-slate-400">
            {files.length === 0 ? 'No files have been shared here yet.' : 'No files match.'}
          </li>
        ) : null}
        {shown.map((f) => (
          <li key={f.id} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-slate-50">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
              <FileText className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-700">{f.name}</p>
              <p className="truncate text-xs text-slate-400">
                {[fmtSize(f.sizeBytes), f.sharedBy?.name, fmtWhen(f.sharedAt)].filter(Boolean).join(' · ')}
              </p>
            </div>
            <button onClick={() => onShow(f.messageId)} className="shrink-0 text-xs font-medium text-slate-500 hover:text-accent">
              Show in chat
            </button>
            {f.scanStatus === 'AVAILABLE' ? (
              <button
                onClick={() => onDownload(f.versionId)}
                title={`Download ${f.name}`}
                aria-label={`Download ${f.name}`}
                className="shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-white hover:text-slate-700"
              >
                <Download className="h-4 w-4" />
              </button>
            ) : (
              <span className="shrink-0 text-xs text-slate-400">{f.scanStatus === 'INFECTED' ? 'Quarantined' : 'Checking…'}</span>
            )}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

interface StorageSummary {
  files: number;
  bytes: number;
  uploadLimitBytes: number;
  byRoom: { room: string; files: number; bytes: number }[];
  biggest: { name: string; bytes: number; uploadedAt: string; room: string }[];
}

/** HR / Super Admin: how much server space chat files use. */
function StorageDialog({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<StorageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiFetch<StorageSummary>('/chat/storage')
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load storage.'));
  }, []);
  const top = data?.byRoom[0]?.bytes || 1;

  return (
    <Dialog title="Chat file storage" onClose={onClose}>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        {!data && !error ? <p className="text-sm text-slate-400">Loading…</p> : null}
        {data ? (
          <>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl bg-slate-50 px-3 py-3">
                <p className="text-[11px] uppercase tracking-wide text-slate-400">Space used</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-slate-800">{fmtSize(data.bytes) || '0 B'}</p>
              </div>
              <div className="rounded-xl bg-slate-50 px-3 py-3">
                <p className="text-[11px] uppercase tracking-wide text-slate-400">Files</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-slate-800">{data.files}</p>
              </div>
              <div className="rounded-xl bg-slate-50 px-3 py-3">
                <p className="text-[11px] uppercase tracking-wide text-slate-400">Per-file limit</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-slate-800">{fmtSize(data.uploadLimitBytes)}</p>
              </div>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              The per-file limit applies to every upload in the ERP and can be changed by a Super Admin in Admin settings.
            </p>

            <p className="mt-5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">By conversation</p>
            <ul className="mt-2 space-y-2">
              {data.byRoom.map((r, i) => (
                <li key={i}>
                  <div className="flex justify-between text-xs">
                    <span className="truncate text-slate-700">{r.room}</span>
                    <span className="shrink-0 tabular-nums text-slate-500">
                      {fmtSize(r.bytes)} · {r.files} file{r.files === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                    <div className="h-1.5 rounded-full bg-accent/70" style={{ width: `${Math.max(4, (r.bytes / top) * 100)}%` }} />
                  </div>
                </li>
              ))}
              {data.byRoom.length === 0 ? <li className="text-sm text-slate-400">No files shared yet.</li> : null}
            </ul>

            {data.biggest.length > 0 ? (
              <>
                <p className="mt-5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Largest files</p>
                <ul className="mt-1 divide-y divide-slate-100">
                  {data.biggest.map((b, i) => (
                    <li key={i} className="flex items-center gap-3 py-2 text-xs">
                      <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <span className="min-w-0 flex-1 truncate text-slate-700">{b.name}</span>
                      <span className="shrink-0 text-slate-400">{b.room}</span>
                      <span className="w-16 shrink-0 text-right font-medium tabular-nums text-slate-600">{fmtSize(b.bytes)}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </>
        ) : null}
      </div>
    </Dialog>
  );
}

export default function ChatPage() {
  // useSearchParams needs a Suspense boundary in the App Router.
  return (
    <Suspense fallback={<LoadingState />}>
      <ChatScreen />
    </Suspense>
  );
}

function ChatScreen() {
  const me = useMe();
  const params = useSearchParams();
  const roomFromUrl = params.get('room');
  const messageFromUrl = params.get('message');
  // /chat?dm=<userId> (Message from search): open, or start, a one-to-one with them.
  const dmFromUrl = params.get('dm');
  const canManage = CAN_MODERATE.includes(me.role);
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [selectedId, setSelectedId] = useState<string>(COMPANY_ROOM_ID);
  const [staff, setStaff] = useState<ActivePerson[]>([]);
  const [active, setActive] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [dialog, setDialog] = useState<'group' | 'direct' | 'people' | null>(null);
  // Small screens show the list OR the conversation, never both.
  const [mobileRoomOpen, setMobileRoomOpen] = useState(false);
  // The message to bring into view: from a notification link or a search result.
  const [focus, setFocus] = useState<{ roomId: string; messageId: string; n: number } | null>(null);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [taskProjects, setTaskProjects] = useState<TaskProject[]>([]);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [storageOpen, setStorageOpen] = useState(false);
  const [typingIn, setTypingIn] = useState<Record<string, { name: string; userId: string; at: number }>>({});
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  const loadRooms = useCallback(() => {
    apiFetch<Room[]>('/chat/rooms')
      .then((list) => {
        // The open room is being read right now, so it has nothing unread.
        setRooms(list.map((r) => (r.id === selectedRef.current ? { ...r, unread: 0 } : r)));
        // Taken out of the group you were looking at: back to the company room.
        if (!list.some((r) => r.id === selectedRef.current)) setSelectedId(COMPANY_ROOM_ID);
      })
      .catch(() => setRooms((prev) => prev ?? []));
  }, []);

  const loadActive = useCallback(() => {
    apiFetch<ActivePerson[]>('/chat/active')
      .then((list) => setActive(list.map((p) => p.id)))
      .catch(() => undefined);
  }, []);

  // A link like /chat?room=<id>&message=<id> (a mention notification) opens
  // that room, even when the chat is already on screen.
  useEffect(() => {
    if (!roomFromUrl) return;
    selectedRef.current = roomFromUrl;
    setSelectedId(roomFromUrl);
    setMobileRoomOpen(true);
    setRooms((prev) => (prev ? prev.map((r) => (r.id === roomFromUrl ? { ...r, unread: 0 } : r)) : prev));
    if (messageFromUrl) setFocus((f) => ({ roomId: roomFromUrl, messageId: messageFromUrl, n: (f?.n ?? 0) + 1 }));
  }, [roomFromUrl, messageFromUrl]);

  useEffect(() => {
    if (!dmFromUrl || dmFromUrl === me.id) return;
    apiFetch<{ id: string }>('/chat/direct', { method: 'POST', body: JSON.stringify({ userId: dmFromUrl }) })
      .then((room) => {
        selectedRef.current = room.id;
        setSelectedId(room.id);
        setMobileRoomOpen(true);
        loadRooms();
      })
      .catch(() => undefined);
  }, [dmFromUrl, me.id, loadRooms]);

  useEffect(() => {
    loadRooms();
    loadActive();
    apiFetch<ActivePerson[]>('/chat/members').then(setStaff).catch(() => undefined);
    // "Make a task" is for whoever may add tasks: HR / Super Admin anywhere,
    // everyone else on the projects they manage. The API checks again on save.
    apiFetch<TaskProject[]>('/projects')
      .then((list) => setTaskProjects(canManage ? list : list.filter((p) => p.pm?.id === me.id)))
      .catch(() => undefined);
  }, [loadRooms, loadActive, canManage, me.id]);

  // Typing 2+ letters in the box also searches messages and file names.
  const query = filter.trim();
  useEffect(() => {
    if (query.length < 2) {
      setHits(null);
      return;
    }
    const t = setTimeout(() => {
      apiFetch<SearchHit[]>(`/chat/search?q=${encodeURIComponent(query)}`)
        .then(setHits)
        .catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  // Keep previews, order and unread counts live. Bursts collapse into one reload.
  useEffect(() => {
    const socket = connectPresence();
    let t: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(t);
      t = setTimeout(loadRooms, 400);
    };
    socket.on('chat:message', soon);
    socket.on('chat:messageDeleted', soon);
    socket.on('chat:roomsChanged', soon);
    socket.on('chat:read', ({ userId }: { userId: string }) => userId === me.id && soon());
    socket.on('presence:update', loadActive);
    // "Asha is typing…" in the conversation list, not just inside the chat.
    socket.on('chat:typing', ({ userId, name, roomId }: { userId: string; name: string; roomId?: string | null }) => {
      if (userId === me.id) return;
      setTypingIn((prev) => ({ ...prev, [roomId ?? COMPANY_ROOM_ID]: { name: name || 'Someone', userId, at: Date.now() } }));
    });
    socket.on('chat:message', (m: ChatMessage) => {
      const key = m.roomId ?? COMPANY_ROOM_ID;
      setTypingIn((prev) => {
        if (prev[key]?.userId !== m.author?.id) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
    });
    return () => {
      clearTimeout(t);
      socket.close();
    };
  }, [loadRooms, loadActive, me.id]);

  useEffect(() => {
    if (Object.keys(typingIn).length === 0) return;
    const t = setInterval(() => {
      setTypingIn((prev) => {
        const now = Date.now();
        const next = Object.fromEntries(Object.entries(prev).filter(([, v]) => now - v.at < TYPING_TTL_MS));
        return Object.keys(next).length === Object.keys(prev).length ? prev : next;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [typingIn]);

  function select(id: string) {
    selectedRef.current = id;
    setSelectedId(id);
    setMobileRoomOpen(true);
    setRooms((prev) => (prev ? prev.map((r) => (r.id === id ? { ...r, unread: 0 } : r)) : prev));
  }

  function opened(id: string) {
    setDialog(null);
    select(id);
    loadRooms();
  }

  function openHit(h: SearchHit) {
    select(h.roomId);
    setFocus((f) => ({ roomId: h.roomId, messageId: h.id, n: (f?.n ?? 0) + 1 }));
  }

  if (!rooms) return <LoadingState />;

  const selected = rooms.find((r) => r.id === selectedId) ?? rooms[0];
  const q = filter.trim().toLowerCase();
  const visible = q ? rooms.filter((r) => r.name.toLowerCase().includes(q)) : rooms;
  const company = visible.filter((r) => r.kind === 'COMPANY');
  const groups = visible.filter((r) => r.kind === 'GROUP');
  const directs = visible.filter((r) => r.kind === 'DIRECT');

  const addButton = (label: string, onClick: () => void) => (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="rounded-md p-1 text-slate-400 hover:bg-white hover:text-accent"
    >
      <Plus className="h-3.5 w-3.5" />
    </button>
  );

  const section = (label: string, list: Room[], emptyText: string, action?: React.ReactNode) => (
    <div className="mt-4 first:mt-0">
      <div className="flex h-6 items-center justify-between px-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
        {action}
      </div>
      {list.length === 0 ? (
        <p className="px-2.5 py-1.5 text-xs text-slate-400">{emptyText}</p>
      ) : (
        <div className="space-y-0.5">
          {list.map((r) => (
            <RoomRow
              key={r.id}
              room={r}
              meId={me.id}
              selected={selected?.id === r.id}
              active={Boolean(r.other && active.includes(r.other.id))}
              typing={r.id === selected?.id ? undefined : typingIn[r.id]?.name}
              onSelect={() => select(r.id)}
            />
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div
      className={`flex gap-4 ${
        desktopHost() ? 'h-[calc(100dvh-1.5rem)]' : 'h-[calc(100dvh-6rem)] sm:h-[calc(100vh-7rem)]'
      }`}
    >
      {/* Conversation list */}
      <aside
        className={`${
          mobileRoomOpen ? 'hidden' : 'flex'
        } min-h-0 w-full flex-col rounded-2xl border border-slate-200 bg-white shadow-glass md:flex md:w-72 md:shrink-0`}
      >
        <div className="flex items-center justify-between px-4 pb-2 pt-4">
          <h1 className="text-lg font-semibold text-slate-800">Chat</h1>
          <div className="relative flex items-center gap-1">
            {canManage ? (
              <button
                onClick={() => setStorageOpen(true)}
                title="Chat file storage"
                aria-label="Chat file storage"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-white hover:text-slate-600"
              >
                <HardDrive className="h-4 w-4" />
              </button>
            ) : null}
            {!desktopHost() ? (
              <button
                onClick={() => setAlertsOpen((o) => !o)}
                title="Sounds and pop-ups"
                aria-label="Sounds and pop-ups"
                aria-expanded={alertsOpen}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-white hover:text-slate-600"
              >
                <Settings2 className="h-4 w-4" />
              </button>
            ) : null}
            <button
              onClick={() => setDialog('direct')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-semibold text-accent-foreground hover:opacity-90"
            >
              <Plus className="h-3.5 w-3.5" />
              New chat
            </button>
            {alertsOpen ? <AlertSettings onClose={() => setAlertsOpen(false)} /> : null}
          </div>
        </div>
        <div className="px-3 pb-3">
          <label className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 ring-1 ring-slate-200/70 focus-within:ring-2 focus-within:ring-accent/30">
            <Search className="h-3.5 w-3.5 text-slate-400" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search chats and messages"
              className="flex-1 bg-transparent text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
            />
          </label>
        </div>
        <nav aria-label="Conversations" className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {hits !== null ? (
            <div className="mb-4">
              <div className="flex h-6 items-center px-2.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Messages</span>
              </div>
              {hits.length === 0 ? (
                <p className="px-2.5 py-1.5 text-xs text-slate-400">No messages match.</p>
              ) : (
                <div className="space-y-0.5">
                  {hits.map((h) => (
                    <button
                      key={h.id}
                      onClick={() => openHit(h)}
                      className="flex w-full flex-col rounded-xl px-2.5 py-2 text-left hover:bg-slate-50"
                    >
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-xs font-semibold text-slate-700">
                          {h.author?.id === me.id ? 'You' : (h.author?.name ?? 'Someone')}
                          <span className="font-normal text-slate-400"> in {h.roomName}</span>
                        </span>
                        <span className="shrink-0 text-[11px] text-slate-400">{listTime(h.createdAt)}</span>
                      </span>
                      <span className="mt-0.5 line-clamp-2 text-xs text-slate-500">
                        <Highlight text={plainText(h.body) || h.fileNames.join(', ')} term={query} />
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : null}
          {company.length > 0 ? section('Company', company, '') : null}
          {section(
            'Groups',
            groups,
            q ? 'No groups match.' : canManage ? 'No groups yet. Create one with +.' : 'HR adds you to groups.',
            canManage ? addButton('Create a group', () => setDialog('group')) : undefined,
          )}
          {section(
            'Direct messages',
            directs,
            q ? 'No chats match.' : 'No one-to-one chats yet.',
            addButton('Message someone', () => setDialog('direct')),
          )}
        </nav>
      </aside>

      {/* The open conversation, remounted per room so nothing leaks between them */}
      <div className={`${mobileRoomOpen ? 'flex' : 'hidden'} min-h-0 min-w-0 flex-1 md:flex`}>
        {selected ? (
          <RoomView
            key={`${selected.id}:${focus?.roomId === selected.id ? focus.n : 0}`}
            focusMessageId={focus?.roomId === selected.id ? focus.messageId : null}
            room={selected}
            staff={staff}
            onBack={() => setMobileRoomOpen(false)}
            onPeople={() => setDialog('people')}
            taskProjects={taskProjects}
            onMutedChange={(muted) =>
              setRooms((prev) => (prev ? prev.map((r) => (r.id === selected.id ? { ...r, muted } : r)) : prev))
            }
            rooms={rooms}
            onOpenRoom={(id) => {
              select(id);
              loadRooms();
            }}
          />
        ) : null}
      </div>

      {storageOpen ? <StorageDialog onClose={() => setStorageOpen(false)} /> : null}
      {dialog === 'group' ? (
        <NewGroupDialog staff={staff} meId={me.id} onClose={() => setDialog(null)} onCreated={opened} />
      ) : null}
      {dialog === 'direct' ? (
        <NewChatDialog staff={staff} meId={me.id} activeIds={active} onClose={() => setDialog(null)} onOpened={opened} />
      ) : null}
      {dialog === 'people' && selected?.kind === 'GROUP' ? (
        <PeopleDialog
          room={selected}
          staff={staff}
          activeIds={active}
          canManage={canManage}
          onClose={() => {
            setDialog(null);
            loadRooms();
          }}
        />
      ) : null}
    </div>
  );
}
