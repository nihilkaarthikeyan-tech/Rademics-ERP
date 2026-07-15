'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { apiFetch, ApiError } from './api';

export interface TodayStatus {
  date: string;
  checkedIn: boolean;
  openSince: string | null;
  workedSeconds: number;
  idleSeconds: number;
  isLate: boolean;
  status: string;
}

interface AttendanceContextValue {
  status: TodayStatus | null;
  state: 'loading' | 'ready' | 'error';
  busy: boolean;
  error: string | null;
  autoCheckedOut: boolean;
  checkIn: () => Promise<void>;
  checkOut: () => Promise<void>;
  dismissAutoCheckedOut: () => void;
}

const AttendanceContext = createContext<AttendanceContextValue | null>(null);

const POLL_MS = 20_000; // activity check + heartbeat-if-active + status refresh
const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'] as const;

/**
 * App-wide attendance state (Spec §5.3). Lives above the page router (not tied to
 * the Dashboard) so idle tracking keeps running no matter which page is open.
 *
 * The heartbeat only fires when there was real mouse/keyboard/touch activity since
 * the last one sent — an unattended tab must not keep resetting the server's idle
 * clock, or the idle-checkout sweep (attendance.processor.ts) could never trigger.
 */
export function AttendanceProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<TodayStatus | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoCheckedOut, setAutoCheckedOut] = useState(false);

  const lastActivityAt = useRef(Date.now());
  const lastHeartbeatSentAt = useRef(0);
  const manualCheckoutInFlight = useRef(false);
  const prevCheckedIn = useRef<boolean | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await apiFetch<TodayStatus>('/attendance/today');
      if (prevCheckedIn.current === true && !s.checkedIn && !manualCheckoutInFlight.current) {
        setAutoCheckedOut(true);
      }
      prevCheckedIn.current = s.checkedIn;
      setStatus(s);
      setState('ready');
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Track real activity anywhere in the app, not just on one page.
  useEffect(() => {
    const onActivity = () => {
      lastActivityAt.current = Date.now();
    };
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    return () => ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
  }, []);

  useEffect(() => {
    if (!status?.checkedIn) return;
    const t = setInterval(() => {
      const activeSinceLastHeartbeat = lastActivityAt.current > lastHeartbeatSentAt.current;
      if (activeSinceLastHeartbeat) {
        lastHeartbeatSentAt.current = Date.now();
        apiFetch('/attendance/heartbeat', { method: 'POST', body: '{}' }).catch(() => undefined);
      }
      void load(); // also picks up a server-side idle auto-checkout promptly
    }, POLL_MS);
    return () => clearInterval(t);
  }, [status?.checkedIn, load]);

  const checkIn = useCallback(async () => {
    setBusy(true);
    setError(null);
    setAutoCheckedOut(false);
    try {
      const key = crypto.randomUUID(); // idempotent retry key (§25 internet-drop)
      await apiFetch('/attendance/check-in', {
        method: 'POST',
        body: JSON.stringify({ idempotencyKey: key }),
      });
      lastActivityAt.current = Date.now();
      lastHeartbeatSentAt.current = Date.now();
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Check-in failed');
    } finally {
      setBusy(false);
    }
  }, [load]);

  const checkOut = useCallback(async () => {
    setBusy(true);
    setError(null);
    manualCheckoutInFlight.current = true;
    try {
      await apiFetch('/attendance/check-out', { method: 'POST', body: '{}' });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Check-out failed');
    } finally {
      setBusy(false);
      manualCheckoutInFlight.current = false;
    }
  }, [load]);

  return (
    <AttendanceContext.Provider
      value={{
        status,
        state,
        busy,
        error,
        autoCheckedOut,
        checkIn,
        checkOut,
        dismissAutoCheckedOut: () => setAutoCheckedOut(false),
      }}
    >
      {children}
    </AttendanceContext.Provider>
  );
}

export function useAttendance(): AttendanceContextValue {
  const ctx = useContext(AttendanceContext);
  if (!ctx) throw new Error('useAttendance must be used within AttendanceProvider');
  return ctx;
}
