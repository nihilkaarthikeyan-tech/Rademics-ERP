'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge, Card, EmptyState, ErrorState, LoadingState } from '@rademics/ui';
import { apiFetch } from '@/lib/api';
import { useAutoRefresh } from '@/lib/use-auto-refresh';

interface MyClientRow {
  clientId: string;
  code: string;
  status: string;
  projects: { id: string; code: string; name: string }[];
  openClientTasks: number;
  daysSinceUpdate: number | null;
  waitingSince: string | null;
  pendingRequests: { taskId: string; title: string; askedAt: string }[];
  updateDue: boolean;
}

function waitedLabel(days: number | null): string {
  if (days === null) return '—';
  if (days === 0) return 'today';
  if (days === 1) return '1 day';
  return `${days} days`;
}

/**
 * A staff member's own clients.
 *
 * The 3-day nudge is a notification, and notifications get missed. This turns
 * the same information into a standing list you can look at: who is waiting,
 * how long, and who has actually asked. Sorted so anything requiring an answer
 * is at the top — it is a to-do list, not a directory.
 *
 * Clients appear as CL-012 for every role. Only Super Admin ever sees who a
 * client is, and this screen exists for everyone else.
 */
export default function MyClientsPage() {
  const [rows, setRows] = useState<MyClientRow[] | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  const load = useCallback(async () => {
    try {
      setRows(await apiFetch<MyClientRow[]>('/client-orgs/mine'));
      setState('ready');
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useAutoRefresh(load, { events: ['task:changed'] });

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-xl font-semibold text-slate-800">My clients</h1>
      <p className="mt-1 text-sm text-slate-500">
        Clients on the projects you run or hold work in. Post an update from any task to answer them.
      </p>

      <div className="mt-4 flex flex-col gap-3">
        {state === 'loading' ? (
          <LoadingState />
        ) : state === 'error' ? (
          <ErrorState description="Could not load your clients." onRetry={() => void load()} />
        ) : !rows || rows.length === 0 ? (
          <Card>
            <EmptyState
              title="No clients yet"
              description="Clients appear here once you're on a project that has one."
            />
          </Card>
        ) : (
          rows.map((r) => (
            <Card key={r.clientId} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-slate-800">{r.code}</span>
                    {r.status === 'DEACTIVATED' ? <Badge tone="slate">Access ended</Badge> : null}
                    {r.pendingRequests.length > 0 ? (
                      <Badge tone="red">
                        {r.pendingRequests.length === 1
                          ? 'Asked for an update'
                          : `${r.pendingRequests.length} update requests`}
                      </Badge>
                    ) : r.updateDue ? (
                      <Badge tone="amber">Update due</Badge>
                    ) : null}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                    {r.projects.map((p) => (
                      <Link
                        key={p.id}
                        href={`/projects/${p.id}`}
                        className="rounded border border-slate-200 px-1.5 py-0.5 hover:bg-slate-50"
                      >
                        <span className="font-mono text-slate-400">{p.code}</span>{' '}
                        <span className="text-slate-700">{p.name}</span>
                      </Link>
                    ))}
                  </div>
                </div>

                <div className="text-right text-xs text-slate-500">
                  <div>
                    Last heard from us:{' '}
                    <span className={r.updateDue ? 'font-medium text-amber-700' : 'text-slate-700'}>
                      {waitedLabel(r.daysSinceUpdate)} ago
                    </span>
                  </div>
                  <div className="mt-0.5">
                    {r.openClientTasks} open {r.openClientTasks === 1 ? 'item' : 'items'} they can see
                  </div>
                </div>
              </div>

              {r.pendingRequests.length > 0 ? (
                <ul className="mt-3 flex flex-col gap-1 border-t border-slate-100 pt-2.5">
                  {r.pendingRequests.map((q) => {
                    const project = r.projects[0];
                    return (
                      <li key={q.taskId} className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="text-slate-700">
                          Asked about <span className="font-medium">{q.title}</span>
                        </span>
                        {project ? (
                          <Link
                            href={`/projects/${project.id}?task=${q.taskId}`}
                            className="shrink-0 text-xs font-medium text-accent hover:underline"
                          >
                            Reply with an update
                          </Link>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
