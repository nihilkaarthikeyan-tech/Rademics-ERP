'use client';

import { useCallback, useEffect, useState } from 'react';
import { Download, Receipt } from 'lucide-react';
import { Badge, LoadingState } from '@rademics/ui';
import { apiFetch, API_BASE } from '@/lib/api';
import { getToken } from '@/lib/session';
import { useAutoRefresh } from '@/lib/use-auto-refresh';

interface PortalInvoice {
  id: string;
  number: string;
  status: string;
  issueDate: string;
  dueDate: string;
  total: number;
  amountPaid: number;
  balance: number;
  projectName: string | null;
}

const STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'slate'> = {
  PAID: 'green',
  PARTIALLY_PAID: 'amber',
  OVERDUE: 'red',
  SENT: 'slate',
  CANCELLED: 'slate',
};

const money = (n: number) => `₹${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * The client's bills.
 *
 * This page exists because invoices are no longer emailed: correspondence with
 * the company happens in the portal, so the document has to be readable here or
 * it does not reach the client at all.
 */
export default function PortalInvoicesPage() {
  const [invoices, setInvoices] = useState<PortalInvoice[] | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  const load = useCallback(async () => {
    try {
      setInvoices(await apiFetch<PortalInvoice[]>('/portal/invoices'));
      setState('ready');
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useAutoRefresh(load);

  /**
   * The PDF is a streamed, authorised response, so it cannot simply be a link —
   * fetch it with the token and hand the browser a blob.
   */
  async function openPdf(inv: PortalInvoice) {
    try {
      const res = await fetch(`${API_BASE}/portal/invoices/${inv.id}/pdf`, {
        headers: { Authorization: `Bearer ${getToken() ?? ''}` },
        credentials: 'include',
      });
      if (!res.ok) return;
      const url = URL.createObjectURL(await res.blob());
      window.open(url, '_blank');
      // Give the new tab time to take the blob before releasing it.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      /* nothing useful to say — the row is still there to retry */
    }
  }

  if (state === 'loading') return <LoadingState />;
  if (state === 'error') return <p className="text-sm text-slate-500">Could not load your invoices.</p>;

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">Invoices</h1>
      <p className="mt-1 text-sm text-slate-500">Bills for your projects.</p>

      {!invoices || invoices.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-white/70 bg-white/65 p-10 text-center shadow-glass backdrop-blur-xl">
          <Receipt className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-3 text-sm text-slate-500">No invoices yet.</p>
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-2xl border border-white/70 bg-white/65 shadow-glass backdrop-blur-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-medium">Invoice</th>
                  <th className="px-4 py-3 font-medium">Project</th>
                  <th className="px-4 py-3 font-medium">Issued</th>
                  <th className="px-4 py-3 font-medium">Due</th>
                  <th className="px-4 py-3 text-right font-medium">Total</th>
                  <th className="px-4 py-3 text-right font-medium">Outstanding</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-white/60">
                    <td className="px-4 py-3 font-mono text-xs text-slate-700">{inv.number}</td>
                    <td className="px-4 py-3 text-slate-600">{inv.projectName ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-500">{day(inv.issueDate)}</td>
                    <td className="px-4 py-3 text-slate-500">{day(inv.dueDate)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">{money(inv.total)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium text-slate-800">
                      {inv.balance > 0 ? money(inv.balance) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={STATUS_TONE[inv.status] ?? 'slate'}>{inv.status.replace('_', ' ')}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => void openPdf(inv)}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        <Download className="h-3 w-3" /> PDF
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
