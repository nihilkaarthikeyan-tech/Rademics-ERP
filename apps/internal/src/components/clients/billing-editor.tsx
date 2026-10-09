'use client';

import { useState } from 'react';
import { Button, Input, Label } from '@rademics/ui';
import { apiFetch, ApiError } from '@/lib/api';

/**
 * A client's GSTIN and state — the input that decides whether their invoices
 * carry CGST+SGST or IGST.
 *
 * Deliberately editable after creation: a client org exists as a reserved number
 * long before anyone knows who the client is, and a real customer can re-register
 * or move state. Leaving it blank is a legitimate answer for an unregistered
 * (B2C) customer, so nothing here is required.
 */

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{2}$/;

const STATES: Array<[string, string]> = [
  ['', 'Not set'],
  ['33', 'Tamil Nadu (33)'], ['29', 'Karnataka (29)'], ['32', 'Kerala (32)'],
  ['36', 'Telangana (36)'], ['37', 'Andhra Pradesh (37)'], ['27', 'Maharashtra (27)'],
  ['24', 'Gujarat (24)'], ['07', 'Delhi (07)'], ['06', 'Haryana (06)'],
  ['09', 'Uttar Pradesh (09)'], ['19', 'West Bengal (19)'], ['08', 'Rajasthan (08)'],
  ['23', 'Madhya Pradesh (23)'], ['03', 'Punjab (03)'], ['30', 'Goa (30)'],
  ['34', 'Puducherry (34)'], ['21', 'Odisha (21)'], ['10', 'Bihar (10)'],
  ['18', 'Assam (18)'], ['22', 'Chhattisgarh (22)'], ['20', 'Jharkhand (20)'],
  ['05', 'Uttarakhand (05)'], ['02', 'Himachal Pradesh (02)'],
];

export interface Billing {
  gstin: string | null;
  stateCode: string | null;
  billingAddress: string | null;
}

export function BillingEditor({
  orgId,
  initial,
  onSaved,
}: {
  orgId: string;
  initial: Billing;
  onSaved: (b: Billing) => void;
}) {
  const [gstin, setGstin] = useState(initial.gstin ?? '');
  const [stateCode, setStateCode] = useState(initial.stateCode ?? '');
  const [address, setAddress] = useState(initial.billingAddress ?? '');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const trimmed = gstin.trim().toUpperCase();
  const gstinBad = trimmed.length > 0 && !GSTIN_RE.test(trimmed);
  // A GSTIN carries its own state in the first two digits, so the picker is only
  // for customers who have no GSTIN at all.
  const derived = trimmed.length === 15 ? trimmed.slice(0, 2) : null;

  async function save() {
    if (gstinBad) return;
    setSaving(true);
    setMsg(null);
    try {
      const saved = await apiFetch<Billing>(`/client-orgs/${orgId}/billing`, {
        method: 'PUT',
        body: JSON.stringify({
          gstin: trimmed,
          stateCode: derived ?? stateCode,
          billingAddress: address.trim(),
        }),
      });
      onSaved(saved);
      setMsg({ ok: true, text: 'Saved.' });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Could not save.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg bg-slate-50/70 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`gstin-${orgId}`}>Client GSTIN</Label>
          <Input
            id={`gstin-${orgId}`}
            value={gstin}
            onChange={(e) => { setGstin(e.target.value.toUpperCase()); setMsg(null); }}
            placeholder="29AABCU9603R1ZM"
            spellCheck={false}
            aria-invalid={gstinBad || undefined}
          />
          {gstinBad ? (
            <p className="mt-1 text-xs font-medium text-rose-600">
              That is not a valid GSTIN (15 characters).
            </p>
          ) : (
            <p className="mt-1 text-xs text-slate-500">Blank if the customer is not registered.</p>
          )}
        </div>
        <div>
          <Label htmlFor={`state-${orgId}`}>State (place of supply)</Label>
          <select
            id={`state-${orgId}`}
            value={derived ?? stateCode}
            disabled={derived !== null}
            onChange={(e) => { setStateCode(e.target.value); setMsg(null); }}
            className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-800 disabled:bg-slate-100 disabled:text-slate-500"
          >
            {STATES.map(([code, label]) => (
              <option key={code} value={code}>{label}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">
            {derived ? 'Taken from the GSTIN.' : 'Decides CGST+SGST vs IGST on their invoices.'}
          </p>
        </div>
      </div>

      <div>
        <Label htmlFor={`addr-${orgId}`}>Billing address</Label>
        <Input
          id={`addr-${orgId}`}
          value={address}
          onChange={(e) => { setAddress(e.target.value); setMsg(null); }}
          placeholder="Optional — shown on the invoice"
        />
      </div>

      <div className="flex items-center gap-3">
        <Button size="sm" onClick={() => void save()} disabled={saving || gstinBad}>
          {saving ? 'Saving…' : 'Save billing details'}
        </Button>
        {msg ? (
          <span className={msg.ok ? 'text-xs font-medium text-emerald-700' : 'text-xs font-medium text-rose-600'}>
            {msg.text}
          </span>
        ) : (
          <span className="text-xs text-slate-500">Applies to invoices raised from now on.</span>
        )}
      </div>
    </div>
  );
}
