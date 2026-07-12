'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, CardContent, Input, Label, LoadingState } from '@rademics/ui';
import { apiFetch, API_BASE } from '@/lib/api';
import { getToken } from '@/lib/session';

interface Column { key: string; label: string }
interface ReportData { title: string; columns: Column[]; rows: Record<string, unknown>[] }

const REPORTS = [
  { key: 'attendance', label: 'Attendance', ranged: true },
  { key: 'productivity', label: 'Productivity', ranged: true },
  { key: 'project-status', label: 'Project Status', ranged: false },
] as const;

async function download(type: string, format: 'csv' | 'pdf', from: string, to: string) {
  const qs = new URLSearchParams({ format });
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  const res = await fetch(`${API_BASE}/reports/${type}/export?${qs.toString()}`, { headers: { authorization: `Bearer ${getToken() ?? ''}` } });
  if (!res.ok) return;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = `${type}-report.${format}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const AVAIL_TONE: Record<string, 'green' | 'amber' | 'red'> = { GREEN: 'green', AMBER: 'amber', RED: 'red' };

export default function ReportsPage() {
  const [tab, setTab] = useState<string>('attendance');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<ReportData | null>(null);
  const [capacity, setCapacity] = useState<Record<string, unknown>[] | null>(null);

  const active = REPORTS.find((r) => r.key === tab);

  const load = useCallback(async () => {
    setData(null);
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    try {
      setData(await apiFetch<ReportData>(`/reports/${tab}?${qs.toString()}`));
    } catch {
      setData({ title: 'Report', columns: [], rows: [] });
    }
  }, [tab, from, to]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    apiFetch<Record<string, unknown>[]>('/reports/capacity').then(setCapacity).catch(() => setCapacity([]));
  }, []);

  return (
    <div className="mx-auto max-w-6xl">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Reports</h1>
        <p className="mt-1 text-sm text-slate-500">Attendance, productivity, project status &amp; team capacity — scoped to your access.</p>
      </div>

      {/* Capacity strip (§5.9) */}
      <Card className="mt-4">
        <CardContent className="pt-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Team capacity</h2>
          {capacity === null ? (
            <LoadingState />
          ) : capacity.length === 0 ? (
            <p className="text-sm text-slate-500">No one in your capacity scope.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {capacity.map((c) => (
                <div key={String(c.userId)} className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-1.5 text-sm">
                  <Badge tone={AVAIL_TONE[String(c.availability)] ?? 'slate'}>{String(c.availability)}</Badge>
                  <span className="text-slate-700">{String(c.name)}</span>
                  <span className="text-xs text-slate-400">{String(c.openTasks)} open · {String(c.loadHours)}h / {String(c.weeklyCapacity)}h</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
        <div className="flex gap-1 border-b border-slate-200">
          {REPORTS.map((r) => (
            <button key={r.key} onClick={() => setTab(r.key)} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === r.key ? 'border-accent text-accent' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>{r.label}</button>
          ))}
        </div>
        <div className="flex items-end gap-2">
          {active?.ranged ? (
            <>
              <div>
                <Label htmlFor="r-from">From</Label>
                <Input id="r-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-36" />
              </div>
              <div>
                <Label htmlFor="r-to">To</Label>
                <Input id="r-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-36" />
              </div>
            </>
          ) : null}
          <Button size="sm" variant="outline" onClick={() => download(tab, 'csv', from, to)}>CSV</Button>
          <Button size="sm" variant="outline" onClick={() => download(tab, 'pdf', from, to)}>PDF</Button>
        </div>
      </div>

      <Card className="mt-3 overflow-hidden">
        {data === null ? (
          <CardContent className="pt-5"><LoadingState /></CardContent>
        ) : data.rows.length === 0 ? (
          <CardContent className="pt-5"><p className="text-sm text-slate-500">No data for this range.</p></CardContent>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>{data.columns.map((c) => <th key={c.key} className="px-3 py-2.5 font-medium">{c.label}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.rows.map((row, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    {data.columns.map((c) => <td key={c.key} className="px-3 py-2.5 tabular-nums text-slate-600">{String(row[c.key] ?? '—')}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
