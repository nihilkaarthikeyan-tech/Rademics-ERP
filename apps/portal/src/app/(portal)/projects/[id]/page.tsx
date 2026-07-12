'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Download } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, LoadingState } from '@rademics/ui';
import { apiFetch, ApiError } from '@/lib/api';

interface Milestone { id: string; name: string; percentComplete: number }
interface Item { id: string; title: string; status: string; deadline: string | null }
interface Deliverable { id: string; title: string; deadline: string | null; canApprove: boolean }
interface PortalProjectDetail {
  id: string;
  name: string;
  status: string;
  description: string | null;
  level: 'VIEWER' | 'APPROVER';
  percentComplete: number;
  milestones: Milestone[];
  deliverables: Deliverable[];
  items: Item[];
}

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Not started', ASSIGNED: 'Planned', ACKNOWLEDGED: 'Planned', IN_PROGRESS: 'In progress',
  SUBMITTED_FOR_REVIEW: 'In review', CLIENT_REVIEW: 'Awaiting your approval', COMPLETED: 'Completed',
  INVOICED: 'Completed', CLOSED: 'Completed', CANCELLED: 'Cancelled',
};

export default function PortalProjectDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [project, setProject] = useState<PortalProjectDetail | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'notfound' | 'error'>('loading');
  const [busyId, setBusyId] = useState<string | null>(null);

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

  async function decide(taskId: string, action: 'approve' | 'request-revision') {
    let comment: string | undefined;
    if (action === 'request-revision') {
      comment = window.prompt('What needs revising? (at least 10 characters)') ?? undefined;
      if (!comment || comment.trim().length < 10) return;
    }
    setBusyId(taskId);
    try {
      await apiFetch(`/portal/deliverables/${taskId}/${action}`, {
        method: 'POST',
        body: JSON.stringify(comment ? { comment } : {}),
      });
      await load();
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'Action failed');
    } finally {
      setBusyId(null);
    }
  }

  if (state === 'loading') return <LoadingState />;
  if (state === 'notfound') return <p className="text-sm text-slate-500">This project isn&apos;t available.</p>;
  if (state === 'error' || !project) return <p className="text-sm text-slate-500">Could not load this project.</p>;

  return (
    <div>
      <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> Dashboard
      </Link>

      <div className="mt-2 flex items-center gap-2">
        <h1 className="text-xl font-semibold text-slate-800">{project.name}</h1>
        <Badge tone="green">{project.percentComplete}% complete</Badge>
      </div>
      {project.description ? <p className="mt-1 text-sm text-slate-500">{project.description}</p> : null}

      {/* Awaiting approval */}
      {project.deliverables.length > 0 ? (
        <Card className="mt-5 border-amber-200">
          <CardHeader><CardTitle>Awaiting your approval</CardTitle></CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2">
              {project.deliverables.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-slate-700">{d.title}</div>
                    {d.deadline ? <div className="text-xs text-slate-400">Due {new Date(d.deadline).toLocaleDateString()}</div> : null}
                    <DeliverableFiles taskId={d.id} />
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
      ) : null}

      {/* Milestones */}
      {project.milestones.length > 0 ? (
        <Card className="mt-5">
          <CardHeader><CardTitle>Milestones</CardTitle></CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-3">
              {project.milestones.map((m) => (
                <li key={m.id}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-700">{m.name}</span>
                    <span className="text-slate-400">{m.percentComplete}%</span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${m.percentComplete}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {/* Progress items */}
      <Card className="mt-5">
        <CardHeader><CardTitle>Progress</CardTitle></CardHeader>
        <CardContent>
          {project.items.length === 0 ? (
            <p className="text-sm text-slate-400">No shared items yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-slate-100">
              {project.items.map((t) => (
                <li key={t.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-slate-700">{t.title}</span>
                  <Badge tone={t.status === 'CLIENT_REVIEW' ? 'amber' : ['COMPLETED', 'INVOICED', 'CLOSED'].includes(t.status) ? 'green' : 'slate'}>
                    {STATUS_LABEL[t.status] ?? t.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DeliverableFiles({ taskId }: { taskId: string }) {
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
    <div className="mt-1 flex flex-wrap gap-2">
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
