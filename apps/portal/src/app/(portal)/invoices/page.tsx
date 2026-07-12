'use client';

import { useEffect, useState } from 'react';
import { Badge, Card, CardContent, EmptyState, LoadingState } from '@rademics/ui';
import { apiFetch } from '@/lib/api';

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

const TONE: Record<string, 'green' | 'amber' | 'red' | 'slate' | 'blue'> = {
  PAID: 'green',
  PARTIALLY_PAID: 'blue',
  SENT: 'amber',
  OVERDUE: 'red',
};

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Client portal invoices (Spec §5.5, §17.7): own org's issued invoices + balances. */
export default function InvoicesPage() {
  const [rows, setRows] = useState<PortalInvoice[] | null>(null);

  useEffect(() => {
    apiFetch<PortalInvoice[]>('/portal/invoices')
      .then(setRows)
      .catch(() => setRows([]));
  }, []);

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-800">Invoices</h1>
      <p className="mt-1 text-sm text-slate-500">Your invoices and payment status.</p>

      <Card className="mt-4 overflow-hidden">
        {rows === null ? (
          <CardContent className="pt-6">
            <LoadingState />
          </CardContent>
        ) : rows.length === 0 ? (
          <CardContent className="pt-6">
            <EmptyState title="No invoices yet" description="Invoices shared with you will appear here." />
          </CardContent>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Invoice</th>
                  <th className="px-4 py-2.5 font-medium">Project</th>
                  <th className="px-4 py-2.5 font-medium">Issued</th>
                  <th className="px-4 py-2.5 font-medium">Due</th>
                  <th className="px-4 py-2.5 font-medium text-right">Total</th>
                  <th className="px-4 py-2.5 font-medium text-right">Balance</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((i) => (
                  <tr key={i.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-medium text-slate-700">{i.number}</td>
                    <td className="px-4 py-2.5 text-slate-500">{i.projectName ?? '—'}</td>
                    <td className="px-4 py-2.5 tabular-nums text-slate-500">{i.issueDate.slice(0, 10)}</td>
                    <td className="px-4 py-2.5 tabular-nums text-slate-500">{i.dueDate.slice(0, 10)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{inr(i.total)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{inr(i.balance)}</td>
                    <td className="px-4 py-2.5">
                      <Badge tone={TONE[i.status] ?? 'slate'}>{i.status.replace('_', ' ')}</Badge>
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
