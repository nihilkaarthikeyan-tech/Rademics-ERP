'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Clock, LogIn, LogOut } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@rademics/ui';
import { apiFetch, ApiError } from '@/lib/api';

interface TodayStatus {
  date: string;
  checkedIn: boolean;
  openSince: string | null;
  workedSeconds: number;
  idleSeconds: number;
  isLate: boolean;
  status: string;
}

const HEARTBEAT_MS = 60_000; // activity ping while checked in (Spec §5.3 idle tracking)

function fmtDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/**
 * Dashboard check-in/out card (Spec §17.1 widget 1). Sticky on mobile. Runs a live
 * worked-time timer client-side and a periodic heartbeat so idle is tracked and
 * shown to the employee immediately (§5.3).
 */
export function AttendanceCard() {
  const [status, setStatus] = useState<TodayStatus | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Baseline worked seconds + the wall-clock at which we learned it, so the live
  // timer can extrapolate without re-fetching every second.
  const baseline = useRef<{ worked: number; at: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await apiFetch<TodayStatus>('/attendance/today');
      setStatus(s);
      baseline.current = { worked: s.workedSeconds, at: Date.now() };
      setState('ready');
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 1s tick for the live timer (only meaningful while checked in).
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Heartbeat loop while checked in.
  useEffect(() => {
    if (!status?.checkedIn) return;
    const t = setInterval(() => {
      apiFetch<{ idleSeconds: number }>('/attendance/heartbeat', { method: 'POST', body: '{}' })
        .then((r) => setStatus((prev) => (prev ? { ...prev, idleSeconds: r.idleSeconds } : prev)))
        .catch(() => undefined);
    }, HEARTBEAT_MS);
    return () => clearInterval(t);
  }, [status?.checkedIn]);

  async function checkIn() {
    setBusy(true);
    setError(null);
    try {
      const key = crypto.randomUUID(); // idempotent retry key (§25 internet-drop)
      await apiFetch('/attendance/check-in', {
        method: 'POST',
        body: JSON.stringify({ idempotencyKey: key }),
      });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Check-in failed');
    } finally {
      setBusy(false);
    }
  }

  async function checkOut() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/attendance/check-out', { method: 'POST', body: '{}' });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Check-out failed');
    } finally {
      setBusy(false);
    }
  }

  const liveWorked =
    status?.checkedIn && baseline.current
      ? baseline.current.worked + (now - baseline.current.at) / 1000
      : (status?.workedSeconds ?? 0);

  return (
    <Card className="sticky top-4 z-10">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-slate-400" />
          Attendance
        </CardTitle>
        {status?.checkedIn ? (
          <Badge tone="green">Checked in</Badge>
        ) : (
          <Badge tone="slate">Checked out</Badge>
        )}
      </CardHeader>
      <CardContent>
        {state === 'loading' ? (
          <div className="h-16 animate-pulse rounded bg-slate-100" />
        ) : state === 'error' ? (
          <p className="text-sm text-slate-500">Could not load attendance.</p>
        ) : (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-6">
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-400">Worked today</div>
                <div className="text-2xl font-semibold tabular-nums text-slate-800">
                  {fmtDuration(liveWorked)}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-400">Idle</div>
                <div className="text-2xl font-semibold tabular-nums text-slate-500">
                  {fmtDuration(status?.idleSeconds ?? 0)}
                </div>
              </div>
              {status?.isLate ? (
                <div className="flex items-end">
                  <Badge tone="amber">Late</Badge>
                </div>
              ) : null}
            </div>

            <div className="flex flex-col items-stretch gap-1">
              {status?.checkedIn ? (
                <Button onClick={checkOut} disabled={busy} variant="outline">
                  <LogOut className="mr-2 h-4 w-4" />
                  Check out
                </Button>
              ) : (
                <Button onClick={checkIn} disabled={busy}>
                  <LogIn className="mr-2 h-4 w-4" />
                  Check in
                </Button>
              )}
              {error ? <p className="text-xs text-slate-900">{error}</p> : null}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
