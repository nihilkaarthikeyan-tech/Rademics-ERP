'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, LoadingState } from '@rademics/ui';
import { apiFetch } from '@/lib/api';
import { LeaveRequestForm } from './leave-request-form';

interface Balance {
  type: string;
  availableDays: number;
  usedDays: number;
  quotaPerYear: number;
  projectedYearEndAvailable: number;
}

interface LeaveRow {
  id: string;
  type: string;
  half: string;
  fromDate: string;
  toDate: string;
  reason: string;
  totalDays: string;
  unpaidDays: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  decisionComment: string | null;
}

const STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'slate'> = {
  PENDING: 'amber',
  APPROVED: 'green',
  REJECTED: 'red',
  CANCELLED: 'slate',
};

const TYPE_LABEL: Record<string, string> = { CASUAL: 'Casual', SICK: 'Sick', EARNED: 'Earned', UNPAID: 'Unpaid' };

/** Employee self-service: balance cards (with projected accrual), request form + history. */
export function MyLeave() {
  const [balances, setBalances] = useState<Balance[] | null>(null);
  const [rows, setRows] = useState<LeaveRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadBalances = useCallback(async () => {
    try {
      setBalances(await apiFetch<Balance[]>('/leave/balances'));
    } catch {
      setBalances([]);
    }
  }, []);
  const loadRows = useCallback(async () => {
    try {
      setRows(await apiFetch<LeaveRow[]>('/leave/mine'));
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void loadBalances();
    void loadRows();
  }, [loadBalances, loadRows]);

  const refresh = useCallback(() => {
    void loadBalances();
    void loadRows();
  }, [loadBalances, loadRows]);

  async function cancel(id: string) {
    setBusyId(id);
    try {
      await apiFetch(`/leave/${id}/cancel`, { method: 'POST', body: '{}' });
      refresh();
    } catch {
      /* list stays put */
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Balance cards */}
      <div className="grid gap-3 sm:grid-cols-3">
        {balances === null
          ? [0, 1, 2].map((i) => (
              <Card key={i}>
                <CardContent className="py-4">
                  <LoadingState />
                </CardContent>
              </Card>
            ))
          : balances.map((b) => (
              <Card key={b.type}>
                <CardContent className="py-4">
                  <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
                    {TYPE_LABEL[b.type] ?? b.type} leave
                  </div>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className="text-2xl font-semibold tabular-nums text-slate-800">{b.availableDays}</span>
                    <span className="text-sm text-slate-400">/ {b.quotaPerYear} days</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {b.usedDays} used · projected year-end {b.projectedYearEndAvailable}
                  </div>
                </CardContent>
              </Card>
            ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Request leave</CardTitle>
        </CardHeader>
        <CardContent>
          <LeaveRequestForm onSubmitted={refresh} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>My leave requests</CardTitle>
        </CardHeader>
        <CardContent>
          {rows === null ? (
            <LoadingState />
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-500">No requests yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-slate-100">
              {rows.map((r) => (
                <li key={r.id} className="flex items-start justify-between gap-4 py-2.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-700">{TYPE_LABEL[r.type] ?? r.type}</span>
                      <span className="text-xs text-slate-500">
                        {r.fromDate.slice(0, 10)}
                        {r.toDate.slice(0, 10) !== r.fromDate.slice(0, 10) ? ` → ${r.toDate.slice(0, 10)}` : ''}
                        {r.half !== 'FULL' ? ' (½)' : ''} · {Number(r.totalDays)} day(s)
                      </span>
                    </div>
                    <div className="text-xs text-slate-500">{r.reason}</div>
                    {Number(r.unpaidDays) > 0 ? (
                      <div className="mt-0.5 text-xs text-slate-700">{Number(r.unpaidDays)} day(s) as unpaid</div>
                    ) : null}
                    {r.decisionComment ? (
                      <div className="mt-0.5 text-xs text-slate-400">Reviewer: {r.decisionComment}</div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                    {r.status === 'PENDING' ? (
                      <Button size="sm" variant="outline" disabled={busyId === r.id} onClick={() => cancel(r.id)}>
                        Cancel
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
