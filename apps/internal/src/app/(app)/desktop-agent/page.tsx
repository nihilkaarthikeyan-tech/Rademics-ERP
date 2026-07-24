'use client';

import { Clock, MousePointerClick, Power, ShieldCheck } from 'lucide-react';
import { Card, CardContent } from '@rademics/ui';
import { DesktopAppCard } from '@/components/desktop-app-card';

const POINTS = [
  {
    icon: MousePointerClick,
    title: 'Check in & out',
    text: 'The only place to start and end your work day — the website shows your status read-only.',
  },
  {
    icon: Clock,
    title: 'Automatic activity tracking',
    text: 'Worked and idle time are measured from real keyboard/mouse activity, across all your apps.',
  },
  {
    icon: Power,
    title: 'Shutdown-safe',
    text: 'If your PC shuts down while checked in, the session is closed correctly the next time the app opens.',
  },
  {
    icon: ShieldCheck,
    title: 'Private by design',
    text: 'Only active/idle signals are recorded — no screenshots, no app names, no keystrokes.',
  },
];

/** Sidebar destination for getting the Windows Desktop Agent (download + what it does). */
export default function DesktopAgentPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Desktop Agent</h1>
        <p className="mt-1 text-sm text-slate-500">
          The Windows companion app for attendance — install it once, updates arrive on their own.
        </p>
      </div>

      <DesktopAppCard />

      <Card>
        <CardContent className="grid gap-5 pt-6 sm:grid-cols-2">
          {POINTS.map((p) => (
            <div key={p.title} className="flex gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-sm">
                <p.icon className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-700">{p.title}</p>
                <p className="mt-0.5 text-sm text-slate-500">{p.text}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
