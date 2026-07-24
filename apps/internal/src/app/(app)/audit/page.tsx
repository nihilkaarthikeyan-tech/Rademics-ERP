'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Card, CardContent, ErrorState, Input, Label, LoadingState } from '@rademics/ui';
import { apiFetch } from '@/lib/api';

interface AuditRow {
  id: string;
  actorEmail: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
}
interface AuditPage {
  items: AuditRow[];
  total: number;
  page: number;
  pageSize: number;
}

const PAGE_SIZE = 50;

export default function AuditLogPage() {
  const [data, setData] = useState<AuditPage | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [page, setPage] = useState(1);
  // Applied filters (what the query uses) vs. the input boxes.
  const [action, setAction] = useState('');
  const [actorEmail, setActorEmail] = useState('');
  const [actionInput, setActionInput] = useState('');
  const [emailInput, setEmailInput] = useState('');

  const load = useCallback(() => {
    setState('loading');
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (action) params.set('action', action);
    if (actorEmail) params.set('actorEmail', actorEmail);
    apiFetch<AuditPage>(`/audit?${params.toString()}`)
      .then((r) => {
        setData(r);
        setState('ready');
      })
      .catch(() => setState('error'));
  }, [page, action, actorEmail]);

  useEffect(() => {
    load();
  }, [load]);

  function applyFilters(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setAction(actionInput.trim());
    setActorEmail(emailInput.trim());
  }

  function clearFilters() {
    setActionInput('');
    setEmailInput('');
    setAction('');
    setActorEmail('');
    setPage(1);
  }

  const total = data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-xl font-semibold text-slate-800">Audit Log</h1>
      <p className="mt-1 text-sm text-slate-500">
        Every important action, newest first. Read-only — entries can never be edited or deleted.
      </p>

      <form onSubmit={applyFilters} className="mt-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="action">Action contains</Label>
          <Input
            id="action"
            placeholder="e.g. LOGIN, INVOICE, CLIENT"
            value={actionInput}
            onChange={(e) => setActionInput(e.target.value)}
            className="w-56"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Actor email contains</Label>
          <Input
            id="email"
            placeholder="e.g. karthi"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            className="w-56"
          />
        </div>
        <Button type="submit">Filter</Button>
        {(action || actorEmail) && (
          <Button type="button" variant="ghost" onClick={clearFilters}>
            Clear
          </Button>
        )}
      </form>

      <Card className="mt-4">
        <CardContent className="p-0">
          {state === 'loading' ? (
            <div className="p-6">
              <LoadingState />
            </div>
          ) : state === 'error' ? (
            <div className="p-6">
              <ErrorState description="Could not load the audit log." />
            </div>
          ) : !data || data.items.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">No audit entries match your filters.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                    <th className="px-4 py-3 font-medium">When</th>
                    <th className="px-4 py-3 font-medium">Who</th>
                    <th className="px-4 py-3 font-medium">Action</th>
                    <th className="px-4 py-3 font-medium">Entity</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((row) => (
                    <tr key={row.id} className="border-b border-slate-50 last:border-0">
                      <td className="whitespace-nowrap px-4 py-2.5 text-slate-500">
                        {new Date(row.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5 text-slate-700">{row.actorEmail ?? '—'}</td>
                      <td className="px-4 py-2.5">
                        <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-700">
                          {row.action}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-slate-500">
                        {row.entityType ? (
                          <span title={row.entityId ?? ''}>{row.entityType}</span>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {state === 'ready' && total > 0 && (
        <div className="mt-3 flex items-center justify-between text-sm text-slate-500">
          <span>
            {total} entr{total === 1 ? 'y' : 'ies'} · page {page} of {lastPage}
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={page >= lastPage}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
