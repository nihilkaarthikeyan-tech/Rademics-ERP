'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Card, CardContent, CardHeader, CardTitle, Button, LoadingState } from '@rademics/ui';
import { apiFetch, ApiError } from '@/lib/api';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface LeaveEntry {
  id: string;
  userName: string;
  type: string;
  half: boolean;
  fromDate: string;
  toDate: string;
  status: string;
}
interface CalendarData {
  from: string;
  to: string;
  holidays: { date: string; name: string }[];
  secondSaturdays: string[];
  leave: LeaveEntry[];
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** 'YYYY-MM-DD' for a UTC date, matching the API's date keys. */
const key = (d: Date) => d.toISOString().slice(0, 10);

export default function CalendarPage() {
  const today = new Date();
  const [year, setYear] = useState(today.getUTCFullYear());
  const [month, setMonth] = useState(today.getUTCMonth()); // 0-11
  const [data, setData] = useState<CalendarData | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    const from = key(new Date(Date.UTC(year, month, 1)));
    const to = key(new Date(Date.UTC(year, month + 1, 0)));
    try {
      const d = await apiFetch<CalendarData>(`/leave/company-calendar?from=${from}&to=${to}`);
      setData(d);
      setState('ready');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the calendar');
      setState('error');
    }
  }, [year, month]);

  useEffect(() => { void load(); }, [load]);

  // Index the month's dates once, so each cell is a lookup rather than a scan.
  const byDate = useMemo(() => {
    const map = new Map<string, { holiday?: string; secondSat?: boolean; leave: LeaveEntry[] }>();
    const entry = (k: string) => {
      let e = map.get(k);
      if (!e) { e = { leave: [] }; map.set(k, e); }
      return e;
    };
    for (const h of data?.holidays ?? []) entry(h.date).holiday = h.name;
    for (const s of data?.secondSaturdays ?? []) entry(s).secondSat = true;
    for (const l of data?.leave ?? []) {
      // A leave request spans a range; mark every day it covers.
      for (let t = Date.parse(l.fromDate); t <= Date.parse(l.toDate); t += 86_400_000) {
        entry(new Date(t).toISOString().slice(0, 10)).leave.push(l);
      }
    }
    return map;
  }, [data]);

  // Monday-first grid: leading blanks, then each day of the month.
  const cells = useMemo(() => {
    const first = new Date(Date.UTC(year, month, 1));
    const lead = (first.getUTCDay() + 6) % 7; // Sun=0 -> 6, Mon=1 -> 0
    const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return [
      ...Array.from({ length: lead }, () => null),
      ...Array.from({ length: days }, (_, i) => new Date(Date.UTC(year, month, i + 1))),
    ];
  }, [year, month]);

  function step(delta: number) {
    const d = new Date(Date.UTC(year, month + delta, 1));
    setYear(d.getUTCFullYear());
    setMonth(d.getUTCMonth());
  }

  const todayKey = key(new Date());

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Company Calendar</h1>
          <p className="text-sm text-slate-500">Holidays, second Saturdays and who is on leave.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => step(-1)} aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[10rem] text-center text-sm font-medium text-slate-700">
            {MONTHS[month]} {year}
          </span>
          <Button size="sm" variant="outline" onClick={() => step(1)} aria-label="Next month">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-rose-400" /> Holiday</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-violet-400" /> 2nd Saturday</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-amber-400" /> On leave</span>
      </div>

      {error ? <p className="mt-3 text-sm font-medium text-red-600">{error}</p> : null}

      {state === 'loading' ? (
        <LoadingState />
      ) : (
        <Card className="mt-4">
          <CardContent className="p-3 sm:p-4">
            <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-slate-400">
              {WEEKDAYS.map((w) => <div key={w} className="py-1">{w}</div>)}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {cells.map((d, i) => {
                if (!d) return <div key={`blank-${i}`} />;
                const k = key(d);
                const info = byDate.get(k);
                const sunday = d.getUTCDay() === 0;
                const isToday = k === todayKey;
                const off = Boolean(info?.holiday) || Boolean(info?.secondSat) || sunday;
                return (
                  <div
                    key={k}
                    className={[
                      'min-h-[4.5rem] rounded-md border p-1.5 text-left',
                      off ? 'border-slate-200 bg-slate-50' : 'border-slate-200 bg-white',
                      isToday ? 'ring-2 ring-[#7C6CF6]' : '',
                    ].join(' ')}
                  >
                    <div className="flex items-start justify-between">
                      <span className={`text-xs font-semibold ${off ? 'text-slate-400' : 'text-slate-700'}`}>
                        {d.getUTCDate()}
                      </span>
                      <span className="flex gap-0.5">
                        {info?.holiday ? <span className="h-1.5 w-1.5 rounded-full bg-rose-400" /> : null}
                        {info?.secondSat ? <span className="h-1.5 w-1.5 rounded-full bg-violet-400" /> : null}
                        {info?.leave.length ? <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> : null}
                      </span>
                    </div>
                    {info?.holiday ? (
                      <p className="mt-0.5 truncate text-[10px] font-medium text-rose-600" title={info.holiday}>
                        {info.holiday}
                      </p>
                    ) : null}
                    {info?.secondSat ? (
                      <p className="mt-0.5 text-[10px] font-medium text-violet-600">2nd Saturday</p>
                    ) : null}
                    {info?.leave.slice(0, 2).map((l) => (
                      <p key={l.id} className="mt-0.5 truncate text-[10px] text-amber-700" title={`${l.userName} — ${l.type}`}>
                        {l.userName.split(' ')[0]}{l.half ? ' ½' : ''}
                      </p>
                    ))}
                    {info && info.leave.length > 2 ? (
                      <p className="text-[10px] text-slate-400">+{info.leave.length - 2} more</p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {state === 'ready' && data ? (
        <Card className="mt-4">
          <CardHeader><CardTitle>This month</CardTitle></CardHeader>
          <CardContent className="space-y-2 pb-5">
            {data.holidays.length === 0 && data.secondSaturdays.length === 0 && data.leave.length === 0 ? (
              <p className="text-sm text-slate-500">Nothing scheduled this month.</p>
            ) : null}
            {data.holidays.map((h) => (
              <div key={h.date} className="flex items-center gap-2 text-sm">
                <Badge tone="red">Holiday</Badge>
                <span className="text-slate-600">{h.date}</span>
                <span className="font-medium text-slate-800">{h.name}</span>
              </div>
            ))}
            {data.secondSaturdays.map((s) => (
              <div key={s} className="flex items-center gap-2 text-sm">
                <Badge tone="blue">2nd Saturday</Badge>
                <span className="text-slate-600">{s}</span>
                <span className="text-slate-500">Company off-day</span>
              </div>
            ))}
            {data.leave.map((l) => (
              <div key={l.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Badge tone={l.status === 'APPROVED' ? 'amber' : 'slate'}>{l.status}</Badge>
                <span className="font-medium text-slate-800">{l.userName}</span>
                <span className="text-slate-500">{l.type}{l.half ? ' (half day)' : ''}</span>
                <span className="text-slate-600">
                  {l.fromDate}{l.toDate !== l.fromDate ? ` → ${l.toDate}` : ''}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
