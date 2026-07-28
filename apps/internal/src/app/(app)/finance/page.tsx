'use client';

import { useState } from 'react';
import { PageGuide } from '@rademics/ui';
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

      {/* Per-tab, because the surprising rule differs: invoices cannot be edited
          once sent, and "Send" does not email anything. */}
      <div className="mt-6">
        {tab === 'invoices' ? (
          <PageGuide
            id="finance-invoices"
            title="How invoicing works"
            className="mb-4"
            steps={[
              {
                label: 'Create a draft',
                detail:
                  'add the lines and GST. The invoice number is assigned automatically and is never reused.',
              },
              {
                label: 'Send it',
                detail:
                  'this does NOT email the invoice. It appears in the client’s portal and they are notified to log in and download the PDF.',
              },
              {
                label: 'Record payments as money arrives',
                detail:
                  'part payments are fine — the balance updates and the invoice marks itself Paid when it reaches zero.',
              },
            ]}
            notes={[
              'Made a mistake? A draft can be edited freely. A sent invoice cannot — use Reissue, which cancels it and creates a fresh draft with a new number. Recorded a payment wrongly? Click the invoice number and press Reverse next to it. Nothing is ever deleted, so the paper trail always adds up.',
              'Overdue invoices flag themselves daily — you do not need to check.',
            ]}
          />
        ) : null}
        {tab === 'payroll' ? (
          <PageGuide
            id="finance-payroll"
            title="How the payroll export works"
            className="mb-4"
            steps={[
              { label: 'Lock the month', detail: 'freezes that month’s attendance so the figures cannot shift under you.' },
              { label: 'Run the export', detail: 'produces a CSV snapshot of attendance to hand to whoever processes salaries.' },
              { label: 'Need to correct something?', detail: 'unlock with a written reason — the next export is a new numbered revision, and the old one is kept.' },
            ]}
            notes={[
              'Salary amounts are not stored in this system. The export gives the attendance basis; the amounts are handled outside it.',
            ]}
          />
        ) : null}
        {tab === 'pnl' ? (
          <PageGuide
            id="finance-pnl"
            title="How to read this"
            className="mb-4"
            notes={[
              'Profit per business vertical: money invoiced, minus expenses logged against those projects, minus an estimate of labour cost. Only invoiced work counts — a project in progress shows its costs before it shows its revenue.',
            ]}
          />
        ) : null}
        {tab === 'expenses' ? (
          <PageGuide
            id="finance-expenses"
            title="What to log here"
            className="mb-4"
            notes={[
              'Costs that belong to a project — software, freelancers, travel, printing. These feed the P&L, so anything you do not log makes a project look more profitable than it is.',
            ]}
          />
        ) : null}
        {tab === 'invoices' ? <InvoicesPanel /> : null}
        {tab === 'expenses' ? <ExpensesPanel /> : null}
        {tab === 'pnl' ? <PnlPanel /> : null}
        {tab === 'payroll' ? <PayrollPanel /> : null}
      </div>
    </div>
  );
}
