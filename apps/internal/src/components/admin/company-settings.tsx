'use client';

import { useEffect, useState } from 'react';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ErrorState,
  Input,
  Label,
  LoadingState,
} from '@rademics/ui';
import { apiFetch, ApiError } from '@/lib/api';

/**
 * The company identity that goes on every invoice (Spec §23).
 *
 * These values existed as settings from the start but no screen ever exposed
 * them, so the only way to correct a typo in your own registered address was a
 * code change and a deploy. Editable here, and saved through the same
 * PUT /settings/business-rules the rest of the rules use — which merges a patch,
 * so sending only these keys cannot disturb the attendance or finance rules.
 */

interface CompanyFields {
  companyName: string;
  companyLegalName: string;
  companyAddress: string;
  companyGstin: string;
  companyStateCode: string;
  financialYearStartMonth: number;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const EMPTY: CompanyFields = {
  companyName: '',
  companyLegalName: '',
  companyAddress: '',
  companyGstin: '',
  companyStateCode: '',
  financialYearStartMonth: 4,
};

/** 15 chars: 2 state digits, 10-char PAN, 1 entity digit, 1 letter, 1 check char. */
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{2}$/;

export function CompanySettings() {
  const [form, setForm] = useState<CompanyFields>(EMPTY);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);

  useEffect(() => {
    apiFetch<Record<string, unknown>>('/settings/business-rules')
      .then((r) => {
        setForm({
          companyName: String(r.companyName ?? ''),
          companyLegalName: String(r.companyLegalName ?? ''),
          companyAddress: String(r.companyAddress ?? ''),
          companyGstin: String(r.companyGstin ?? ''),
          companyStateCode: String(r.companyStateCode ?? ''),
          financialYearStartMonth: Number(r.financialYearStartMonth ?? 4),
        });
        setState('ready');
      })
      .catch(() => setState('error'));
  }, []);

  const set = <K extends keyof CompanyFields>(key: K, value: CompanyFields[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setMessage(null);
  };

  const gstin = form.companyGstin.trim().toUpperCase();
  // Checked here only to catch a typo before saving; blank stays allowed because a
  // business may not be registered yet.
  const gstinLooksWrong = gstin.length > 0 && !GSTIN_RE.test(gstin);
  // The first two digits of a GSTIN *are* the state code, so a mismatch is a typo
  // in one of the two fields, not a legitimate combination.
  const stateMismatch =
    !gstinLooksWrong &&
    gstin.length === 15 &&
    form.companyStateCode.trim().length === 2 &&
    gstin.slice(0, 2) !== form.companyStateCode.trim();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (gstinLooksWrong || stateMismatch) return;
    setSaving(true);
    setMessage(null);
    try {
      await apiFetch('/settings/business-rules', {
        method: 'PUT',
        body: JSON.stringify({
          companyName: form.companyName.trim(),
          companyLegalName: form.companyLegalName.trim(),
          companyAddress: form.companyAddress.trim(),
          companyGstin: gstin,
          // Keep the state code consistent with the GSTIN when one is present, so
          // the intra/inter-state decision on invoices cannot be driven by a stale value.
          companyStateCode: gstin.length === 15 ? gstin.slice(0, 2) : form.companyStateCode.trim(),
          financialYearStartMonth: form.financialYearStartMonth,
        }),
      });
      setMessage({ kind: 'ok', text: 'Saved. New invoices will use these details.' });
    } catch (err) {
      setMessage({
        kind: 'bad',
        text: err instanceof ApiError ? err.message : 'Could not save the company details.',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>Company (used on invoices)</CardTitle>
      </CardHeader>
      <CardContent>
        {state === 'loading' ? (
          <LoadingState />
        ) : state === 'error' ? (
          <ErrorState description="Could not load the company details." />
        ) : (
          <form onSubmit={save} className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="companyName">Trading name</Label>
                <Input
                  id="companyName"
                  value={form.companyName}
                  onChange={(e) => set('companyName', e.target.value)}
                  placeholder="RLK ENTERPRISES"
                />
                <p className="mt-1 text-xs text-slate-500">The heading on the invoice.</p>
              </div>
              <div>
                <Label htmlFor="companyLegalName">Registered legal name</Label>
                <Input
                  id="companyLegalName"
                  value={form.companyLegalName}
                  onChange={(e) => set('companyLegalName', e.target.value)}
                  placeholder="Ranjith Rajamanickam"
                />
                <p className="mt-1 text-xs text-slate-500">
                  Printed under the trading name. GST expects the registered name on the document.
                </p>
              </div>
            </div>

            <div>
              <Label htmlFor="companyAddress">Registered address</Label>
              <Input
                id="companyAddress"
                value={form.companyAddress}
                onChange={(e) => set('companyAddress', e.target.value)}
                placeholder="4/975-A, Sathy Road, Ganesapuram, Coimbatore, Tamil Nadu 641107"
              />
              <p className="mt-1 text-xs text-slate-500">
                Exactly as on your GST certificate — principal place of business.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <Label htmlFor="companyGstin">GSTIN</Label>
                <Input
                  id="companyGstin"
                  value={form.companyGstin}
                  onChange={(e) => set('companyGstin', e.target.value.toUpperCase())}
                  placeholder="33ASGPR8663J1Z6"
                  spellCheck={false}
                  aria-invalid={gstinLooksWrong || undefined}
                />
                {gstinLooksWrong ? (
                  <p className="mt-1 text-xs font-medium text-rose-600">
                    That is not a valid GSTIN. It is 15 characters: 2 digits, 5 letters, 4 digits,
                    a letter, then 2 more characters.
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-slate-500">
                    Leave blank if you are not registered.
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="companyStateCode">State code</Label>
                <Input
                  id="companyStateCode"
                  value={gstin.length === 15 ? gstin.slice(0, 2) : form.companyStateCode}
                  onChange={(e) => set('companyStateCode', e.target.value.replace(/\D/g, '').slice(0, 2))}
                  readOnly={gstin.length === 15}
                  placeholder="33"
                  inputMode="numeric"
                />
                <p className="mt-1 text-xs text-slate-500">
                  {gstin.length === 15
                    ? 'Taken from your GSTIN.'
                    : 'Tamil Nadu is 33. Decides CGST+SGST vs IGST.'}
                </p>
              </div>
            </div>

            <div className="sm:max-w-xs">
              <Label htmlFor="fyStart">Financial year starts</Label>
              <select
                id="fyStart"
                value={form.financialYearStartMonth}
                onChange={(e) => set('financialYearStartMonth', Number(e.target.value))}
                className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-800"
              >
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            {stateMismatch ? (
              <p className="text-xs font-medium text-rose-600">
                Your GSTIN starts with {gstin.slice(0, 2)} but the state code says{' '}
                {form.companyStateCode.trim()}. One of them is a typo.
              </p>
            ) : null}

            {message ? (
              <p
                className={
                  message.kind === 'ok'
                    ? 'text-xs font-medium text-emerald-700'
                    : 'text-xs font-medium text-rose-600'
                }
              >
                {message.text}
              </p>
            ) : null}

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={saving || gstinLooksWrong || stateMismatch}>
                {saving ? 'Saving…' : 'Save company details'}
              </Button>
              <span className="text-xs text-slate-500">
                Applies to invoices created from now on; already-issued PDFs are unchanged.
              </span>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
