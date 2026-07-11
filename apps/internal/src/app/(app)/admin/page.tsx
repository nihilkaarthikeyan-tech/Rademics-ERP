'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, ErrorState, LoadingState } from '@rademics/ui';
import { apiFetch } from '@/lib/api';

export default function AdminSettingsPage() {
  const [rules, setRules] = useState<Record<string, any> | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    apiFetch<Record<string, any>>('/settings/business-rules')
      .then((r) => {
        setRules(r);
        setState('ready');
      })
      .catch(() => setState('error'));
  }, []);

  const rows: Array<[string, string]> = rules
    ? [
        ['Working days', String(rules.workingDays)],
        ['Work hours', `${rules.workStart} – ${rules.workEnd} (${rules.timezone})`],
        ['Late threshold', String(rules.lateThreshold)],
        ['Half-day under', `${rules.halfDayUnderHours} h`],
        ['Overtime over', `${rules.overtimeOverHours} h`],
        ['Session timeout (Admin/Finance)', `${rules.sessionTimeoutAdminFinanceMinutes} min`],
        ['Invoice numbering', String(rules.invoiceNumberFormat)],
        ['Default GST', `${rules.defaultGstPercent}%`],
        ['File upload limit', `${rules.fileUploadLimitMb} MB`],
        ['AI daily limit / user', String(rules.aiDailyCallLimitPerUser)],
      ]
    : [];

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-xl font-semibold text-slate-800">Admin · Settings</h1>
      <p className="mt-1 text-sm text-slate-500">
        Business-rule defaults (Spec §4). These are stored in the settings store and editable here — full
        editing UI lands with later phases.
      </p>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Business rules</CardTitle>
        </CardHeader>
        <CardContent>
          {state === 'loading' ? (
            <LoadingState />
          ) : state === 'error' ? (
            <ErrorState description="Could not load settings." />
          ) : (
            <dl className="divide-y divide-slate-100">
              {rows.map(([k, v]) => (
                <div key={k} className="flex items-center justify-between py-2.5 text-sm">
                  <dt className="text-slate-500">{k}</dt>
                  <dd className="font-medium text-slate-800">{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
