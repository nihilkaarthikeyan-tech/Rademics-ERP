'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Receipt, Wallet } from 'lucide-react';
import { Badge, EmptyState, LoadingState } from '@rademics/ui';
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

function Kpi({ icon: Icon, label, value, sub }: { icon: typeof Wallet; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-2xl border border-white/70 bg-white/65 backdrop-blur-xl p-5 shadow-glass">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500">{label}</span>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[#7C6CF6] to-[#A855F7] text-white">
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-3 text-3xl font-bold tracking-tight tabular-nums text-slate-900">{value}</div>
      <div className="mt-1 text-xs text-slate-400">{sub}</div>
    </div>
  );
}

/** Client portal invoices (Spec §5.5, §17.7): own org's issued invoices + balances. */
export default function InvoicesPage() {
  const [rows, setRows] = useState<PortalInvoice[] | null>(null);

  useEffect(() => {
    apiFetch<PortalInvoice[]>('/portal/invoices')
      .then(setRows)
      .catch(() => setRows([]));
  }, []);

  const outstanding = rows?.reduce((n, i) => n + i.balance, 0) ?? 0;
  const overdueCount = rows?.filter((i) => i.status === 'OVERDUE').length ?? 0;

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">Invoices</h1>
      <p className="mt-1 text-sm text-slate-500">Your invoices and payment status.</p>

      {rows && rows.length > 0 ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <Kpi icon={Receipt} label="Total invoices" value={String(rows.length)} sub="issued to your organization" />
          <Kpi icon={Wallet} label="Outstanding balance" value={inr(outstanding)} sub="across all invoices" />
          <Kpi icon={AlertTriangle} label="Overdue" value={String(overdueCount)} sub={overdueCount ? 'needs attention' : 'nothing overdue'} />
        </div>
      ) : null}

      <div className="mt-6 overflow-hidden rounded-2xl border border-white/70 bg-white/65 backdrop-blur-xl shadow-glass">
        {rows === null ? (
          <div className="p-6">
            <LoadingState />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No invoices yet" description="Invoices shared with you will appear here." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="px-5 py-3 font-medium">Invoice</th>
                  <th className="px-5 py-3 font-medium">Project</th>
                  <th className="px-5 py-3 font-medium">Issued</th>
                  <th className="px-5 py-3 font-medium">Due</th>
                  <th className="px-5 py-3 text-right font-medium">Total</th>
                  <th className="px-5 py-3 text-right font-medium">Balance</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-5 py-3 font-medium text-slate-800">{i.number}</td>
                    <td className="px-5 py-3 text-slate-500">{i.projectName ?? '—'}</td>
                    <td className="px-5 py-3 tabular-nums text-slate-500">{i.issueDate.slice(0, 10)}</td>
                    <td className="px-5 py-3 tabular-nums text-slate-500">{i.dueDate.slice(0, 10)}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-slate-600">{inr(i.total)}</td>
                    <td className="px-5 py-3 text-right font-semibold tabular-nums text-slate-800">{inr(i.balance)}</td>
                    <td className="px-5 py-3">
                      <Badge tone={TONE[i.status] ?? 'slate'}>{i.status.replace('_', ' ')}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
