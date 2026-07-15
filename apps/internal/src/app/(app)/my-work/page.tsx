'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Badge, Card, CardContent, EmptyState, LoadingState } from '@rademics/ui';
import { apiFetch } from '@/lib/api';
import { TaskDetailDrawer, type AssignableUser } from '@/components/projects/task-detail-drawer';

interface MyTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  clientFacing: boolean;
  deadline: string | null;
  overdue: boolean;
  project: { id: string; name: string } | null;
}

const PRIORITY_TONE: Record<string, 'red' | 'amber' | 'slate'> = { HIGH: 'red', MEDIUM: 'amber', LOW: 'slate' };

/** My-work groupings over the §6 statuses (CLOSED/CANCELLED never reach this page). */
const GROUPS: { title: string; statuses: string[] }[] = [
  { title: 'To do', statuses: ['ASSIGNED', 'ACKNOWLEDGED'] },
  { title: 'In progress', statuses: ['IN_PROGRESS'] },
  { title: 'In review', statuses: ['SUBMITTED_FOR_REVIEW', 'CLIENT_REVIEW'] },
  { title: 'Done', statuses: ['COMPLETED', 'INVOICED'] },
];

export default function MyWorkPage() {
  const [tasks, setTasks] = useState<MyTask[]>([]);
  const [members, setMembers] = useState<AssignableUser[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<{ items: MyTask[] }>('/tasks/mine');
      setTasks(r.items);
      setState('ready');
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
    // Only roles with tasks.assign can fetch this; everyone else keeps [] (drawer hides the picker input anyway).
    apiFetch<AssignableUser[]>('/projects/assignable-users').then(setMembers).catch(() => setMembers([]));
  }, [load]);

  const open = useMemo(() => tasks.filter((t) => !['COMPLETED', 'INVOICED'].includes(t.status)), [tasks]);

  if (state === 'loading') return <LoadingState />;

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-xl font-semibold text-slate-800">My work</h1>
      <p className="mt-1 text-sm text-slate-500">
        {state === 'error'
          ? 'Could not load your tasks.'
          : open.length === 0
            ? 'Nothing on your plate right now.'
            : `${open.length} open task${open.length === 1 ? '' : 's'} assigned to you.`}
      </p>

      {state === 'ready' && tasks.length === 0 ? (
        <Card className="mt-4">
          <CardContent className="pt-6">
            <EmptyState
              title="No tasks yet"
              description="Tasks assigned to you will appear here. Check the projects you're part of in the meantime."
            />
          </CardContent>
        </Card>
      ) : null}

      <div className="mt-6 flex flex-col gap-6">
        {GROUPS.map((group) => {
          const groupTasks = tasks.filter((t) => group.statuses.includes(t.status));
          if (groupTasks.length === 0) return null;
          return (
            <div key={group.title}>
              <div className="mb-2 flex items-center gap-2 px-1">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{group.title}</span>
                <span className="text-xs text-slate-400">{groupTasks.length}</span>
              </div>
              <div className="flex flex-col gap-2">
                {groupTasks.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setOpenTaskId(t.id)}
                    className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition-colors hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-800">{t.title}</div>
                      <div className="mt-0.5 truncate text-xs text-slate-400">
                        {t.project?.name ?? 'No project'}
                        {t.deadline ? ` · due ${new Date(t.deadline).toLocaleDateString()}` : ''}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {t.overdue ? <Badge tone="red">Overdue</Badge> : null}
                      {t.clientFacing ? <Badge tone="blue">Client</Badge> : null}
                      <Badge tone={PRIORITY_TONE[t.priority] ?? 'slate'}>{t.priority}</Badge>
                      <Badge tone="slate">{t.status.replace(/_/g, ' ')}</Badge>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {state === 'ready' && tasks.length > 0 ? (
        <p className="mt-6 text-xs text-slate-400">
          Looking for the full board? Open the project from <Link href="/projects" className="underline hover:text-slate-600">Projects</Link>.
        </p>
      ) : null}

      {openTaskId ? (
        <TaskDetailDrawer
          taskId={openTaskId}
          members={members}
          onClose={() => setOpenTaskId(null)}
          onChanged={load}
        />
      ) : null}
    </div>
  );
}
