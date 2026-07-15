'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, ClipboardCheck, FolderKanban, TrendingUp } from 'lucide-react';
import { Badge, Card, CardContent, EmptyState, LoadingState } from '@rademics/ui';
import { apiFetch, ApiError } from '@/lib/api';
import { AccessEnded } from '@/components/access-ended';

interface PortalProject {
  id: string;
  name: string;
  status: string;
  level: 'VIEWER' | 'APPROVER';
  percentComplete: number;
  awaitingApproval: number;
}

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div
        className="h-full rounded-full bg-primary"
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
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500">{label}</span>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
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

  const awaitingTotal = projects?.reduce((n, p) => n + p.awaitingApproval, 0) ?? 0;
  const avgComplete = projects?.length
    ? Math.round(projects.reduce((n, p) => n + p.percentComplete, 0) / projects.length)
    : 0;
  const activeCount = projects?.filter((p) => p.percentComplete < 100).length ?? 0;

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">My Projects</h1>
      <p className="mt-1 text-sm text-slate-500">Progress and deliverables for your projects.</p>

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
            <div className="grid gap-4 sm:grid-cols-3">
              <Kpi icon={FolderKanban} label="Total projects" value={String(projects.length)} sub={`${activeCount} in progress`} />
              <Kpi icon={TrendingUp} label="Avg. completion" value={`${avgComplete}%`} sub="across all projects" />
              <Kpi icon={ClipboardCheck} label="Awaiting your review" value={String(awaitingTotal)} sub={awaitingTotal ? 'needs a decision' : 'all caught up'} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {projects.map((p) => (
                <Link key={p.id} href={`/projects/${p.id}`}>
                  <div className="h-full rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-colors hover:border-slate-300">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
                          {p.percentComplete >= 100 ? <CheckCircle2 className="h-4 w-4" /> : <FolderKanban className="h-4 w-4" />}
                        </span>
                        <h3 className="font-semibold text-slate-900">{p.name}</h3>
                      </div>
                      {p.awaitingApproval > 0 ? (
                        <Badge tone="amber" className="shrink-0">{p.awaitingApproval} to approve</Badge>
                      ) : null}
                    </div>
                    <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
                      <Badge tone={p.level === 'APPROVER' ? 'blue' : 'slate'}>{p.level}</Badge>
                      <span>{p.status}</span>
                    </div>
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
