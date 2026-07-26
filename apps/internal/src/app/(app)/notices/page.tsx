'use client';

import { useCallback, useEffect, useState } from 'react';
import { Megaphone, Pin } from 'lucide-react';
import { Button, EmptyState, Input, Label, LoadingState } from '@rademics/ui';
import { apiFetch, ApiError } from '@/lib/api';
import { useMe } from '@/lib/me-context';

interface Notice {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  createdBy: { id: string; name: string } | null;
  pinnedByMe: boolean;
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
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

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

  async function post(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/announcements', { method: 'POST', body: JSON.stringify({ title, body }) });
      setTitle('');
      setBody('');
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
        {(notices ?? []).map((n) => (
          <article
            key={n.id}
            className="rounded-xl border border-white/70 bg-white/60 p-4 shadow-glass backdrop-blur-xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2.5">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
                  <Megaphone className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-slate-800">{n.title}</h2>
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
        ))}
      </div>
    </div>
  );
}
