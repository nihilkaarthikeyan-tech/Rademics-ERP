'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, Input, Label, LoadingState } from '@rademics/ui';
import { apiFetch } from '@/lib/api';

interface PnlRow {
  vertical: string;
  invoicedRevenue: number;
  collected: number;
  expensesTotal: number;
  estimatedLaborCost: number;
  net: number;
}
const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

/** P&L per business vertical (Spec §5.8): revenue − expenses − estimated labour. */
export function PnlPanel() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rows, setRows] = useState<PnlRow[] | null>(null);

  const load = useCallback(async () => {
    setRows(null);
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    try {
      const res = await apiFetch<{ rows: PnlRow[] }>(`/finance/pnl?${qs.toString()}`);
      setRows(res.rows);
    } catch {
      setRows([]);
    }
  }, [from, to]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end gap-3">
        <div>
          <Label htmlFor="pnl-from">From</Label>
          <Input id="pnl-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </div>
        <div>
          <Label htmlFor="pnl-to">To</Label>
          <Input id="pnl-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </div>
      </div>

      <Card className="overflow-hidden">
        {rows === null ? (
          <CardContent><LoadingState /></CardContent>
        ) : rows.length === 0 ? (
          <CardContent><p className="text-sm text-slate-500">No P&amp;L data for this range.</p></CardContent>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2.5 font-medium">Vertical</th>
                  <th className="px-3 py-2.5 font-medium text-right">Invoiced</th>
                  <th className="px-3 py-2.5 font-medium text-right">Collected</th>
                  <th className="px-3 py-2.5 font-medium text-right">Expenses</th>
                  <th className="px-3 py-2.5 font-medium text-right">Est. labour</th>
                  <th className="px-3 py-2.5 font-medium text-right">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.vertical} className="hover:bg-slate-50">
                    <td className="px-3 py-2.5 font-medium text-slate-700">{r.vertical}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{inr(r.invoicedRevenue)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{inr(r.collected)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{inr(r.expensesTotal)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{inr(r.estimatedLaborCost)}</td>
                    <td className={`px-3 py-2.5 text-right tabular-nums font-medium ${r.net >= 0 ? 'text-slate-900' : 'text-slate-900'}`}>{inr(r.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
