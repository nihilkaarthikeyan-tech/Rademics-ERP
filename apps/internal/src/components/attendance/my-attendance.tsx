'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, LoadingState } from '@rademics/ui';
import { apiFetch } from '@/lib/api';
import { RegularizationForm } from './regularization-form';

interface DayRow {
  id: string;
  date: string;
  status: string;
  workedSeconds: number;
  idleSeconds: number;
  overtimeSeconds: number;
  isLate: boolean;
  lateDeductionApplied: boolean;
}

interface RegRow {
  id: string;
  date: string;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  decisionComment: string | null;
  createdAt: string;
}

const STATUS_TONE: Record<string, 'green' | 'amber' | 'slate' | 'red' | 'blue'> = {
  PRESENT: 'green',
  HALF_DAY: 'amber',
  ABSENT: 'red',
  WEEKLY_OFF: 'slate',
  ON_LEAVE: 'blue',
};
const REG_TONE: Record<string, 'green' | 'amber' | 'red'> = {
  PENDING: 'amber',
  APPROVED: 'green',
  REJECTED: 'red',
};

function fmt(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

/** Employee self-service view: own daily records + regularization request & history. */
export function MyAttendance() {
  const [days, setDays] = useState<DayRow[] | null>(null);
  const [regs, setRegs] = useState<RegRow[] | null>(null);

  const loadDays = useCallback(async () => {
    try {
      const r = await apiFetch<{ items: DayRow[] }>('/attendance/me?pageSize=31');
      setDays(r.items);
    } catch {
      setDays([]);
    }
  }, []);
  const loadRegs = useCallback(async () => {
    try {
      setRegs(await apiFetch<RegRow[]>('/attendance/regularizations/mine'));
    } catch {
      setRegs([]);
    }
  }, []);

  useEffect(() => {
    void loadDays();
    void loadRegs();
  }, [loadDays, loadRegs]);

  return (
    <div className="flex flex-col gap-6">
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>My recent days</CardTitle>
        </CardHeader>
        {days === null ? (
          <CardContent>
            <LoadingState />
          </CardContent>
        ) : days.length === 0 ? (
          <CardContent>
            <EmptyState
              title="No records yet"
              description="Your daily marks appear after the nightly computation runs."
            />
          </CardContent>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Date</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Worked</th>
                  <th className="px-4 py-2.5 font-medium">Idle</th>
                  <th className="px-4 py-2.5 font-medium">Overtime</th>
                  <th className="px-4 py-2.5 font-medium">Late</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {days.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 tabular-nums text-slate-600">{d.date.slice(0, 10)}</td>
                    <td className="px-4 py-2.5">
                      <Badge tone={STATUS_TONE[d.status] ?? 'slate'}>{d.status.replace('_', ' ')}</Badge>
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-slate-600">{fmt(d.workedSeconds)}</td>
                    <td className="px-4 py-2.5 tabular-nums text-slate-500">{fmt(d.idleSeconds)}</td>
                    <td className="px-4 py-2.5 tabular-nums text-slate-500">
                      {d.overtimeSeconds > 0 ? fmt(d.overtimeSeconds) : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      {d.isLate ? (
                        <Badge tone={d.lateDeductionApplied ? 'red' : 'amber'}>
                          {d.lateDeductionApplied ? 'Late · deduction' : 'Late'}
                        </Badge>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Request a regularization</CardTitle>
        </CardHeader>
        <CardContent>
          <RegularizationForm onSubmitted={loadRegs} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>My regularization requests</CardTitle>
        </CardHeader>
        <CardContent>
          {regs === null ? (
            <LoadingState />
          ) : regs.length === 0 ? (
            <p className="text-sm text-slate-500">No requests yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-slate-100">
              {regs.map((r) => (
                <li key={r.id} className="flex items-start justify-between gap-4 py-2.5">
                  <div>
                    <div className="text-sm font-medium text-slate-700">{r.date.slice(0, 10)}</div>
                    <div className="text-xs text-slate-500">{r.reason}</div>
                    {r.decisionComment ? (
                      <div className="mt-0.5 text-xs text-slate-400">Reviewer: {r.decisionComment}</div>
                    ) : null}
                  </div>
                  <Badge tone={REG_TONE[r.status]}>{r.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
