'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, LoadingState } from '@rademics/ui';
import { apiFetch, ApiError, API_BASE } from '@/lib/api';
import { getToken } from '@/lib/session';

interface MonthState { year: number; month: number; status: string }
interface ExportRow { id: string; revision: number; generatedAt: string }

async function downloadCsv(id: string) {
  const res = await fetch(`${API_BASE}/finance/payroll/exports/${id}/csv`, { headers: { authorization: `Bearer ${getToken() ?? ''}` } });
  if (!res.ok) return;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = `payroll-${id}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Payroll export (Spec §5.8): month lock/unlock + immutable revisioned CSV snapshots. */
export function PayrollPanel() {
  const now = new Date();
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const [state, setState] = useState<MonthState | null>(null);
  const [exports, setExports] = useState<ExportRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [m, ex] = await Promise.all([
        apiFetch<MonthState>(`/finance/payroll/month?year=${year}&month=${month}`),
        apiFetch<ExportRow[]>(`/finance/payroll/exports?year=${year}&month=${month}`),
      ]);
      setState(m);
      setExports(ex);
    } catch {
      setState(null);
      setExports([]);
    }
  }, [year, month]);
  useEffect(() => { void load(); }, [load]);

  async function run(path: string, body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/finance/payroll/${path}`, { method: 'POST', body: JSON.stringify({ year, month, ...body }) });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  const locked = state?.status === 'LOCKED';

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Payroll export</CardTitle>
        <div className="flex items-center gap-2">
          <input type="number" value={year} min={2000} onChange={(e) => setYear(Number(e.target.value))} className="h-8 w-20 rounded-md border border-slate-300 px-2 text-sm" />
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="h-8 rounded-md border border-slate-300 px-2 text-sm">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>{new Date(2000, m - 1, 1).toLocaleString('en', { month: 'long' })}</option>
            ))}
          </select>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {state === null ? (
          <LoadingState />
        ) : (
          <>
            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-500">Status:</span>
              <Badge tone={locked ? 'red' : 'green'}>{state.status}</Badge>
              {!locked ? (
                <Button size="sm" disabled={busy} onClick={() => run('lock', {})}>Lock month</Button>
              ) : (
                <>
                  <Button size="sm" disabled={busy} onClick={() => run('export', {})}>Run export</Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => {
                    const reason = window.prompt('Reason for unlocking (audited):');
                    if (reason) void run('unlock', { reason });
                  }}>Unlock</Button>
                </>
              )}
            </div>
            {!locked ? <p className="text-xs text-slate-400">Lock the month before running the export (§5.8).</p> : null}
            {error ? <p className="text-xs text-slate-900">{error}</p> : null}

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Export history</h3>
              {exports && exports.length > 0 ? (
                <ul className="flex flex-col divide-y divide-slate-100">
                  {exports.map((e) => (
                    <li key={e.id} className="flex items-center justify-between py-2 text-sm">
                      <span className="text-slate-600">Revision {e.revision} · {new Date(e.generatedAt).toLocaleString()}</span>
                      <Button size="sm" variant="outline" onClick={() => downloadCsv(e.id)}>Download CSV</Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-500">No exports for this month yet.</p>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
