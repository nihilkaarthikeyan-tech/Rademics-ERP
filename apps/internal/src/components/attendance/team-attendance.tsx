'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Circle, Wifi, WifiOff } from 'lucide-react';
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, LoadingState } from '@rademics/ui';
import { apiFetch } from '@/lib/api';
import { connectPresence } from '@/lib/socket';
import { PendingApprovals } from './pending-approvals';

interface OnlineUser {
  userId: string;
  name: string;
  email: string;
  team: { id: string; name: string } | null;
  since: string;
}

interface DayRow {
  id: string;
  date: string;
  status: string;
  workedSeconds: number;
  idleSeconds: number;
  overtimeSeconds: number;
  isLate: boolean;
  lateDeductionApplied: boolean;
  user: { id: string; name: string; email: string };
}

interface HistoryResp {
  items: DayRow[];
  total: number;
}

const STATUS_TONE: Record<string, 'green' | 'amber' | 'slate' | 'red' | 'blue'> = {
  PRESENT: 'green',
  HALF_DAY: 'amber',
  ABSENT: 'red',
  WEEKLY_OFF: 'slate',
  ON_LEAVE: 'blue',
};

function fmt(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

/** Manager view: live who's-online, scoped/all daily records, and an approvals inbox. */
export function TeamAttendance({ scope }: { scope: 'all' | 'team' }) {
  const onlinePath = scope === 'all' ? '/attendance/online' : '/attendance/team/online';
  const historyPath = scope === 'all' ? '/attendance' : '/attendance/team';

  const [online, setOnline] = useState<OnlineUser[] | null>(null);
  const [history, setHistory] = useState<HistoryResp | null>(null);
  const [historyState, setHistoryState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [live, setLive] = useState(false);
  const loadOnlineRef = useRef<() => void>(() => undefined);

  const loadOnline = useCallback(async () => {
    try {
      setOnline(await apiFetch<OnlineUser[]>(onlinePath));
    } catch {
      setOnline([]);
    }
  }, [onlinePath]);
  loadOnlineRef.current = loadOnline;

  const loadHistory = useCallback(async () => {
    setHistoryState('loading');
    try {
      setHistory(await apiFetch<HistoryResp>(`${historyPath}?pageSize=50`));
      setHistoryState('ready');
    } catch {
      setHistoryState('error');
    }
  }, [historyPath]);

  useEffect(() => {
    void loadOnline();
    void loadHistory();
  }, [loadOnline, loadHistory]);

  // Real-time presence with a 30s polling fallback (Spec §5.3, §25).
  useEffect(() => {
    const socket = connectPresence();
    const poll = setInterval(() => loadOnlineRef.current(), 30_000);
    socket.on('connect', () => setLive(true));
    socket.on('disconnect', () => setLive(false));
    socket.io.on('reconnect_failed', () => setLive(false));
    socket.on('presence:update', () => loadOnlineRef.current());
    return () => {
      clearInterval(poll);
      socket.close();
    };
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>
            Online now{online ? <span className="ml-2 text-slate-400">({online.length})</span> : null}
          </CardTitle>
          <Badge tone={live ? 'green' : 'slate'}>
            <span className="flex items-center gap-1">
              {live ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
              {live ? 'Live' : 'Polling'}
            </span>
          </Badge>
        </CardHeader>
        <CardContent>
          {online === null ? (
            <LoadingState />
          ) : online.length === 0 ? (
            <p className="text-sm text-slate-500">No one is checked in right now.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {online.map((u) => (
                <li
                  key={u.userId}
                  className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm"
                >
                  <Circle className="h-2 w-2 fill-slate-900 text-slate-900" />
                  <span className="font-medium text-slate-700">{u.name}</span>
                  {u.team ? <span className="text-xs text-slate-400">· {u.team.name}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <PendingApprovals />

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Daily records</CardTitle>
        </CardHeader>
        {historyState === 'loading' ? (
          <CardContent>
            <LoadingState />
          </CardContent>
        ) : historyState === 'error' ? (
          <CardContent>
            <EmptyState title="Could not load records" description="Please try again." />
          </CardContent>
        ) : !history || history.items.length === 0 ? (
          <CardContent>
            <EmptyState
              title="No records yet"
              description="Daily marks appear after the nightly computation runs (or a manual recompute)."
            />
          </CardContent>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Date</th>
                  <th className="px-4 py-2.5 font-medium">Employee</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Worked</th>
                  <th className="px-4 py-2.5 font-medium">Idle</th>
                  <th className="px-4 py-2.5 font-medium">Overtime</th>
                  <th className="px-4 py-2.5 font-medium">Late</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {history.items.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 tabular-nums text-slate-600">{r.date.slice(0, 10)}</td>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-slate-800">{r.user.name}</div>
                      <div className="text-xs text-slate-400">{r.user.email}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={STATUS_TONE[r.status] ?? 'slate'}>{r.status.replace('_', ' ')}</Badge>
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-slate-600">{fmt(r.workedSeconds)}</td>
                    <td className="px-4 py-2.5 tabular-nums text-slate-500">{fmt(r.idleSeconds)}</td>
                    <td className="px-4 py-2.5 tabular-nums text-slate-500">
                      {r.overtimeSeconds > 0 ? fmt(r.overtimeSeconds) : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      {r.isLate ? (
                        <Badge tone={r.lateDeductionApplied ? 'red' : 'amber'}>
                          {r.lateDeductionApplied ? 'Late · deduction' : 'Late'}
                        </Badge>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">
              {history.total} {history.total === 1 ? 'record' : 'records'}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
