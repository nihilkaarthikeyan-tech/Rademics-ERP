'use client';

import { useEffect, useRef, useState } from 'react';
import { Clock, LogIn, LogOut, Monitor } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@rademics/ui';
import { useAttendance } from '@/lib/attendance-context';
import { useMe } from '@/lib/me-context';

function fmtDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/**
 * Dashboard check-in/out card (Spec §17.1 widget 1). Sticky on mobile. The
 * heartbeat/idle tracking itself runs app-wide in AttendanceProvider (Spec §5.3)
 * so it keeps working no matter which page is open — this component is display only.
 */
export function AttendanceCard() {
  const { status, state, busy, error, autoCheckedOut, checkIn, checkOut, dismissAutoCheckedOut } =
    useAttendance();
  const me = useMe();
  const [now, setNow] = useState(() => Date.now());

  // Baseline worked seconds + the wall-clock at which we learned it, so the live
  // timer can extrapolate without re-fetching every second.
  const baseline = useRef<{ worked: number; at: number } | null>(null);
  useEffect(() => {
    if (status) baseline.current = { worked: status.workedSeconds, at: Date.now() };
  }, [status]);

  // 1s tick for the live timer (only meaningful while checked in).
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

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
          <div className="flex flex-col gap-3">
            {autoCheckedOut ? (
              <div className="flex items-start justify-between gap-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                <span>You were automatically checked out after a period of inactivity.</span>
                <button
                  onClick={dismissAutoCheckedOut}
                  className="shrink-0 text-xs font-medium text-amber-700 hover:underline"
                >
                  Dismiss
                </button>
              </div>
            ) : null}
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
                {me.desktopCheckInRequired ? (
                  <div className="flex max-w-[220px] items-center gap-2 rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-500">
                    <Monitor className="h-4 w-4 shrink-0 text-slate-400" />
                    Use the Rademics Desktop Agent on your computer to check in.
                  </div>
                ) : status?.checkedIn ? (
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
          </div>
        )}
      </CardContent>
    </Card>
  );
}
