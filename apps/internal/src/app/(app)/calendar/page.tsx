'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Card, CardContent, CardHeader, CardTitle, Button, Input, Label, LoadingState } from '@rademics/ui';
import { apiFetch, ApiError } from '@/lib/api';
import { useMe } from '@/lib/me-context';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

interface LeaveEntry {
  id: string;
  userId: string;
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
  workingDays: number[];
  holidays: { id: string; date: string; name: string }[];
  secondSaturdays: string[];
  leave: LeaveEntry[];
  absences: { id: string; userId: string; userName: string; date: string }[];
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
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [newName, setNewName] = useState('');

  const me = useMe();
  // Same roles the API grants leave.policy.configure to.
  const canManage = me.role === 'SUPER_ADMIN' || me.role === 'HR';

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
    const map = new Map<string, {
      holiday?: string;
      secondSat?: boolean;
      leave: LeaveEntry[];
      absent: { id: string; userId: string; userName: string }[];
    }>();
    const entry = (k: string) => {
      let e = map.get(k);
      if (!e) { e = { leave: [], absent: [] }; map.set(k, e); }
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
    for (const a of data?.absences ?? []) {
      entry(a.date).absent.push({ id: a.id, userId: a.userId, userName: a.userName });
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

  async function addHoliday(e: React.FormEvent) {
    e.preventDefault();
    if (!newDate || !newName.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await apiFetch<{ refundedRequests?: number }>('/leave/holidays', {
        method: 'POST',
        body: JSON.stringify({ date: newDate, name: newName.trim() }),
      });
      setNotice(
        `Holiday added.${r.refundedRequests ? ` ${r.refundedRequests} approved leave request(s) refunded.` : ''}`,
      );
      setNewDate('');
      setNewName('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add the holiday');
    } finally {
      setBusy(false);
    }
  }

  async function removeHoliday(hid: string, name: string) {
    if (!window.confirm(`Remove "${name}"? Leave already refunded for this holiday is not taken back.`)) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/leave/holidays/${hid}`, { method: 'DELETE' });
      setNotice('Holiday removed.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove the holiday');
    } finally {
      setBusy(false);
    }
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
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-rose-400" /> Holiday / weekly off</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-violet-400" /> 2nd Saturday</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-amber-400" /> On leave / absent</span>
      </div>

      {error ? <p className="mt-3 text-sm font-medium text-red-600">{error}</p> : null}
      {notice ? <p className="mt-3 text-sm font-medium text-emerald-700">{notice}</p> : null}

      {state === 'loading' ? (
        <LoadingState />
      ) : (
        <Card className="mt-4">
          <CardContent className="p-3 sm:p-4">
            <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-slate-500">
              {WEEKDAYS.map((w) => <div key={w} className="py-1">{w}</div>)}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {cells.map((d, i) => {
                if (!d) return <div key={`blank-${i}`} />;
                const k = key(d);
                const info = byDate.get(k);
                // Weekly off comes from the configured working days, not a fixed Sunday.
                const weeklyOff = !(data?.workingDays ?? [1, 2, 3, 4, 5, 6]).includes(d.getUTCDay());
                const isToday = k === todayKey;
                const off = Boolean(info?.holiday) || Boolean(info?.secondSat) || weeklyOff;
                return (
                  <div
                    key={k}
                    className={[
                      'min-h-[4.5rem] rounded-md border p-1.5 text-left',
                      off ? 'border-rose-200 bg-rose-50/70' : 'border-slate-200 bg-white',
                      isToday ? 'ring-2 ring-accent' : '',
                    ].join(' ')}
                  >
                    <div className="flex items-start justify-between">
                      <span className={`text-xs font-semibold ${off ? 'text-rose-500' : 'text-slate-700'}`}>
                        {d.getUTCDate()}
                      </span>
                      <span className="flex gap-0.5">
                        {info?.holiday ? <span className="h-1.5 w-1.5 rounded-full bg-rose-400" /> : null}
                        {info?.secondSat ? <span className="h-1.5 w-1.5 rounded-full bg-violet-400" /> : null}
                        {weeklyOff && !info?.holiday && !info?.secondSat ? <span className="h-1.5 w-1.5 rounded-full bg-rose-400" /> : null}
                        {(info?.leave.length || info?.absent.length) ? <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> : null}
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
                    {weeklyOff && !info?.holiday && !info?.secondSat ? (
                      <p className="mt-0.5 text-[10px] font-medium text-rose-500">Weekly off</p>
                    ) : null}
                    {info?.leave.slice(0, 2).map((l) => (
                      <p
                        key={l.id}
                        className={`mt-0.5 truncate text-[10px] ${l.userId === me.id ? 'font-semibold text-amber-800' : 'text-amber-700'} ${l.status === 'PENDING' ? 'italic opacity-70' : ''}`}
                        title={`${l.userName} — ${l.type}${l.half ? ' (half day)' : ''} — ${l.status}`}
                      >
                        {l.userId === me.id ? 'You' : l.userName.split(' ')[0]}{l.half ? ' ½' : ''}
                      </p>
                    ))}
                    {info?.absent.slice(0, 2).map((a) => (
                      <p
                        key={a.id}
                        className={`mt-0.5 truncate text-[10px] ${a.userId === me.id ? 'font-semibold text-amber-800' : 'text-amber-700'}`}
                        title={`${a.userName} — absent (no leave request)`}
                      >
                        {a.userId === me.id ? 'You' : a.userName.split(' ')[0]} ·abs
                      </p>
                    ))}
                    {info && info.leave.length + info.absent.length > 4 ? (
                      <p className="text-[10px] text-slate-500">
                        +{info.leave.length + info.absent.length - 4} more
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {canManage ? (
        <Card className="mt-4">
          <CardHeader><CardTitle>Add a company holiday</CardTitle></CardHeader>
          <CardContent className="pb-5">
            <form onSubmit={addHoliday} className="flex flex-wrap items-end gap-3">
              <div>
                <Label htmlFor="h-date">Date</Label>
                <Input
                  id="h-date"
                  type="date"
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  required
                />
              </div>
              <div className="min-w-[14rem] flex-1">
                <Label htmlFor="h-name">Name</Label>
                <Input
                  id="h-name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Diwali"
                  required
                />
              </div>
              <Button type="submit" disabled={busy || !newDate || !newName.trim()}>
                {busy ? 'Adding…' : 'Add holiday'}
              </Button>
            </form>
            <p className="mt-2 text-xs text-slate-500">
              Approved leave falling on a new holiday is refunded automatically.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {state === 'ready' && data ? (
        <Card className="mt-4">
          <CardHeader><CardTitle>This month</CardTitle></CardHeader>
          <CardContent className="space-y-2 pb-5">
            {data.holidays.length === 0 && data.secondSaturdays.length === 0 && data.leave.length === 0 && data.absences.length === 0 ? (
              <p className="text-sm text-slate-500">Nothing scheduled this month.</p>
            ) : null}
            {data.holidays.map((h) => (
              <div key={h.date} className="flex items-center gap-2 text-sm">
                <Badge tone="red">Holiday</Badge>
                <span className="text-slate-600">{h.date}</span>
                <span className="font-medium text-slate-800">{h.name}</span>
                {canManage ? (
                  <button
                    type="button"
                    onClick={() => void removeHoliday(h.id, h.name)}
                    disabled={busy}
                    className="ml-auto rounded p-1 text-slate-500 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                    aria-label={`Remove ${h.name}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : null}
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
                <span className="font-medium text-slate-800">
                  {l.userName}{l.userId === me.id ? ' (you)' : ''}
                </span>
                <span className="text-slate-500">{l.type}{l.half ? ' (half day)' : ''}</span>
                <span className="text-slate-600">
                  {l.fromDate}{l.toDate !== l.fromDate ? ` → ${l.toDate}` : ''}
                </span>
              </div>
            ))}
            {data.absences.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Badge tone="amber">Absent</Badge>
                <span className="font-medium text-slate-800">
                  {a.userName}{a.userId === me.id ? ' (you)' : ''}
                </span>
                <span className="text-slate-500">No leave request</span>
                <span className="text-slate-600">{a.date}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
