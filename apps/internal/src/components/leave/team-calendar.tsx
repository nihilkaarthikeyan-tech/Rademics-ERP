'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, LoadingState } from '@rademics/ui';
import { apiFetch } from '@/lib/api';

interface CalItem {
  id: string;
  userName: string;
  type: string;
  half: string;
  fromDate: string;
  toDate: string;
  status: 'PENDING' | 'APPROVED';
  overlaps: boolean;
}

const TYPE_LABEL: Record<string, string> = { CASUAL: 'Casual', SICK: 'Sick', EARNED: 'Earned', UNPAID: 'Unpaid' };

/** Team leave calendar (Spec §5.7): approved + pending in a month window, overlaps flagged. */
export function TeamCalendar() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [items, setItems] = useState<CalItem[] | null>(null);

  const load = useCallback(async () => {
    setItems(null);
    const from = `${month}-01`;
    const [y, m] = month.split('-').map(Number) as [number, number];
    const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    try {
      const res = await apiFetch<{ items: CalItem[] }>(`/leave/calendar?from=${from}&to=${to}`);
      setItems(res.items);
    } catch {
      setItems([]);
    }
  }, [month]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Team leave</CardTitle>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="h-8 rounded-md border border-slate-300 bg-white px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
      </CardHeader>
      <CardContent>
        {items === null ? (
          <LoadingState />
        ) : items.length === 0 ? (
          <EmptyState title="No leave this month" description="Approved and pending team leave will appear here." />
        ) : (
          <ul className="flex flex-col divide-y divide-slate-100">
            {items.map((it) => (
              <li key={it.id} className="flex items-center justify-between gap-4 py-2.5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-slate-700">{it.userName}</span>
                    <span className="text-xs text-slate-500">
                      {it.fromDate}
                      {it.toDate !== it.fromDate ? ` → ${it.toDate}` : ''}
                      {it.half !== 'FULL' ? ' (½)' : ''}
                    </span>
                    {it.overlaps ? <Badge tone="amber">Overlap</Badge> : null}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge tone="slate">{TYPE_LABEL[it.type] ?? it.type}</Badge>
                  <Badge tone={it.status === 'APPROVED' ? 'green' : 'amber'}>{it.status}</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
