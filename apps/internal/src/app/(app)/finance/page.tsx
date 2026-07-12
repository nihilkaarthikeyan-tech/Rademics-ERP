'use client';

import { useState } from 'react';
import { InvoicesPanel } from '@/components/finance/invoices-panel';
import { ExpensesPanel } from '@/components/finance/expenses-panel';
import { PnlPanel } from '@/components/finance/pnl-panel';
import { PayrollPanel } from '@/components/finance/payroll-panel';

const TABS = [
  { key: 'invoices', label: 'Invoices & Payments' },
  { key: 'expenses', label: 'Expenses' },
  { key: 'pnl', label: 'P&L' },
  { key: 'payroll', label: 'Payroll Export' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export default function FinancePage() {
  const [tab, setTab] = useState<TabKey>('invoices');

  return (
    <div className="mx-auto max-w-6xl">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Finance</h1>
        <p className="mt-1 text-sm text-slate-500">Invoices, payments, expenses, P&amp;L per vertical, and payroll export.</p>
      </div>

      <div className="mt-4 flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
              tab === t.key ? 'border-accent text-accent' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {tab === 'invoices' ? <InvoicesPanel /> : null}
        {tab === 'expenses' ? <ExpensesPanel /> : null}
        {tab === 'pnl' ? <PnlPanel /> : null}
        {tab === 'payroll' ? <PayrollPanel /> : null}
      </div>
    </div>
  );
}
