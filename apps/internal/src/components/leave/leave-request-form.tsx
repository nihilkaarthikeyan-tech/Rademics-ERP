'use client';

import { useState } from 'react';
import { Button, Input, Label } from '@rademics/ui';
import { apiFetch, ApiError } from '@/lib/api';

const TYPES = [
  { value: 'CASUAL', label: 'Casual' },
  { value: 'SICK', label: 'Sick' },
  { value: 'EARNED', label: 'Earned' },
  { value: 'UNPAID', label: 'Unpaid' },
];

/**
 * Leave request form (Spec §5.7, §24). Half-day is a single day only; excess beyond
 * balance auto-converts to Unpaid on approval. On success the parent refreshes.
 */
export function LeaveRequestForm({ onSubmitted }: { onSubmitted: () => void }) {
  const [type, setType] = useState('CASUAL');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [half, setHalf] = useState('FULL');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const isHalf = half !== 'FULL';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOk(false);
    try {
      await apiFetch('/leave', {
        method: 'POST',
        body: JSON.stringify({ type, fromDate, toDate: isHalf ? fromDate : toDate, half, reason }),
      });
      setOk(true);
      setFromDate('');
      setToDate('');
      setReason('');
      setHalf('FULL');
      onSubmitted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not submit request');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <div>
          <Label htmlFor="lv-type">Type</Label>
          <select
            id="lv-type"
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="flex h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="lv-from">From</Label>
          <Input id="lv-from" type="date" required value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="lv-to">To</Label>
          <Input
            id="lv-to"
            type="date"
            required={!isHalf}
            disabled={isHalf}
            value={isHalf ? fromDate : toDate}
            min={fromDate || undefined}
            onChange={(e) => setToDate(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="lv-half">Duration</Label>
          <select
            id="lv-half"
            value={half}
            onChange={(e) => setHalf(e.target.value)}
            className="flex h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="FULL">Full day(s)</option>
            <option value="FIRST_HALF">Half day — 1st</option>
            <option value="SECOND_HALF">Half day — 2nd</option>
          </select>
        </div>
      </div>
      <div>
        <Label htmlFor="lv-reason">Reason</Label>
        <textarea
          id="lv-reason"
          required
          minLength={5}
          maxLength={500}
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason for leave…"
          className="flex w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1"
        />
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? 'Submitting…' : 'Request leave'}
        </Button>
        {ok ? <span className="text-xs text-slate-900">Submitted for approval.</span> : null}
        {error ? <span className="text-xs text-slate-900">{error}</span> : null}
      </div>
    </form>
  );
}
