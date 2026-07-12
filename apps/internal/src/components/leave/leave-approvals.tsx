'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, LoadingState } from '@rademics/ui';
import { apiFetch } from '@/lib/api';

interface PendingRow {
  id: string;
  type: string;
  half: string;
  fromDate: string;
  toDate: string;
  reason: string;
  totalDays: string;
  unpaidDays: string;
  currentLevel: string;
  escalatedCount: number;
  user: { id: string; name: string; email: string };
  overlap: { overlaps: boolean; names: string[] };
}

const TYPE_LABEL: Record<string, string> = { CASUAL: 'Casual', SICK: 'Sick', EARNED: 'Earned', UNPAID: 'Unpaid' };

/** Approver inbox (Spec §5.7): approve/reject with overlap warnings + escalation badge. */
export function LeaveApprovals() {
  const [rows, setRows] = useState<PendingRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await apiFetch<PendingRow[]>('/leave/pending'));
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(id: string, action: 'approve' | 'reject') {
    let comment = '';
    if (action === 'reject') {
      comment = window.prompt('Reason for rejection (optional):') ?? '';
    }
    setBusyId(id);
    try {
      await apiFetch(`/leave/${id}/${action}`, { method: 'POST', body: JSON.stringify({ comment }) });
      await load();
    } catch {
      /* list stays put; conflicts surface on refresh */
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Pending leave approvals
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
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-slate-700">{r.user.name}</span>
                    <Badge tone="slate">{TYPE_LABEL[r.type] ?? r.type}</Badge>
                    <span className="text-xs text-slate-500">
                      {r.fromDate.slice(0, 10)}
                      {r.toDate.slice(0, 10) !== r.fromDate.slice(0, 10) ? ` → ${r.toDate.slice(0, 10)}` : ''}
                      {r.half !== 'FULL' ? ' (½)' : ''} · {Number(r.totalDays)} day(s)
                    </span>
                    {r.escalatedCount > 0 ? <Badge tone="red">Escalated → {r.currentLevel.replace('_', ' ')}</Badge> : null}
                  </div>
                  <div className="text-xs text-slate-500">{r.reason}</div>
                  {Number(r.unpaidDays) > 0 ? (
                    <div className="mt-0.5 text-xs text-slate-700">{Number(r.unpaidDays)} day(s) would be unpaid</div>
                  ) : null}
                  {r.overlap?.overlaps ? (
                    <div className="mt-0.5 text-xs font-medium text-slate-700">
                      ⚠ Overlaps team leave: {r.overlap.names.join(', ')}
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button size="sm" disabled={busyId === r.id} onClick={() => decide(r.id, 'approve')}>
                    Approve
                  </Button>
                  <Button size="sm" variant="outline" disabled={busyId === r.id} onClick={() => decide(r.id, 'reject')}>
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
