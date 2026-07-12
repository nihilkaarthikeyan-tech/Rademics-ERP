'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
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
      <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
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

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-800">My Projects</h1>
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
          <div className="grid gap-4 sm:grid-cols-2">
            {projects.map((p) => (
              <Link key={p.id} href={`/projects/${p.id}`}>
                <Card className="h-full transition-colors hover:border-slate-300">
                  <CardContent className="pt-5">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold text-slate-800">{p.name}</h3>
                      {p.awaitingApproval > 0 ? (
                        <Badge tone="amber">{p.awaitingApproval} to approve</Badge>
                      ) : null}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
                      <Badge tone={p.level === 'APPROVER' ? 'blue' : 'slate'}>{p.level}</Badge>
                      <span>{p.status}</span>
                    </div>
                    <ProgressBar percent={p.percentComplete} />
                    <div className="mt-1 text-right text-xs text-slate-500">{p.percentComplete}% complete</div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
