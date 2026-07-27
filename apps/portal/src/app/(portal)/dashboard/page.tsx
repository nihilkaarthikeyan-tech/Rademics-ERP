'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, ChevronRight, FolderKanban, MessageSquareText, TrendingUp } from 'lucide-react';
import { Card, CardContent, EmptyState, LoadingState } from '@rademics/ui';
import { apiFetch, ApiError } from '@/lib/api';
import { useAutoRefresh } from '@/lib/use-auto-refresh';
import { AccessEnded } from '@/components/access-ended';

interface PortalNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
  readAt: string | null;
}

/** Where clicking an update takes the client — the thing itself, not a dead end. */
function updateHref(n: PortalNotification): string {
  if (n.type === 'INVOICE_SENT') return '/invoices';
  if (n.entityType === 'Project' && n.entityId) return `/projects/${n.entityId}`;
  return '/dashboard';
}

function relTime(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/**
 * The team's messages, on the landing page itself.
 *
 * The bell in the header holds the same items, but a bell is something you have
 * to know to click — and a client who logs in once a week should not need to
 * discover anything to find out what happened. The first screen answers the
 * question they came with.
 */
function UpdatesFeed() {
  const [items, setItems] = useState<PortalNotification[] | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await apiFetch<PortalNotification[]>('/notifications'));
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useAutoRefresh(load, { intervalMs: 20_000 });

  if (items === null) return null;

  return (
    <div className="rounded-2xl border border-white/70 bg-white/65 backdrop-blur-xl p-5 shadow-glass">
      <div className="mb-3 flex items-center gap-2">
        <MessageSquareText className="h-4 w-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-800">Updates from your team</h3>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-slate-400">
          Nothing yet — when your team posts an update or sends an invoice, it appears here.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-slate-100">
          {items.slice(0, 5).map((n) => (
            <li key={n.id}>
              {/* A whole-row link with a hover wash and a chevron — the three cues
                  people already know mean "this opens". It lands on the thing
                  itself (the project's feed, the invoice list), so the truncated
                  preview here never has to carry the full story. */}
              <Link
                href={updateHref(n)}
                className="group -mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-white/80"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="flex min-w-0 items-baseline gap-2">
                      {!n.readAt ? (
                        <span className="h-2 w-2 shrink-0 translate-y-[-1px] rounded-full bg-[#7C6CF6]" aria-label="New" />
                      ) : null}
                      <span className="truncate text-sm font-medium text-slate-800">{n.title}</span>
                    </span>
                    <span className="shrink-0 text-xs text-slate-400">{relTime(n.createdAt)}</span>
                  </div>
                  {n.body ? (
                    <p className="mt-1 line-clamp-2 whitespace-pre-line text-sm leading-relaxed text-slate-600">
                      {n.body}
                    </p>
                  ) : null}
                  <span className="mt-1 inline-block text-xs font-medium text-accent">
                    {n.type === 'INVOICE_SENT' ? 'View invoice' : 'Read the full update'}
                  </span>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-500" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface PortalProject {
  id: string;
  name: string;
  status: string;
  percentComplete: number;
}

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div
        className="h-full rounded-full bg-gradient-to-r from-[#4F46E5] to-[#A855F7]"
        style={{ width: `${Math.max(2, Math.min(100, percent))}%` }}
      />
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof FolderKanban;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-2xl border border-white/70 bg-white/65 backdrop-blur-xl p-5 shadow-glass">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500">{label}</span>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[#7C6CF6] to-[#A855F7] text-white">
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-3 text-3xl font-bold tracking-tight tabular-nums text-slate-900">{value}</div>
      <div className="mt-1 text-xs text-slate-400">{sub}</div>
    </div>
  );
}

export default function PortalDashboard() {
  const [projects, setProjects] = useState<PortalProject[] | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'ended' | 'error'>('loading');

  const load = useCallback(async () => {
    try {
      setProjects(await apiFetch<PortalProject[]>('/portal/projects'));
      setState('ready');
    } catch (e) {
      setState(e instanceof ApiError && e.status === 403 ? 'ended' : 'error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useAutoRefresh(load);

  const avgComplete = projects?.length
    ? Math.round(projects.reduce((n, p) => n + p.percentComplete, 0) / projects.length)
    : 0;
  const activeCount = projects?.filter((p) => p.percentComplete < 100).length ?? 0;

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">My Projects</h1>
      <p className="mt-1 text-sm text-slate-500">Progress for your projects.</p>

      <div className="mt-6">
        {state === 'loading' ? (
          <LoadingState />
        ) : state === 'ended' ? (
          <AccessEnded />
        ) : state === 'error' ? (
          <Card><CardContent className="pt-6"><EmptyState title="Something went wrong" description="Please try again shortly." /></CardContent></Card>
        ) : !projects || projects.length === 0 ? (
          <Card><CardContent className="pt-6"><EmptyState title="No projects shared yet" description="When your team shares progress, it appears here." /></CardContent></Card>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Kpi icon={FolderKanban} label="Total projects" value={String(projects.length)} sub={`${activeCount} in progress`} />
              <Kpi icon={TrendingUp} label="Avg. completion" value={`${avgComplete}%`} sub="across all projects" />
            </div>

            {/* What the team has said — before the numbers, this is why they log in. */}
            <UpdatesFeed />

            <div className="grid gap-4 sm:grid-cols-2">
              {projects.map((p) => (
                <Link key={p.id} href={`/projects/${p.id}`}>
                  <div className="h-full rounded-2xl border border-white/70 bg-white/65 backdrop-blur-xl p-5 shadow-glass transition-colors hover:border-white/90">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#7C6CF6] to-[#A855F7] text-white">
                        {p.percentComplete >= 100 ? <CheckCircle2 className="h-4 w-4" /> : <FolderKanban className="h-4 w-4" />}
                      </span>
                      <h3 className="font-semibold text-slate-900">{p.name}</h3>
                    </div>
                    <div className="mt-3 text-xs text-slate-400">{p.status}</div>
                    <ProgressBar percent={p.percentComplete} />
                    <div className="mt-1 text-right text-xs font-medium tabular-nums text-slate-500">{p.percentComplete}% complete</div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
