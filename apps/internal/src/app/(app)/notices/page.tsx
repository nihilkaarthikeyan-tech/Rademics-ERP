'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Megaphone, Pin } from 'lucide-react';
import { Badge, Button, EmptyState, Input, Label, LoadingState } from '@rademics/ui';
import { apiFetch, ApiError } from '@/lib/api';
import { useMe } from '@/lib/me-context';
import { connectPresence } from '@/lib/socket';

interface Notice {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  createdBy: { id: string; name: string } | null;
  pinnedByMe: boolean;
  requiresAck: boolean;
  acknowledgedByMe: boolean;
  /** Only present for the viewer's own eyes when they're SA/HR (a management concern). */
  ackStats?: { total: number; acknowledged: number };
}

interface PendingPerson {
  id: string;
  name: string;
  email: string;
}

const CAN_POST = ['SUPER_ADMIN', 'HR'];

function relTime(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  if (hours < 48) return 'yesterday';
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  const date = new Date(iso);
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  if (date.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return date.toLocaleDateString(undefined, opts);
}

export default function NoticesPage() {
  const me = useMe();
  const canPost = CAN_POST.includes(me.role);
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [requiresAck, setRequiresAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [pendingOpenFor, setPendingOpenFor] = useState<string | null>(null);
  const [pendingList, setPendingList] = useState<PendingPerson[] | null>(null);

  const load = useCallback(async () => {
    try {
      setNotices(await apiFetch<Notice[]>('/announcements'));
    } catch {
      setError('Could not load notices.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Live: a page left open all day must show a new notice without a manual
  // reload — the same socket chat already uses, just its own event names.
  // Posting/removing calls load() itself too; the socket echo just re-runs
  // the same idempotent fetch, which is harmless.
  useEffect(() => {
    const socket = connectPresence();
    socket.on('announcement:posted', () => void load());
    socket.on('announcement:removed', ({ id }: { id: string }) => {
      setNotices((prev) => (prev ? prev.filter((n) => n.id !== id) : prev));
    });
    return () => {
      socket.close();
    };
  }, [load]);

  async function post(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/announcements', { method: 'POST', body: JSON.stringify({ title, body, requiresAck }) });
      setTitle('');
      setBody('');
      setRequiresAck(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not post the notice.');
    } finally {
      setBusy(false);
    }
  }

  async function togglePin(n: Notice) {
    // Optimistic: the pin flips instantly, the list re-sorts on reload.
    setNotices((prev) =>
      prev ? prev.map((x) => (x.id === n.id ? { ...x, pinnedByMe: !x.pinnedByMe } : x)) : prev,
    );
    await apiFetch(`/announcements/${n.id}/pin`, {
      method: 'POST',
      body: JSON.stringify({ pinned: !n.pinnedByMe }),
    }).catch(() => undefined);
    await load();
  }

  async function acknowledge(n: Notice) {
    // Optimistic: the button/banner settles immediately.
    setNotices((prev) =>
      prev
        ? prev.map((x) =>
            x.id === n.id
              ? {
                  ...x,
                  acknowledgedByMe: true,
                  ackStats: x.ackStats ? { ...x.ackStats, acknowledged: x.ackStats.acknowledged + 1 } : undefined,
                }
              : x,
          )
        : prev,
    );
    try {
      await apiFetch(`/announcements/${n.id}/acknowledge`, { method: 'POST', body: '{}' });
    } catch {
      await load(); // roll back to server truth if the click didn't actually land
    }
  }

  async function togglePending(id: string) {
    if (pendingOpenFor === id) {
      setPendingOpenFor(null);
      return;
    }
    setPendingOpenFor(id);
    setPendingList(null);
    try {
      setPendingList(await apiFetch<PendingPerson[]>(`/announcements/${id}/pending`));
    } catch {
      setPendingList([]);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await apiFetch(`/announcements/${id}`, { method: 'DELETE' });
      setConfirmDelete(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove the notice.');
    } finally {
      setBusy(false);
    }
  }

  if (!notices && !error) return <LoadingState />;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-xl font-semibold text-slate-800">Notices</h1>
      <p className="mt-1 text-sm text-slate-500">
        Company announcements. Pin the ones you want kept on top — pins are yours alone.
      </p>

      {canPost ? (
        <form
          onSubmit={post}
          className="mt-4 rounded-xl border border-white/70 bg-white/60 p-4 shadow-glass backdrop-blur-xl"
        >
          <Label htmlFor="n-title">Post a notice</Label>
          <Input
            id="n-title"
            placeholder="What should everyone know?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            minLength={3}
            required
          />
          <textarea
            rows={3}
            placeholder="The details — everyone on staff sees this and is notified."
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
            className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          <label className="mt-2 flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 p-2.5 text-sm text-slate-700">
            <input
              type="checkbox"
              className="mt-0.5 accent-accent"
              checked={requiresAck}
              onChange={(e) => setRequiresAck(e.target.checked)}
            />
            <span>
              Mark as important — requires acknowledgment
              <span className="mt-0.5 block text-xs font-normal text-slate-500">
                Stays flagged at the top of everyone's list until they personally click "I've read this."
                Reserve this for things that truly matter — using it often trains people to stop reading.
              </span>
            </span>
          </label>
          <div className="mt-2 flex justify-end">
            <Button type="submit" size="sm" disabled={busy || !title.trim() || !body.trim()}>
              {busy ? 'Posting…' : 'Post notice'}
            </Button>
          </div>
        </form>
      ) : null}

      {error ? <p className="mt-3 text-sm font-medium text-red-600">{error}</p> : null}

      <div className="mt-4 flex flex-col gap-3">
        {notices && notices.length === 0 ? (
          <EmptyState
            title="No notices yet"
            description={
              canPost
                ? 'Post the first company announcement — everyone on staff is notified.'
                : 'Company announcements will appear here.'
            }
          />
        ) : null}
        {(notices ?? []).map((n) => {
          const needsMyAck = n.requiresAck && !n.acknowledgedByMe;
          return (
            <article
              key={n.id}
              className={`rounded-xl border p-4 shadow-glass backdrop-blur-xl ${
                needsMyAck ? 'border-warning/40 bg-warning-soft/60' : 'border-white/70 bg-white/60'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-2.5">
                  <span
                    className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                      needsMyAck ? 'bg-warning/15 text-warning' : 'bg-accent/10 text-accent'
                    }`}
                  >
                    {needsMyAck ? <AlertTriangle className="h-3.5 w-3.5" /> : <Megaphone className="h-3.5 w-3.5" />}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <h2 className="text-sm font-semibold text-slate-800">{n.title}</h2>
                      {n.requiresAck ? <Badge tone="amber">Important</Badge> : null}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-600">{n.body}</p>
                    <p className="mt-2 text-xs text-slate-400" title={new Date(n.createdAt).toLocaleString()}>
                      {n.createdBy?.name ?? 'Rademics'} · {relTime(n.createdAt)}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => void togglePin(n)}
                  title={n.pinnedByMe ? 'Unpin' : 'Pin to top'}
                  aria-label={n.pinnedByMe ? 'Unpin this notice' : 'Pin this notice to the top'}
                  className={`shrink-0 rounded-md p-1.5 ${
                    n.pinnedByMe ? 'text-accent' : 'text-slate-300 hover:text-slate-500'
                  }`}
                >
                  <Pin className={`h-4 w-4 ${n.pinnedByMe ? 'fill-current' : ''}`} />
                </button>
              </div>

              {/* Acknowledgment — a distinct action from pinning, only for notices flagged important. */}
              {n.requiresAck ? (
                <div className="mt-3 border-t border-slate-200/60 pt-3">
                  {needsMyAck ? (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs text-slate-600">This one needs your confirmation.</span>
                      <Button size="sm" onClick={() => void acknowledge(n)}>
                        I've read this
                      </Button>
                    </div>
                  ) : (
                    <p className="flex items-center gap-1.5 text-xs text-success">
                      <CheckCircle2 className="h-3.5 w-3.5" /> You acknowledged this
                    </p>
                  )}
                  {canPost && n.ackStats ? (
                    <div className="mt-2">
                      <button
                        onClick={() => void togglePending(n.id)}
                        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
                      >
                        <ChevronDown
                          className={`h-3 w-3 transition-transform ${pendingOpenFor === n.id ? 'rotate-180' : ''}`}
                        />
                        {n.ackStats.acknowledged} of {n.ackStats.total} acknowledged
                        {n.ackStats.acknowledged < n.ackStats.total ? ' — see who hasn\'t' : ''}
                      </button>
                      {pendingOpenFor === n.id ? (
                        <div className="mt-1.5 rounded-md bg-white/70 p-2">
                          {pendingList === null ? (
                            <p className="text-xs text-slate-400">Loading…</p>
                          ) : pendingList.length === 0 ? (
                            <p className="text-xs text-slate-400">Everyone has acknowledged this.</p>
                          ) : (
                            <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
                              {pendingList.map((p) => (
                                <li key={p.id} title={p.email}>
                                  {p.name}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {canPost ? (
                <div className="mt-2 flex items-center justify-end gap-2">
                  {confirmDelete === n.id ? (
                    <>
                      <span className="text-xs text-slate-500">Remove this notice for everyone?</span>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmDelete(null)}>
                        Keep it
                      </Button>
                      <Button size="sm" variant="danger" disabled={busy} onClick={() => void remove(n.id)}>
                        Remove
                      </Button>
                    </>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(n.id)}
                      className="text-xs text-slate-400 underline-offset-2 hover:text-red-600 hover:underline"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}
