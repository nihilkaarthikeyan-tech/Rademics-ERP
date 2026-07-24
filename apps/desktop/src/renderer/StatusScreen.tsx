import { useEffect, useRef, useState } from 'react';
import { LogIn, LogOut, Clock } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@rademics/ui';
import type { AuthUserPayload, TodayStatus } from '../shared/ipc';

function fmtDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function StatusScreen({ user }: { user: AuthUserPayload }) {
  const [status, setStatus] = useState<TodayStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoCheckedOut, setAutoCheckedOut] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const baseline = useRef<{ worked: number; at: number } | null>(null);

  useEffect(() => {
    const unsubscribe = window.rademicsDesktop.onStatusUpdated((payload) => {
      setStatus(payload.status);
      if (payload.autoCheckedOut) setAutoCheckedOut(true);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (status) baseline.current = { worked: status.workedSeconds, at: Date.now() };
  }, [status]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const liveWorked =
    status?.checkedIn && baseline.current
      ? baseline.current.worked + (now - baseline.current.at) / 1000
      : (status?.workedSeconds ?? 0);

  async function onCheckIn() {
    setBusy(true);
    setError(null);
    setAutoCheckedOut(false);
    const res = await window.rademicsDesktop.checkIn();
    if (!res.ok) setError(res.error ?? 'Check-in failed');
    setBusy(false);
  }

  async function onCheckOut() {
    setBusy(true);
    setError(null);
    const res = await window.rademicsDesktop.checkOut();
    if (!res.ok) setError(res.error ?? 'Check-out failed');
    setBusy(false);
  }

  return (
    <div className="flex h-full flex-col gap-4 px-5 py-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-800">{user.email}</p>
          <p className="text-xs text-slate-400">Rademics Desktop Agent</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => window.rademicsDesktop.logout()}>
          Sign out
        </Button>
      </div>

      <Card className="animate-rise">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-slate-400" />
            Attendance
          </CardTitle>
          {status === null ? (
            <Badge tone="slate">Loading…</Badge>
          ) : status.checkedIn ? (
            <Badge tone="green">Checked in</Badge>
          ) : (
            <Badge tone="slate">Checked out</Badge>
          )}
        </CardHeader>
        <CardContent>
          {status === null ? (
            <div className="flex h-24 items-center justify-center text-sm text-slate-400">
              Loading your attendance…
            </div>
          ) : (
          <>
          {autoCheckedOut ? (
            <div className="mb-3 flex items-start justify-between gap-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <span>You were automatically checked out after a period of inactivity.</span>
              <button
                onClick={() => setAutoCheckedOut(false)}
                className="shrink-0 text-xs font-medium text-amber-700 hover:underline"
              >
                Dismiss
              </button>
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-6">
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
              {status?.overtimeSeconds ? (
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-400">Overtime</div>
                  <div className="text-2xl font-semibold tabular-nums text-amber-600">
                    {fmtDuration(status.overtimeSeconds)}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-1">
            {status?.checkedIn ? (
              <Button onClick={onCheckOut} disabled={busy} variant="outline">
                <LogOut className="mr-2 h-4 w-4" />
                Check out
              </Button>
            ) : (
              <Button onClick={onCheckIn} disabled={busy}>
                <LogIn className="mr-2 h-4 w-4" />
                Check in
              </Button>
            )}
            {error ? <p className="text-xs text-red-600">{error}</p> : null}
          </div>
          </>
          )}
        </CardContent>
      </Card>

      <p className="text-center font-mono text-[10px] uppercase tracking-widest text-slate-500">
        Tracks active/idle time only — no screen or app activity is recorded.
      </p>
    </div>
  );
}
