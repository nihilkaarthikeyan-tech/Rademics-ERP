'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge, Button, Card, CardContent, EmptyState, LoadingState } from '@rademics/ui';
import { apiFetch, ApiError } from '@/lib/api';
import { AccessEnded } from '@/components/access-ended';

interface Deliverable {
  id: string;
  title: string;
  deadline: string | null;
  project: { id: string; name: string };
  canApprove: boolean;
}

export default function ApprovalsPage() {
  const [items, setItems] = useState<Deliverable[] | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'ended' | 'error'>('loading');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await apiFetch<Deliverable[]>('/portal/deliverables'));
      setState('ready');
    } catch (e) {
      setState(e instanceof ApiError && e.status === 403 ? 'ended' : 'error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(taskId: string, action: 'approve' | 'request-revision') {
    let comment: string | undefined;
    if (action === 'request-revision') {
      comment = window.prompt('What needs revising? (at least 10 characters)') ?? undefined;
      if (!comment || comment.trim().length < 10) return;
    }
    setBusyId(taskId);
    try {
      await apiFetch(`/portal/deliverables/${taskId}/${action}`, { method: 'POST', body: JSON.stringify(comment ? { comment } : {}) });
      await load();
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'Action failed');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-800">Approvals</h1>
      <p className="mt-1 text-sm text-slate-500">Deliverables awaiting your review.</p>

      <div className="mt-6">
        {state === 'loading' ? (
          <LoadingState />
        ) : state === 'ended' ? (
          <AccessEnded />
        ) : state === 'error' ? (
          <Card><CardContent className="pt-6"><EmptyState title="Something went wrong" description="Please try again shortly." /></CardContent></Card>
        ) : !items || items.length === 0 ? (
          <Card><CardContent className="pt-6"><EmptyState title="Nothing to approve" description="You're all caught up." /></CardContent></Card>
        ) : (
          <Card>
            <CardContent className="pt-4">
              <ul className="flex flex-col divide-y divide-slate-100">
                {items.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 py-3">
                    <div>
                      <div className="text-sm font-medium text-slate-700">{d.title}</div>
                      <Link href={`/projects/${d.project.id}`} className="text-xs text-slate-400 hover:underline">
                        {d.project.name}
                      </Link>
                      {d.deadline ? <span className="ml-2 text-xs text-slate-400">Due {new Date(d.deadline).toLocaleDateString()}</span> : null}
                    </div>
                    {d.canApprove ? (
                      <div className="flex shrink-0 gap-2">
                        <Button size="sm" disabled={busyId === d.id} onClick={() => decide(d.id, 'approve')}>Approve</Button>
                        <Button size="sm" variant="outline" disabled={busyId === d.id} onClick={() => decide(d.id, 'request-revision')}>Request revision</Button>
                      </div>
                    ) : (
                      <Badge tone="slate">View only</Badge>
                    )}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
