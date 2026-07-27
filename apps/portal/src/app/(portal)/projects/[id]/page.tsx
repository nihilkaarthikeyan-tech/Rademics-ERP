'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  BellRing,
  Check,
  Download,
  ListChecks,
  Milestone as MilestoneIcon,
  MessageSquareText,
} from 'lucide-react';
import { Badge, LoadingState } from '@rademics/ui';
import { apiFetch, ApiError } from '@/lib/api';
import { useAutoRefresh } from '@/lib/use-auto-refresh';

interface Milestone { id: string; name: string; percentComplete: number }
interface Item { id: string; title: string; status: string; deadline: string | null }
interface PortalProjectDetail {
  id: string;
  name: string;
  status: string;
  description: string | null;
  percentComplete: number;
  milestones: Milestone[];
  items: Item[];
}

// 2026-07-27: the client has no approval power — view + request-status only,
// so every status just reads as plain progress.
const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Not started', ASSIGNED: 'Planned', ACKNOWLEDGED: 'Planned', IN_PROGRESS: 'In progress',
  SUBMITTED_FOR_REVIEW: 'In review', COMPLETED: 'Completed', CLOSED: 'Completed', CANCELLED: 'Cancelled',
};

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

export default function PortalProjectDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [project, setProject] = useState<PortalProjectDetail | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'notfound' | 'error'>('loading');

  const load = useCallback(async () => {
    try {
      setProject(await apiFetch<PortalProjectDetail>(`/portal/projects/${id}`));
      setState('ready');
    } catch (e) {
      setState(e instanceof ApiError && e.status === 404 ? 'notfound' : 'error');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useAutoRefresh(load);

  if (state === 'loading') return <LoadingState />;
  if (state === 'notfound') return <p className="text-sm text-slate-500">This project isn&apos;t available.</p>;
  if (state === 'error' || !project) return <p className="text-sm text-slate-500">Could not load this project.</p>;

  return (
    <div>
      <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> Dashboard
      </Link>

      <div className="mt-3 flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#7C6CF6] to-[#A855F7] text-white">
          <ListChecks className="h-5 w-5" />
        </span>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-900">{project.name}</h1>
            <Badge tone="green">{project.percentComplete}% complete</Badge>
          </div>
          {project.description ? <p className="mt-0.5 text-sm text-slate-500">{project.description}</p> : null}
        </div>
      </div>

      {/* Milestones */}
      {project.milestones.length > 0 ? (
        <div className="mt-5 rounded-2xl border border-white/70 bg-white/65 backdrop-blur-xl p-5 shadow-glass">
          <div className="mb-3 flex items-center gap-2">
            <MilestoneIcon className="h-4 w-4 text-slate-500" />
            <h3 className="text-sm font-semibold text-slate-800">Milestones</h3>
          </div>
          <ul className="flex flex-col gap-3">
            {project.milestones.map((m) => (
              <li key={m.id}>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-700">{m.name}</span>
                  <span className="font-medium tabular-nums text-slate-400">{m.percentComplete}%</span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-gradient-to-r from-[#4F46E5] to-[#A855F7]" style={{ width: `${m.percentComplete}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Progress — every client-facing task, read-only status + shared files/updates + ask-for-status */}
      <div className="mt-5 rounded-2xl border border-white/70 bg-white/65 backdrop-blur-xl p-5 shadow-glass">
        <div className="mb-3 flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-slate-500" />
          <h3 className="text-sm font-semibold text-slate-800">Progress</h3>
        </div>
        {project.items.length === 0 ? (
          <p className="text-sm text-slate-400">No shared items yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-slate-100">
            {project.items.map((t) => (
              <li key={t.id} className="py-2.5">
                <div className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <span className="block truncate text-slate-700">{t.title}</span>
                    {t.deadline ? (
                      <span className="text-xs text-slate-400">Due {new Date(t.deadline).toLocaleDateString()}</span>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Badge tone={['COMPLETED', 'CLOSED'].includes(t.status) ? 'green' : 'slate'}>
                      {STATUS_LABEL[t.status] ?? t.status}
                    </Badge>
                  </div>
                </div>
                <TaskFiles taskId={t.id} />
                <TaskUpdatesFeed taskId={t.id} trailing={<RequestStatusButton taskId={t.id} />} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function TaskFiles({ taskId }: { taskId: string }) {
  const [files, setFiles] = useState<{ id: string; displayName: string; versions: { id: string; versionNumber: number }[] }[]>([]);

  useEffect(() => {
    apiFetch<typeof files>(`/portal/tasks/${taskId}/files`).then(setFiles).catch(() => setFiles([]));
  }, [taskId]);

  async function download(versionId: string) {
    try {
      const { url } = await apiFetch<{ url: string }>(`/portal/files/versions/${versionId}/download`);
      window.open(url, '_blank');
    } catch {
      /* silent */
    }
  }

  if (files.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-2">
      {files.map((f) => {
        const latest = f.versions[0];
        if (!latest) return null;
        return (
          <button key={f.id} onClick={() => download(latest.id)} className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50">
            <Download className="h-3 w-3" /> {f.displayName}
          </button>
        );
      })}
    </div>
  );
}

/**
 * "Ask for a status update" — a labelled button, not a "⋯" menu.
 *
 * A client visits rarely and will not go hunting behind an icon for the one
 * thing they are allowed to do, so the affordance says what it is. The
 * confirmation is deliberately permanent rather than a toast that vanishes:
 * this is a request into a silence the client cannot otherwise see into, and
 * "did that go through?" is the question a disappearing message leaves behind.
 * The server enforces a one-hour cooldown, so the sent state also stops a
 * confused client from asking five times.
 */
function RequestStatusButton({ taskId }: { taskId: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function requestStatus() {
    setState('sending');
    setError(null);
    try {
      await apiFetch(`/portal/tasks/${taskId}/request-status`, { method: 'POST', body: '{}' });
      setState('sent');
    } catch (e) {
      // The cooldown message is itself the useful answer ("you already asked"),
      // so it is shown as-is rather than flattened into a generic failure.
      setError(e instanceof ApiError ? e.message : 'Could not send the request.');
      setState('idle');
    }
  }

  if (state === 'sent') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
        <Check className="h-3 w-3" />
        Update requested — the team has been notified
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <button
        onClick={() => void requestStatus()}
        disabled={state === 'sending'}
        className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2.5 py-1 text-xs text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
      >
        <BellRing className="h-3 w-3" />
        {state === 'sending' ? 'Sending…' : 'Ask for a status update'}
      </button>
      {error ? <span className="text-xs text-slate-500">{error}</span> : null}
    </span>
  );
}

/** Read-only progress notes staff shared on this task — collapsed by default,
 *  fetched only once the client actually wants to see them.
 *
 *  `trailing` sits beside the toggle rather than inside this component so the
 *  expanded panel still renders below the whole row instead of being trapped
 *  inside it. */
function TaskUpdatesFeed({ taskId, trailing }: { taskId: string; trailing?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [updates, setUpdates] = useState<
    { id: string; body: string; createdAt: string; authorName: string | null }[] | null
  >(null);

  async function toggle() {
    if (!open && updates === null) {
      try {
        setUpdates(await apiFetch(`/portal/tasks/${taskId}/updates`));
      } catch {
        setUpdates([]);
      }
    }
    setOpen((o) => !o);
  }

  return (
    <div className="mt-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <button
          onClick={() => void toggle()}
          className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600"
        >
          <MessageSquareText className="h-3 w-3" />
          {open ? 'Hide updates' : updates ? `Updates (${updates.length})` : 'Show updates'}
        </button>
        {trailing}
      </div>
      {open ? (
        <div className="mt-1.5 flex flex-col gap-1.5 rounded-md bg-slate-50 p-2.5">
          {updates === null ? (
            <p className="text-xs text-slate-400">Loading…</p>
          ) : updates.length === 0 ? (
            <p className="text-xs text-slate-400">No updates shared yet.</p>
          ) : (
            updates.map((u) => (
              <div key={u.id} className="text-xs">
                <div className="flex items-baseline gap-1.5">
                  <span className="font-medium text-slate-600">{u.authorName ?? 'The team'}</span>
                  <span className="text-slate-400" title={new Date(u.createdAt).toLocaleString()}>
                    {relTime(u.createdAt)}
                  </span>
                </div>
                <p className="mt-0.5 leading-relaxed text-slate-600">{u.body}</p>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
