'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, LoadingState } from '@rademics/ui';
import { apiFetch, ApiError, API_BASE } from '@/lib/api';
import { getToken } from '@/lib/session';

interface Line { description: string; quantity: number; rate: number; gstPercent?: number }
interface Invoice {
  id: string; number: string; status: string; issueDate: string; dueDate: string;
  total: string; amountPaid: string; balance: number; daysOverdue: number;
  clientOrg: { name: string } | null; project: { name: string } | null;
}

const TONE: Record<string, 'green' | 'amber' | 'red' | 'slate' | 'blue'> = {
  DRAFT: 'slate', SENT: 'amber', PARTIALLY_PAID: 'blue', PAID: 'green', OVERDUE: 'red', CANCELLED: 'slate',
};
const inr = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function openPdf(id: string, number: string) {
  const res = await fetch(`${API_BASE}/invoices/${id}/pdf`, { headers: { authorization: `Bearer ${getToken() ?? ''}` } });
  if (!res.ok) return;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Invoices list + a minimal create form + row actions (send, PDF, record payment). */
export function InvoicesPanel() {
  const [rows, setRows] = useState<Invoice[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // create-form state
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<Line[]>([{ description: '', quantity: 1, rate: 0, gstPercent: 18 }]);

  const load = useCallback(async () => {
    try {
      setRows(await apiFetch<Invoice[]>('/invoices'));
    } catch {
      setRows([]);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function createInvoice(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiFetch('/invoices', { method: 'POST', body: JSON.stringify({ issueDate, lines }) });
      setLines([{ description: '', quantity: 1, rate: 0, gstPercent: 18 }]);
      setCreating(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create invoice');
    }
  }

  async function act(id: string, path: string, body: unknown = {}) {
    setBusyId(id);
    setError(null);
    try {
      await apiFetch(`/invoices/${id}/${path}`, { method: 'POST', body: JSON.stringify(body) });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Action failed');
    } finally {
      setBusyId(null);
    }
  }

  async function recordPayment(inv: Invoice) {
    const raw = window.prompt(`Payment amount (balance ${inr(inv.balance)}):`, String(inv.balance));
    if (!raw) return;
    const mode = window.prompt('Payment mode (e.g. UPI, Bank Transfer):', 'Bank Transfer') ?? 'Bank Transfer';
    await act(inv.id, 'payments', { amount: Number(raw), mode });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Invoices</h2>
        <Button size="sm" onClick={() => setCreating((v) => !v)}>{creating ? 'Cancel' : 'New invoice'}</Button>
      </div>
      {error ? <p className="text-xs text-slate-900">{error}</p> : null}

      {creating ? (
        <Card>
          <CardHeader><CardTitle>New invoice</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={createInvoice} className="flex flex-col gap-3">
              <div className="w-48">
                <Label htmlFor="issue">Issue date</Label>
                <Input id="issue" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} required />
              </div>
              {lines.map((l, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[1fr_5rem_6rem_5rem]">
                  <Input placeholder="Description" value={l.description} onChange={(e) => setLines((p) => p.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} required />
                  <Input type="number" step="0.01" min="0.01" placeholder="Qty" value={l.quantity} onChange={(e) => setLines((p) => p.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value) } : x)))} />
                  <Input type="number" step="0.01" min="0" placeholder="Rate" value={l.rate} onChange={(e) => setLines((p) => p.map((x, j) => (j === i ? { ...x, rate: Number(e.target.value) } : x)))} />
                  <Input type="number" step="1" min="0" max="28" placeholder="GST%" value={l.gstPercent} onChange={(e) => setLines((p) => p.map((x, j) => (j === i ? { ...x, gstPercent: Number(e.target.value) } : x)))} />
                </div>
              ))}
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => setLines((p) => [...p, { description: '', quantity: 1, rate: 0, gstPercent: 18 }])}>+ Line</Button>
                <Button type="submit" size="sm">Create draft</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        {rows === null ? (
          <CardContent><LoadingState /></CardContent>
        ) : rows.length === 0 ? (
          <CardContent><p className="text-sm text-slate-500">No invoices yet.</p></CardContent>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2.5 font-medium">Number</th>
                  <th className="px-3 py-2.5 font-medium">Client</th>
                  <th className="px-3 py-2.5 font-medium text-right">Total</th>
                  <th className="px-3 py-2.5 font-medium text-right">Balance</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((i) => (
                  <tr key={i.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2.5 font-medium text-slate-700">{i.number}</td>
                    <td className="px-3 py-2.5 text-slate-500">{i.clientOrg?.name ?? '—'}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{inr(Number(i.total))}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{inr(i.balance)}</td>
                    <td className="px-3 py-2.5">
                      <Badge tone={TONE[i.status] ?? 'slate'}>{i.status.replace('_', ' ')}</Badge>
                      {i.daysOverdue > 0 ? <span className="ml-1 text-xs text-slate-900">{i.daysOverdue}d</span> : null}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex justify-end gap-1.5">
                        {i.status === 'DRAFT' ? (
                          <Button size="sm" disabled={busyId === i.id} onClick={() => act(i.id, 'send')}>Send</Button>
                        ) : null}
                        {['SENT', 'PARTIALLY_PAID', 'OVERDUE'].includes(i.status) ? (
                          <Button size="sm" variant="outline" disabled={busyId === i.id} onClick={() => recordPayment(i)}>Pay</Button>
                        ) : null}
                        <Button size="sm" variant="outline" onClick={() => openPdf(i.id, i.number)}>PDF</Button>
                      </div>
                    </td>
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
