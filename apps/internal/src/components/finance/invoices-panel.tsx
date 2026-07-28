'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, LoadingState } from '@rademics/ui';
import { apiFetch, ApiError, API_BASE } from '@/lib/api';
import { useAutoRefresh } from '@/lib/use-auto-refresh';
import { getToken } from '@/lib/session';

interface Line { description: string; quantity: number; rate: number; gstPercent?: number }
interface Payment {
  id: string; paidAt: string; mode: string; reference: string | null;
  amount: string; note: string | null; isReversal: boolean;
}
interface Invoice {
  id: string; number: string; status: string; issueDate: string; dueDate: string;
  total: string; amountPaid: string; balance: number; daysOverdue: number;
  clientOrg: { id: string; name: string } | null; project: { id: string; name: string } | null;
}
/** Full shape from GET /invoices/:id — lines + payments for the expanded row. */
interface InvoiceDetail extends Invoice {
  lines: { id: string; description: string; quantity: string; rate: string; gstPercent: string }[];
  payments: Payment[];
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

/** Invoices list + create/edit form + the full §5.8 lifecycle: send, PDF, record
 *  payment, cancel, cancel-and-reissue, and payment reversal (compensating entry). */
export function InvoicesPanel() {
  const [rows, setRows] = useState<Invoice[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Expanded row: full detail (lines + payments) fetched on demand.
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);

  // create/edit-form state — editingId set means the form PUTs a draft instead of creating.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingKeeps, setEditingKeeps] = useState<{ clientOrgId?: string; projectId?: string }>({});
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

  // Payments and sends often come from a colleague at another desk.
  useAutoRefresh(load, { events: ['invoice:changed'] });

  const loadDetail = useCallback(async (id: string) => {
    setDetail(null);
    try {
      setDetail(await apiFetch<InvoiceDetail>(`/invoices/${id}`));
    } catch {
      setError('Could not load the invoice detail.');
    }
  }, []);

  function toggleDetail(id: string) {
    if (openId === id) {
      setOpenId(null);
      setDetail(null);
    } else {
      setOpenId(id);
      void loadDetail(id);
    }
  }

  function resetForm() {
    setEditingId(null);
    setEditingKeeps({});
    setIssueDate(new Date().toISOString().slice(0, 10));
    setLines([{ description: '', quantity: 1, rate: 0, gstPercent: 18 }]);
    setCreating(false);
  }

  async function submitInvoice(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (editingId) {
        // Keep the client/project pairing — the API replaces the whole draft.
        await apiFetch(`/invoices/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify({ issueDate, lines, ...editingKeeps }),
        });
      } else {
        await apiFetch('/invoices', { method: 'POST', body: JSON.stringify({ issueDate, lines }) });
      }
      resetForm();
      await load();
      if (openId) setOpenId(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save invoice');
    }
  }

  /** Pull a draft's current content into the form for editing. */
  async function startEdit(inv: Invoice) {
    setError(null);
    try {
      const d = await apiFetch<InvoiceDetail>(`/invoices/${inv.id}`);
      setEditingId(d.id);
      setEditingKeeps({ clientOrgId: d.clientOrg?.id, projectId: d.project?.id });
      setIssueDate(d.issueDate.slice(0, 10));
      setLines(
        d.lines.map((l) => ({
          description: l.description,
          quantity: Number(l.quantity),
          rate: Number(l.rate),
          gstPercent: Number(l.gstPercent),
        })),
      );
      setCreating(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not open that draft');
    }
  }

  async function act(id: string, path: string, body: unknown = {}) {
    setBusyId(id);
    setError(null);
    try {
      await apiFetch(`/invoices/${id}/${path}`, { method: 'POST', body: JSON.stringify(body) });
      await load();
      if (openId === id) await loadDetail(id);
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

  /** Cancel: the number is burned, the invoice keeps its row as CANCELLED. */
  async function cancelInvoice(inv: Invoice) {
    const reason = window.prompt(`Cancel ${inv.number}? The number is not reused. Reason (audited):`);
    if (!reason?.trim()) return;
    await act(inv.id, 'cancel', { reason: reason.trim() });
  }

  /** Cancel-and-reissue: content edits after Sent — fresh DRAFT with a new number. */
  async function reissueInvoice(inv: Invoice) {
    const reason = window.prompt(
      `Reissue ${inv.number}? It is cancelled and a fresh draft with a NEW number is created for you to edit and re-send. Reason (audited):`,
    );
    if (!reason?.trim()) return;
    await act(inv.id, 'reissue', { reason: reason.trim() });
  }

  /** Reverse a payment: a compensating negative entry — nothing is deleted. */
  async function reversePayment(invoiceId: string, p: Payment) {
    const reason = window.prompt(
      `Reverse the ${inr(Number(p.amount))} payment (${p.mode})? A negative entry is added and the balance reopens. Reason (audited):`,
    );
    if (!reason?.trim()) return;
    setBusyId(invoiceId);
    setError(null);
    try {
      await apiFetch(`/invoices/payments/${p.id}/reverse`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() }),
      });
      await load();
      await loadDetail(invoiceId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reverse that payment');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Invoices</h2>
        <Button size="sm" onClick={() => (creating ? resetForm() : setCreating(true))}>
          {creating ? 'Close form' : 'New invoice'}
        </Button>
      </div>
      {error ? <p className="text-xs text-slate-900">{error}</p> : null}

      {creating ? (
        <Card>
          <CardHeader>
            <CardTitle>{editingId ? 'Edit draft' : 'New invoice'}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submitInvoice} className="flex flex-col gap-3">
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
                <Button type="submit" size="sm">{editingId ? 'Save draft' : 'Create draft'}</Button>
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
                  <Fragment key={i.id}>
                    <tr className="hover:bg-slate-50">
                      <td className="px-3 py-2.5 font-medium text-slate-700">
                        <button onClick={() => toggleDetail(i.id)} className="hover:text-accent hover:underline">
                          {i.number}
                        </button>
                      </td>
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
                            <>
                              <Button size="sm" disabled={busyId === i.id} onClick={() => act(i.id, 'send')}>Send</Button>
                              <Button size="sm" variant="outline" disabled={busyId === i.id} onClick={() => void startEdit(i)}>Edit</Button>
                            </>
                          ) : null}
                          {['SENT', 'PARTIALLY_PAID', 'OVERDUE'].includes(i.status) ? (
                            <>
                              <Button size="sm" variant="outline" disabled={busyId === i.id} onClick={() => recordPayment(i)}>Pay</Button>
                              <Button size="sm" variant="outline" disabled={busyId === i.id} onClick={() => void reissueInvoice(i)}>Reissue</Button>
                            </>
                          ) : null}
                          {!['PAID', 'CANCELLED'].includes(i.status) ? (
                            <Button size="sm" variant="ghost" disabled={busyId === i.id} onClick={() => void cancelInvoice(i)}>Cancel</Button>
                          ) : null}
                          <Button size="sm" variant="outline" onClick={() => openPdf(i.id, i.number)}>PDF</Button>
                        </div>
                      </td>
                    </tr>
                    {openId === i.id ? (
                      <tr className="bg-slate-50/60">
                        <td colSpan={6} className="px-4 py-3">
                          {!detail || detail.id !== i.id ? (
                            <p className="text-xs text-slate-400">Loading…</p>
                          ) : (
                            <div className="flex flex-col gap-3">
                              <div>
                                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Lines</p>
                                <ul className="flex flex-col gap-0.5 text-xs text-slate-600">
                                  {detail.lines.map((l) => (
                                    <li key={l.id}>
                                      {l.description} — {Number(l.quantity)} × {inr(Number(l.rate))} (+{Number(l.gstPercent)}% GST)
                                    </li>
                                  ))}
                                </ul>
                              </div>
                              <div>
                                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Payments</p>
                                {detail.payments.length === 0 ? (
                                  <p className="text-xs text-slate-400">No payments recorded.</p>
                                ) : (
                                  <ul className="flex flex-col gap-1 text-xs">
                                    {detail.payments.map((p) => (
                                      <li key={p.id} className="flex items-center gap-2">
                                        <span className={`tabular-nums ${p.isReversal ? 'text-rose-600' : 'text-slate-700'}`}>
                                          {inr(Number(p.amount))}
                                        </span>
                                        <span className="text-slate-500">
                                          {p.mode} · {new Date(p.paidAt).toLocaleDateString()}
                                          {p.reference ? ` · ref ${p.reference}` : ''}
                                          {p.note ? ` · ${p.note}` : ''}
                                        </span>
                                        {p.isReversal ? (
                                          <Badge tone="red">Reversal</Badge>
                                        ) : Number(p.amount) > 0 && detail.status !== 'CANCELLED' ? (
                                          <button
                                            onClick={() => void reversePayment(i.id, p)}
                                            disabled={busyId === i.id}
                                            className="text-rose-500 underline-offset-2 hover:underline"
                                          >
                                            Reverse
                                          </button>
                                        ) : null}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
