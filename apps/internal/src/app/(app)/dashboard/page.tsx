'use client';

import { useMe } from '@/lib/me-context';
import { AttendanceCard } from '@/components/attendance-card';
import { DashboardOverview } from '@/components/dashboard-overview';
import { OnlineNow } from '@/components/online-now';

// Roles that clock in/out (Spec §3: Super Admin & Client never check in).
const CAN_CHECK_IN = ['HR', 'TEAM_LEAD', 'EMPLOYEE', 'FINANCE'];

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
      {/* Greeting: today's date and who is signed in (Teams-style: plain, no banner). */}
      <section className="animate-rise flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500">{new Date().toLocaleDateString(undefined, DATE_FMT)}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-[#1B2A4A] sm:text-[1.75rem]">
            {greeting()}, {displayName(me.email)}
          </h1>
        </div>
      </section>

      {/* Your attendance beside who is online right now. */}
      <div className="grid gap-6 lg:grid-cols-3">
        {CAN_CHECK_IN.includes(me.role) ? (
          <div className="min-w-0 lg:col-span-2">
            <AttendanceCard />
          </div>
        ) : null}
        <div className={CAN_CHECK_IN.includes(me.role) ? 'min-w-0' : 'min-w-0 lg:col-span-3'}>
          <OnlineNow />
        </div>
      </div>

      {/* Studio overview — self-gating: renders only for roles with reports access. */}
      <DashboardOverview />
    </div>
  );
}
