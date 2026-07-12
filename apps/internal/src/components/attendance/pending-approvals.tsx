'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, LoadingState } from '@rademics/ui';
import { apiFetch } from '@/lib/api';

interface PendingRow {
  id: string;
  date: string;
  reason: string;
  requestedCheckInAt: string | null;
  requestedCheckOutAt: string | null;
  createdAt: string;
  user: { id: string; name: string; email: string };
}

/** Approver inbox (Spec §5.3): approve/reject scoped regularization requests. */
export function PendingApprovals() {
  const [rows, setRows] = useState<PendingRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await apiFetch<PendingRow[]>('/attendance/regularizations/pending'));
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(id: string, action: 'approve' | 'reject') {
    setBusyId(id);
    try {
      await apiFetch(`/attendance/regularizations/${id}/${action}`, { method: 'POST', body: '{}' });
      await load();
    } catch {
      /* surfaced by list staying put */
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Pending regularizations
          {rows ? <span className="ml-2 text-slate-400">({rows.length})</span> : null}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows === null ? (
          <LoadingState />
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing awaiting your approval.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-slate-100">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-700">{r.user.name}</span>
                    <Badge tone="slate">{r.date.slice(0, 10)}</Badge>
                  </div>
                  <div className="text-xs text-slate-500">{r.reason}</div>
                  {r.requestedCheckInAt ? (
                    <div className="mt-0.5 text-xs text-slate-400">
                      Requested: {new Date(r.requestedCheckInAt).toLocaleString()} →{' '}
                      {r.requestedCheckOutAt ? new Date(r.requestedCheckOutAt).toLocaleString() : '—'}
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button size="sm" disabled={busyId === r.id} onClick={() => decide(r.id, 'approve')}>
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyId === r.id}
                    onClick={() => decide(r.id, 'reject')}
                  >
                    Reject
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
