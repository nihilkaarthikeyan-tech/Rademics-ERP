'use client';

import { useMe } from '@/lib/me-context';
import { AttendanceCard } from '@/components/attendance-card';
import { DashboardOverview } from '@/components/dashboard-overview';

// Roles that clock in/out (Spec §3: Super Admin & Client never check in).
const CAN_CHECK_IN = ['HR', 'PM', 'TEAM_LEAD', 'EMPLOYEE', 'FINANCE'];

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function displayName(email: string): string {
  const base = email.split('@')[0] ?? email;
  return base.replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const DATE_FMT: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };

export default function DashboardPage() {
  const me = useMe();

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          {greeting()}, {displayName(me.email)}
        </h1>
        <p className="mt-1 font-mono text-xs uppercase tracking-wide text-slate-400">
          {new Date().toLocaleDateString(undefined, DATE_FMT)}
        </p>
      </div>

      {CAN_CHECK_IN.includes(me.role) ? <AttendanceCard /> : null}

      {/* Studio overview — self-gating: renders only for roles with reports access. */}
      <DashboardOverview />
    </div>
  );
}
