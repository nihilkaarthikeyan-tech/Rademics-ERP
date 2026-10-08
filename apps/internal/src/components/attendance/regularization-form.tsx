'use client';

import { useState } from 'react';
import { Button, Input, Label } from '@rademics/ui';
import { apiFetch, ApiError } from '@/lib/api';

type Kind = 'CORRECTION' | 'POWER_CUT';

/**
 * Employee regularization request form (Spec §5.3, §24). Reason ≥ 10 chars.
 * CORRECTION: optional corrected check-in/out. POWER_CUT: the outage window —
 * on approval the idle charged inside it is removed (the machine was off, so
 * the desktop app couldn't see the work). On success the parent refreshes.
 */
export function RegularizationForm({ onSubmitted }: { onSubmitted: () => void }) {
  const [kind, setKind] = useState<Kind>('CORRECTION');
  const [date, setDate] = useState('');
  const [cutFrom, setCutFrom] = useState('');
  const [cutTo, setCutTo] = useState('');
  const [reason, setReason] = useState('');
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOk(false);
    try {
      await apiFetch('/attendance/regularizations', {
        method: 'POST',
        body: JSON.stringify(
          kind === 'POWER_CUT'
            ? {
                kind,
                date,
                reason,
                requestedCheckInAt: new Date(`${date}T${cutFrom}`).toISOString(),
                requestedCheckOutAt: new Date(`${date}T${cutTo}`).toISOString(),
              }
            : {
                date,
                reason,
                requestedCheckInAt: checkIn ? new Date(checkIn).toISOString() : undefined,
                requestedCheckOutAt: checkOut ? new Date(checkOut).toISOString() : undefined,
              },
        ),
      });
      setOk(true);
      setDate('');
      setReason('');
      setCheckIn('');
      setCheckOut('');
      setCutFrom('');
      setCutTo('');
      onSubmitted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not submit request');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div role="radiogroup" aria-label="Request type" className="flex gap-2">
        {(
          [
            ['CORRECTION', 'Correct my check-in/out'],
            ['POWER_CUT', 'Power cut (remove idle)'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={kind === value}
            onClick={() => setKind(value)}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
              kind === value
                ? 'border-accent bg-accent/10 text-slate-900'
                : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {kind === 'POWER_CUT' ? (
        <p className="text-xs text-slate-500">
          For when your computer switched off and the app couldn&apos;t see your work. Once approved, idle time
          between these times is removed.
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="reg-date">Date</Label>
          <Input
            id="reg-date"
            type="date"
            required
            value={date}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        {kind === 'POWER_CUT' ? (
          <>
            <div>
              <Label htmlFor="reg-cut-from">Power went off at</Label>
              <Input id="reg-cut-from" type="time" required value={cutFrom} onChange={(e) => setCutFrom(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="reg-cut-to">Power came back at</Label>
              <Input id="reg-cut-to" type="time" required value={cutTo} onChange={(e) => setCutTo(e.target.value)} />
            </div>
          </>
        ) : (
          <>
            <div>
              <Label htmlFor="reg-in">Corrected check-in (optional)</Label>
              <Input id="reg-in" type="datetime-local" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="reg-out">Corrected check-out (optional)</Label>
              <Input id="reg-out" type="datetime-local" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
            </div>
          </>
        )}
      </div>
      <div>
        <Label htmlFor="reg-reason">Reason</Label>
        <textarea
          id="reg-reason"
          required
          minLength={10}
          maxLength={500}
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={
            kind === 'POWER_CUT'
              ? 'e.g. Power cut in my area, the PC was off (at least 10 characters)…'
              : 'Explain the correction (at least 10 characters)…'
          }
          className="flex w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1"
        />
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? 'Submitting…' : 'Request regularization'}
        </Button>
        {ok ? <span className="text-xs text-slate-900">Request submitted for approval.</span> : null}
        {error ? <span className="text-xs text-slate-900">{error}</span> : null}
      </div>
    </form>
  );
}
