'use client';

import { useState } from 'react';
import { Button, Input, Label } from '@rademics/ui';
import { apiFetch, ApiError } from '@/lib/api';

/**
 * Employee regularization request form (Spec §5.3, §24). Reason ≥ 10 chars; optional
 * corrected check-in/out times. On success the parent refreshes the requests list.
 */
export function RegularizationForm({ onSubmitted }: { onSubmitted: () => void }) {
  const [date, setDate] = useState('');
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
        body: JSON.stringify({
          date,
          reason,
          requestedCheckInAt: checkIn ? new Date(checkIn).toISOString() : undefined,
          requestedCheckOutAt: checkOut ? new Date(checkOut).toISOString() : undefined,
        }),
      });
      setOk(true);
      setDate('');
      setReason('');
      setCheckIn('');
      setCheckOut('');
      onSubmitted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not submit request');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
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
        <div>
          <Label htmlFor="reg-in">Corrected check-in (optional)</Label>
          <Input id="reg-in" type="datetime-local" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="reg-out">Corrected check-out (optional)</Label>
          <Input id="reg-out" type="datetime-local" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
        </div>
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
          placeholder="Explain the correction (at least 10 characters)…"
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
