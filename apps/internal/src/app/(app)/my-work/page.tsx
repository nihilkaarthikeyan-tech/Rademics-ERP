'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Hourglass } from 'lucide-react';
import { Badge, Button, Card, CardContent, EmptyState, LoadingState } from '@rademics/ui';
import { apiFetch, ApiError } from '@/lib/api';
import { useAutoRefresh } from '@/lib/use-auto-refresh';
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
  { title: 'Done', statuses: ['COMPLETED'] },
];

/**
 * What the ASSIGNEE does next, per status — the whole point of this page.
 *
 * Before this existed the card was a bare status chip that happened to be
 * clickable, with nothing saying so: a new employee saw "ASSIGNED" and had no
 * idea the chain was waiting on them. Since every step here is the assignee's
 * own (§6), the button can live on the card and never 403.
 */
const NEXT_STEP: Record<string, { action: string; button: string; hint: string }> = {
  ASSIGNED: {
    action: 'ACKNOWLEDGE',
    button: 'Accept task',
    hint: 'Waiting for you to accept it — your manager can see it has not been picked up.',
  },
  ACKNOWLEDGED: {
    action: 'START_WORK',
    button: 'Start work',
    hint: 'You have accepted this. Press start when you actually begin.',
  },
  IN_PROGRESS: {
    action: 'SUBMIT',
    button: 'Submit for review',
    hint: 'You are working on this. Submit it when it is ready to be checked.',
  },
};

/** Statuses where the ball is in someone else's court — say so, don't offer a button. */
const WAITING_ON_OTHERS: Record<string, string> = {
  SUBMITTED_FOR_REVIEW: 'Submitted — waiting for your reviewer.',
  CLIENT_REVIEW: 'With the client for review.',
  COMPLETED: 'Finished. Nothing more to do.',
};

export default function MyWorkPage() {
  const [tasks, setTasks] = useState<MyTask[]>([]);
  const [members, setMembers] = useState<AssignableUser[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  // A task assigned to you while this page is open should simply appear.
  useAutoRefresh(load, { events: ['task:changed'] });

  const open = useMemo(() => tasks.filter((t) => t.status !== 'COMPLETED'), [tasks]);
  const needsAction = useMemo(() => tasks.filter((t) => NEXT_STEP[t.status]).length, [tasks]);

  /** Move a task one step forward from the card, without opening the panel. */
  async function advance(taskId: string, action: string) {
    setBusyId(taskId);
    setError(null);
    try {
      await apiFetch(`/tasks/${taskId}/transition`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update that task — try opening it instead.');
    } finally {
      setBusyId(null);
    }
  }

  if (state === 'loading') return <LoadingState />;

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-xl font-semibold text-slate-800">My work</h1>
      <p className="mt-1 text-sm text-slate-500">
        {state === 'error'
          ? 'Could not load your tasks.'
          : open.length === 0
            ? 'Nothing on your plate right now.'
            : `${open.length} open task${open.length === 1 ? '' : 's'} assigned to you.` +
              (needsAction > 0 ? ` ${needsAction} need${needsAction === 1 ? 's' : ''} an action from you.` : '')}
      </p>

      {/* How this page works. Written for someone opening it for the first time:
          without it the status chip is the only signal, and nothing says the
          chain is waiting on them. */}
      {state === 'ready' && open.length > 0 ? (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-glass">
          <p className="text-sm font-medium text-slate-800">How your tasks move</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs">
            {[
              ['Accept it', 'so your manager knows you have it'],
              ['Start work', 'when you actually begin'],
              ['Submit for review', 'when it is ready to be checked'],
            ].map(([step, why], i) => (
              <span key={step} className="flex items-center gap-2">
                {i > 0 ? <ChevronRight className="h-3.5 w-3.5 text-slate-300" /> : null}
                <span className="rounded-full bg-accent/10 px-2.5 py-1 font-semibold text-accent">{step}</span>
                <span className="text-slate-500">{why}</span>
              </span>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Use the button on each task below. Click the task itself to add comments, files or a checklist.
          </p>
        </div>
      ) : null}

      {error ? <p className="mt-3 text-sm font-medium text-red-600">{error}</p> : null}

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
                {groupTasks.map((t) => {
                  const step = NEXT_STEP[t.status];
                  const waiting = WAITING_ON_OTHERS[t.status];
                  return (
                    <div
                      key={t.id}
                      className={`rounded-xl border bg-white px-4 py-3 shadow-glass transition-colors ${
                        step ? 'border-accent/30' : 'border-slate-200'
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        {/* Clicking the task opens the full panel — labelled, so it
                            is not a hidden affordance the way the whole card was. */}
                        <button
                          onClick={() => setOpenTaskId(t.id)}
                          className="group min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          <div className="truncate text-sm font-medium text-slate-800 group-hover:text-accent group-hover:underline">
                            {t.title}
                          </div>
                          <div className="mt-0.5 truncate text-xs text-slate-400">
                            {t.project?.name ?? 'No project'}
                            {t.deadline ? ` · due ${new Date(t.deadline).toLocaleDateString()}` : ''}
                          </div>
                        </button>
                        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                          {t.overdue ? <Badge tone="red">Overdue</Badge> : null}
                          {t.clientFacing ? <Badge tone="blue">Client</Badge> : null}
                          <Badge tone={PRIORITY_TONE[t.priority] ?? 'slate'}>{t.priority}</Badge>
                        </div>
                      </div>

                      {/* What happens next, in words, plus the button that does it. */}
                      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2.5">
                        <p className="min-w-0 flex-1 text-xs text-slate-500">
                          {step ? (
                            step.hint
                          ) : (
                            <span className="inline-flex items-center gap-1.5">
                              <Hourglass className="h-3 w-3 text-slate-400" />
                              {waiting ?? t.status.replace(/_/g, ' ').toLowerCase()}
                            </span>
                          )}
                        </p>
                        {step ? (
                          <Button
                            size="sm"
                            disabled={busyId === t.id}
                            onClick={() => void advance(t.id, step.action)}
                            className="shrink-0"
                          >
                            {busyId === t.id ? 'Working…' : step.button}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
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
