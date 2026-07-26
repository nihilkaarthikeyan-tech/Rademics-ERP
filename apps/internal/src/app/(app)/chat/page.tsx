'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Download,
  FileText,
  Loader2,
  Paperclip,
  SendHorizonal,
  ShieldAlert,
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

interface ChatMessage {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string } | null;
  files: Attachment[];
}

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
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  return (
    <div className="mx-auto flex h-[calc(100vh-7.5rem)] max-w-3xl flex-col">
      {/* Header: room identity + who is actually around */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Chat</h1>
          <p className="mt-1 text-sm text-slate-500">The company room — everyone on staff is here.</p>
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
        <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-4 py-3">
          {hasMore ? (
            <div className="mb-3 flex justify-center">
              <Button size="sm" variant="ghost" onClick={() => void loadEarlier()}>
                Load earlier messages
              </Button>
            </div>
          ) : null}

          {messages && messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent/10 text-accent">
                <SendHorizonal className="h-5 w-5" />
              </span>
              <p className="text-sm font-medium text-slate-700">No messages yet</p>
              <p className="max-w-xs text-sm text-slate-400">
                Say hello — everyone on staff sees this room. You can share files here too.
              </p>
            </div>
          ) : null}

          {/* Bottom-anchored: a short conversation sits at the composer, not
              stranded at the top of an empty slab. */}
          <ul className="flex min-h-full flex-col justify-end gap-0.5">
            {(messages ?? []).map((m, i) => {
              const prev = i > 0 ? messages![i - 1] : null;
              const mine = m.author?.id === me.id;
              const name = m.author?.name ?? 'Someone';
              const newDay = !prev || dayLabel(prev.createdAt) !== dayLabel(m.createdAt);
              // Consecutive messages from one person collapse under one avatar.
              const grouped =
                !newDay &&
                prev?.author?.id === m.author?.id &&
                new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_WINDOW_MS;

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

                  <div
                    className={`group flex items-start gap-2.5 rounded-lg px-2 py-1 transition-colors hover:bg-white/70 ${
                      grouped ? '' : 'mt-2'
                    }`}
                  >
                    {grouped ? (
                      // Keeps the text aligned, and reveals the time on hover.
                      <span className="w-7 shrink-0 pt-0.5 text-right text-[10px] leading-5 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100">
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
                      {m.body ? (
                        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">
                          {m.body}
                        </p>
                      ) : null}

                      {m.files.length > 0 ? (
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
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Composer */}
        <div className="border-t border-white/70 bg-white/50 p-3">
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
              placeholder="Write a message…  (Enter to send, Shift+Enter for a new line)"
              value={draft}
              maxLength={2000}
              onChange={(e) => {
                setDraft(e.target.value);
                autoGrow(e.target);
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
